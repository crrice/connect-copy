
import * as CliUtil from "../../utils/cli-utils.js";
import { matchesFlowFilters } from "../../filters.js";
import { listRoutingProfiles, listQueues, describeRoutingProfile, listRoutingProfileQueues } from "./operations.js";

import type { RoutingProfileSummary, RoutingProfile, RoutingProfileQueueConfigSummary, MediaConcurrency } from "@aws-sdk/client-connect";


export type RoutingProfileWithQueues = RoutingProfile & {
  Name: string;
  QueueAssociations: RoutingProfileQueueConfigSummary[];
};


export interface RoutingProfileAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  profileName: string;
  sourceProfile: RoutingProfileWithQueues;
  targetProfile?: RoutingProfileWithQueues;
  targetProfileId?: string;
  targetProfileArn?: string;
}


export interface RoutingProfileComparisonResult {
  actions: RoutingProfileAction[];
  profiles: RoutingProfileSummary[];

  queueMapping: Record<string, string>;
}


export async function compareRoutingProfiles(config: CliUtil.ResourceComparisonConfig): Promise<RoutingProfileComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceProfiles = await listRoutingProfiles(sourceClient, sourceInstanceId);
  const targetProfiles = await listRoutingProfiles(targetClient, targetInstanceId);

  const filteredSourceProfiles = sourceProfiles.filter(profile => matchesFlowFilters(profile.Name!, filterConfig));

  // Build queue mapping (sourceQueueId → targetQueueId) by name
  const sourceQueues = await listQueues(sourceClient, sourceInstanceId);
  const targetQueues = await listQueues(targetClient, targetInstanceId);

  const targetQueuesByName = Object.fromEntries(targetQueues.map(q => [q.Name, q]));
  const queueMapping: Record<string, string> = {};

  for (const queue of sourceQueues) {
    const targetMatch = targetQueuesByName[queue.Name!];
    if (targetMatch) {
      queueMapping[queue.Id!] = targetMatch.Id!;
    }
  }

  // Also build sourceQueueId → queueName for error messages
  const sourceQueueNames = Object.fromEntries(sourceQueues.map(q => [q.Id, q.Name]));

  // Get full details and queue associations for filtered source profiles
  const sourceProfileDetails: RoutingProfileWithQueues[] = await Promise.all(
    filteredSourceProfiles.map(async p => {
      const profile = await describeRoutingProfile(sourceClient, sourceInstanceId, p.Id!);
      const queues = await listRoutingProfileQueues(sourceClient, sourceInstanceId, p.Id!);
      return { ...profile, Name: profile.Name!, QueueAssociations: queues };
    })
  );

  // Validate queue dependencies
  const profilesWithMissingQueues: { profile: RoutingProfileWithQueues; missingQueues: string[] }[] = [];

  for (const profile of sourceProfileDetails) {
    const missingQueues: string[] = [];

    // Check default outbound queue
    if (profile.DefaultOutboundQueueId && !queueMapping[profile.DefaultOutboundQueueId]) {
      const queueName = sourceQueueNames[profile.DefaultOutboundQueueId] ?? profile.DefaultOutboundQueueId;
      missingQueues.push(`${queueName} (default outbound)`);
    }

    // Check all queue associations
    for (const assoc of profile.QueueAssociations) {
      if (!queueMapping[assoc.QueueId!]) {
        const queueName = assoc.QueueName ?? assoc.QueueId!;
        if (!missingQueues.includes(queueName)) {
          missingQueues.push(queueName);
        }
      }
    }

    if (missingQueues.length > 0) {
      profilesWithMissingQueues.push({ profile, missingQueues });
    }
  }

  if (profilesWithMissingQueues.length > 0) {
    console.log("\n⚠️  Validation Error: Cannot copy routing profiles\n");
    console.log("The following routing profiles reference queues that don't exist in the target instance:\n");

    for (const { profile, missingQueues } of profilesWithMissingQueues) {
      console.log(`  - "${profile.Name}"`);
      for (const queue of missingQueues) {
        console.log(`      → Queue: "${queue}"`);
      }
    }

    console.log("\nTo resolve this issue:");
    console.log("  • Run copy-queues first, OR");
    console.log("  • Exclude these routing profiles using filters in your source config\n");

    return { actions: [], profiles: [], queueMapping };
  }

  // Build comparison actions
  const targetProfilesByName = Object.fromEntries(targetProfiles.map(p => [p.Name, p]));
  const actions: RoutingProfileAction[] = [];

  for (const sourceProfile of sourceProfileDetails) {
    const targetProfileSummary = targetProfilesByName[sourceProfile.Name];

    if (!targetProfileSummary) {
      actions.push({
        profileName: sourceProfile.Name,
        action: "create",
        sourceProfile
      });

      continue;
    }

    const targetProfileData = await describeRoutingProfile(targetClient, targetInstanceId, targetProfileSummary.Id!);
    const targetQueues = await listRoutingProfileQueues(targetClient, targetInstanceId, targetProfileSummary.Id!);
    const targetProfile: RoutingProfileWithQueues = { ...targetProfileData, Name: targetProfileData.Name!, QueueAssociations: targetQueues };

    const contentMatches = routingProfileContentMatches(sourceProfile, targetProfile, queueMapping);
    const tagsMatch = CliUtil.recordsMatch(sourceProfile.Tags, targetProfile.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    const action: RoutingProfileAction = {
      profileName: sourceProfile.Name,
      action: actionType,
      sourceProfile,
      targetProfile
    };

    if (targetProfileSummary.Id) action.targetProfileId = targetProfileSummary.Id;
    if (targetProfileSummary.Arn) action.targetProfileArn = targetProfileSummary.Arn;

    actions.push(action);
  }

  return { actions, profiles: filteredSourceProfiles, queueMapping };
}


function routingProfileContentMatches(source: RoutingProfileWithQueues, target: RoutingProfileWithQueues, queueMapping: Record<string, string>): boolean {
  if (source.Description !== target.Description) return false;
  if (source.AgentAvailabilityTimer !== target.AgentAvailabilityTimer) return false;

  // DefaultOutboundQueueId - compare by mapped ID
  if (queueMapping[source.DefaultOutboundQueueId!] !== target.DefaultOutboundQueueId) return false;

  // MediaConcurrencies - compare as set
  if (!mediaConcurrenciesMatch(source.MediaConcurrencies, target.MediaConcurrencies)) return false;

  // Queue associations - compare by (queueName, channel) with priority/delay
  if (!queueAssociationsMatch(source.QueueAssociations, target.QueueAssociations, queueMapping)) return false;

  return true;
}


function mediaConcurrenciesMatch(source: MediaConcurrency[] | undefined, target: MediaConcurrency[] | undefined): boolean {
  if (!source && !target) return true;
  if (!source || !target) return false;
  if (source.length !== target.length) return false;

  // Sort by channel for comparison
  const sortedSource = [...source].sort((a, b) => (a.Channel ?? "").localeCompare(b.Channel ?? ""));
  const sortedTarget = [...target].sort((a, b) => (a.Channel ?? "").localeCompare(b.Channel ?? ""));

  for (let i = 0; i < sortedSource.length; i++) {
    const s = sortedSource[i]!;
    const t = sortedTarget[i]!;

    if (s.Channel !== t.Channel) return false;
    if (s.Concurrency !== t.Concurrency) return false;

    // CrossChannelBehavior comparison
    if (s.CrossChannelBehavior?.BehaviorType !== t.CrossChannelBehavior?.BehaviorType) return false;
  }

  return true;
}


function queueAssociationsMatch(source: RoutingProfileQueueConfigSummary[], target: RoutingProfileQueueConfigSummary[], queueMapping: Record<string, string>): boolean {
  if (source.length !== target.length) return false;

  // Build target lookup by (queueId, channel)
  const targetByKey = new Map<string, RoutingProfileQueueConfigSummary>();
  for (const t of target) {
    const key = `${t.QueueId}:${t.Channel}`;
    targetByKey.set(key, t);
  }

  // Check each source association has a matching target
  for (const s of source) {
    const mappedQueueId = queueMapping[s.QueueId!];
    const key = `${mappedQueueId}:${s.Channel}`;
    const t = targetByKey.get(key);

    if (!t) return false;
    if (s.Priority !== t.Priority) return false;
    if (s.Delay !== t.Delay) return false;
  }

  return true;
}


export function getRoutingProfileDiff(source: RoutingProfileWithQueues, target: RoutingProfileWithQueues, queueMapping: Record<string, string>): string[] {
  const diffs: string[] = [];

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? "(none)"} → ${source.Description ?? "(none)"}`);
  }

  if (source.AgentAvailabilityTimer !== target.AgentAvailabilityTimer) {
    diffs.push(`AgentAvailabilityTimer: ${target.AgentAvailabilityTimer ?? "(none)"} → ${source.AgentAvailabilityTimer ?? "(none)"}`);
  }

  if (queueMapping[source.DefaultOutboundQueueId!] !== target.DefaultOutboundQueueId) {
    diffs.push(`DefaultOutboundQueue: changed`);
  }

  if (!mediaConcurrenciesMatch(source.MediaConcurrencies, target.MediaConcurrencies)) {
    const sourceChannels = source.MediaConcurrencies?.map(m => m.Channel).join(", ") ?? "(none)";
    const targetChannels = target.MediaConcurrencies?.map(m => m.Channel).join(", ") ?? "(none)";
    diffs.push(`MediaConcurrencies: [${targetChannels}] → [${sourceChannels}]`);
  }

  if (!queueAssociationsMatch(source.QueueAssociations, target.QueueAssociations, queueMapping)) {
    diffs.push(`QueueAssociations: ${target.QueueAssociations.length} → ${source.QueueAssociations.length} associations`);
  }

  return diffs;
}


export function displayRoutingProfilePlan(result: RoutingProfileComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateAll = result.actions.filter(a => a.action === "update_all");
  const toUpdateData = result.actions.filter(a => a.action === "update_data");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Routing profiles to create: ${toCreate.length}`);
  console.log(`  Routing profiles to update (all): ${toUpdateAll.length}`);
  console.log(`  Routing profiles to update (data only): ${toUpdateData.length}`);
  console.log(`  Routing profiles to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Routing profiles to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.profiles.length}`);

  if (toCreate.length > 0) {
    console.log(`\nRouting profiles to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.profileName}`);
      if (verbose) {
        const profile = action.sourceProfile;
        if (profile.Description) console.log(`      Description: ${profile.Description}`);
        const channels = profile.MediaConcurrencies?.map(m => `${m.Channel}(${m.Concurrency})`).join(", ");
        console.log(`      MediaConcurrencies: ${channels}`);
        console.log(`      QueueAssociations: ${profile.QueueAssociations.length}`);
        if (profile.AgentAvailabilityTimer) console.log(`      AgentAvailabilityTimer: ${profile.AgentAvailabilityTimer}`);
        if (profile.Tags && Object.keys(profile.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(profile.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nRouting profiles to update (all):`);
    for (const action of toUpdateAll) {
      console.log(`  - ${action.profileName}`);
      if (verbose && action.targetProfile) {
        const diffs = getRoutingProfileDiff(action.sourceProfile, action.targetProfile, result.queueMapping);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nRouting profiles to update (data only):`);
    for (const action of toUpdateData) {
      console.log(`  - ${action.profileName}`);
      if (verbose && action.targetProfile) {
        const diffs = getRoutingProfileDiff(action.sourceProfile, action.targetProfile, result.queueMapping);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nRouting profiles to update (tags only):`);
    for (const action of toUpdateTags) {
      console.log(`  - ${action.profileName}`);
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nRouting profiles to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.profileName}`);
    }
  }
}

