
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";

import {
  createRoutingProfile,
  updateRoutingProfileName,
  updateRoutingProfileConcurrency,
  updateRoutingProfileDefaultOutboundQueue,
  updateRoutingProfileAgentAvailabilityTimer,
  associateRoutingProfileQueues,
  disassociateRoutingProfileQueues,
  updateRoutingProfileQueues
} from "./operations.js";
import { compareRoutingProfiles, getRoutingProfileDiff, displayRoutingProfilePlan } from "./report.js";

import type { ConnectClient, RoutingProfileQueueConfig, RoutingProfileQueueReference } from "@aws-sdk/client-connect";
import type { RoutingProfileComparisonResult, RoutingProfileAction, RoutingProfileWithQueues } from "./report.js";


export interface CopyRoutingProfilesOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


export async function copyRoutingProfiles(options: CopyRoutingProfilesOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing routing profile differences...");
  const comparisonResult = await compareRoutingProfiles({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.routingProfileFilters
  });

  if (comparisonResult.actions.length === 0 && comparisonResult.profiles.length === 0) {
    // Validation failed - compareRoutingProfiles already printed the error
    return;
  }

  displayRoutingProfilePlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo routing profiles need to be copied - all profiles match");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying routing profiles?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying routing profiles...");
  await executeRoutingProfileCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);
}


async function executeRoutingProfileCopy(targetClient: ConnectClient, targetInstanceId: string, result: RoutingProfileComparisonResult, verbose: boolean) {
  let created = 0;
  let updatedData = 0;
  let updatedTags = 0;

  for (const action of result.actions) {
    if (action.action === "skip") continue;

    if (action.action === "create") {
      await executeCreate(targetClient, targetInstanceId, action, result, verbose);
      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      await executeUpdate(targetClient, targetInstanceId, action, result, verbose);
      updatedData++;
    }

    if (["update_tags", "update_all"].includes(action.action)) {
      console.log(`Updating tags for routing profile: ${action.profileName}`);

      const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceProfile.Tags, action.targetProfile?.Tags);
      await AwsUtil.updateResourceTags(targetClient, action.targetProfileArn!, toAdd, toRemove);

      updatedTags++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updatedData} data updated, ${updatedTags} tags updated`);
}


async function executeCreate(targetClient: ConnectClient, targetInstanceId: string, action: RoutingProfileAction, result: RoutingProfileComparisonResult, verbose: boolean) {
  const profile = action.sourceProfile;
  console.log(`Creating routing profile: ${action.profileName}`);

  if (verbose) {
    if (profile.Description) console.log(`  Description: ${profile.Description}`);
    const channels = profile.MediaConcurrencies?.map(m => `${m.Channel}(${m.Concurrency})`).join(", ");
    console.log(`  MediaConcurrencies: ${channels}`);
    console.log(`  QueueAssociations: ${profile.QueueAssociations.length}`);
  }

  // Build queue configs with mapped IDs (first 10 for create, rest via associate)
  const allQueueConfigs = buildQueueConfigs(profile, result.queueMapping);
  const initialQueueConfigs = allQueueConfigs.slice(0, 10);
  const remainingQueueConfigs = allQueueConfigs.slice(10);

  const createdProfile = await createRoutingProfile(targetClient, targetInstanceId, {
    Name: profile.Name,
    Description: profile.Description ?? "",
    DefaultOutboundQueueId: result.queueMapping[profile.DefaultOutboundQueueId!]!,
    MediaConcurrencies: profile.MediaConcurrencies ?? [],
    QueueConfigs: initialQueueConfigs.length > 0 ? initialQueueConfigs : undefined,
    AgentAvailabilityTimer: profile.AgentAvailabilityTimer,
    Tags: profile.Tags
  });

  // Associate remaining queues in batches of 10
  if (remainingQueueConfigs.length > 0) {
    await associateQueuesInBatches(targetClient, targetInstanceId, createdProfile.id, remainingQueueConfigs, verbose);
  }
}


async function executeUpdate(targetClient: ConnectClient, targetInstanceId: string, action: RoutingProfileAction, result: RoutingProfileComparisonResult, verbose: boolean) {
  const profile = action.sourceProfile;
  console.log(`Updating routing profile: ${action.profileName}`);

  if (verbose && action.targetProfile) {
    const diffs = getRoutingProfileDiff(profile, action.targetProfile, result.queueMapping);
    for (const diff of diffs) {
      console.log(`  ${diff}`);
    }
  }

  // Update name and description
  await updateRoutingProfileName(
    targetClient,
    targetInstanceId,
    action.targetProfileId!,
    profile.Name,
    profile.Description ?? ""
  );

  // Update media concurrencies
  if (profile.MediaConcurrencies && profile.MediaConcurrencies.length > 0) {
    await updateRoutingProfileConcurrency(
      targetClient,
      targetInstanceId,
      action.targetProfileId!,
      profile.MediaConcurrencies
    );
  }

  // Update default outbound queue
  await updateRoutingProfileDefaultOutboundQueue(
    targetClient,
    targetInstanceId,
    action.targetProfileId!,
    result.queueMapping[profile.DefaultOutboundQueueId!]!
  );

  // Update agent availability timer (if set in source)
  if (profile.AgentAvailabilityTimer) {
    await updateRoutingProfileAgentAvailabilityTimer(
      targetClient,
      targetInstanceId,
      action.targetProfileId!,
      profile.AgentAvailabilityTimer
    );
  }

  // Sync queue associations
  await syncQueueAssociations(
    targetClient,
    targetInstanceId,
    action.targetProfileId!,
    profile,
    action.targetProfile!,
    result.queueMapping,
    verbose
  );
}


function buildQueueConfigs(profile: RoutingProfileWithQueues, queueMapping: Record<string, string>): RoutingProfileQueueConfig[] {
  return profile.QueueAssociations.map(assoc => ({
    QueueReference: {
      QueueId: queueMapping[assoc.QueueId!]!,
      Channel: assoc.Channel
    },
    Priority: assoc.Priority!,
    Delay: assoc.Delay!
  }));
}


async function syncQueueAssociations(targetClient: ConnectClient, targetInstanceId: string, routingProfileId: string, source: RoutingProfileWithQueues, target: RoutingProfileWithQueues, queueMapping: Record<string, string>, verbose: boolean) {
  // Build maps keyed by (mappedQueueId, channel)
  const sourceByKey = new Map<string, typeof source.QueueAssociations[0]>();
  for (const assoc of source.QueueAssociations) {
    const mappedQueueId = queueMapping[assoc.QueueId!];
    const key = `${mappedQueueId}:${assoc.Channel}`;
    sourceByKey.set(key, assoc);
  }

  const targetByKey = new Map<string, typeof target.QueueAssociations[0]>();
  for (const assoc of target.QueueAssociations) {
    const key = `${assoc.QueueId}:${assoc.Channel}`;
    targetByKey.set(key, assoc);
  }

  // Determine what needs to change
  const toDisassociate: RoutingProfileQueueReference[] = [];
  const toAssociate: RoutingProfileQueueConfig[] = [];
  const toUpdate: RoutingProfileQueueConfig[] = [];

  // Find associations to remove (in target but not in source)
  for (const [key, assoc] of targetByKey) {
    if (!sourceByKey.has(key)) {
      toDisassociate.push({
        QueueId: assoc.QueueId!,
        Channel: assoc.Channel
      });
    }
  }

  // Find associations to add or update
  for (const [key, assoc] of sourceByKey) {
    const mappedQueueId = queueMapping[assoc.QueueId!];
    const targetAssoc = targetByKey.get(key);

    if (!targetAssoc) {
      toAssociate.push({
        QueueReference: {
          QueueId: mappedQueueId,
          Channel: assoc.Channel
        },
        Priority: assoc.Priority!,
        Delay: assoc.Delay!
      });
    } else if (assoc.Priority !== targetAssoc.Priority || assoc.Delay !== targetAssoc.Delay) {
      toUpdate.push({
        QueueReference: {
          QueueId: mappedQueueId,
          Channel: assoc.Channel
        },
        Priority: assoc.Priority!,
        Delay: assoc.Delay!
      });
    }
  }

  // Execute changes
  if (toDisassociate.length > 0) {
    if (verbose) console.log(`  Disassociating ${toDisassociate.length} queues`);
    await disassociateQueuesInBatches(targetClient, targetInstanceId, routingProfileId, toDisassociate, verbose);
  }

  if (toAssociate.length > 0) {
    if (verbose) console.log(`  Associating ${toAssociate.length} queues`);
    await associateQueuesInBatches(targetClient, targetInstanceId, routingProfileId, toAssociate, verbose);
  }

  if (toUpdate.length > 0) {
    if (verbose) console.log(`  Updating ${toUpdate.length} queue configurations`);
    await updateQueuesInBatches(targetClient, targetInstanceId, routingProfileId, toUpdate, verbose);
  }
}


async function associateQueuesInBatches(targetClient: ConnectClient, targetInstanceId: string, routingProfileId: string, queueConfigs: RoutingProfileQueueConfig[], verbose: boolean) {
  const BATCH_SIZE = 10;

  for (let i = 0; i < queueConfigs.length; i += BATCH_SIZE) {
    const batch = queueConfigs.slice(i, i + BATCH_SIZE);
    if (verbose && queueConfigs.length > BATCH_SIZE) {
      console.log(`    Associating batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(queueConfigs.length / BATCH_SIZE)}`);
    }
    await associateRoutingProfileQueues(targetClient, targetInstanceId, routingProfileId, batch);
  }
}


async function disassociateQueuesInBatches(targetClient: ConnectClient, targetInstanceId: string, routingProfileId: string, queueRefs: RoutingProfileQueueReference[], verbose: boolean) {
  const BATCH_SIZE = 10;

  for (let i = 0; i < queueRefs.length; i += BATCH_SIZE) {
    const batch = queueRefs.slice(i, i + BATCH_SIZE);
    if (verbose && queueRefs.length > BATCH_SIZE) {
      console.log(`    Disassociating batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(queueRefs.length / BATCH_SIZE)}`);
    }
    await disassociateRoutingProfileQueues(targetClient, targetInstanceId, routingProfileId, batch);
  }
}


async function updateQueuesInBatches(targetClient: ConnectClient, targetInstanceId: string, routingProfileId: string, queueConfigs: RoutingProfileQueueConfig[], verbose: boolean) {
  const BATCH_SIZE = 10;

  for (let i = 0; i < queueConfigs.length; i += BATCH_SIZE) {
    const batch = queueConfigs.slice(i, i + BATCH_SIZE);
    if (verbose && queueConfigs.length > BATCH_SIZE) {
      console.log(`    Updating batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(queueConfigs.length / BATCH_SIZE)}`);
    }
    await updateRoutingProfileQueues(targetClient, targetInstanceId, routingProfileId, batch);
  }
}

