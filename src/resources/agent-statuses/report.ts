
import * as CliUtil from "../../utils/cli-utils.js";
import { listAgentStatuses } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeAgentStatus } from "./operations.js";

import type { AgentStatusSummary, AgentStatus } from "@aws-sdk/client-connect";


export interface AgentStatusAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  statusName: string;
  sourceStatus: AgentStatus;
  targetStatus?: AgentStatus;
  targetStatusId?: string;
  targetStatusArn?: string;
}


export interface AgentStatusComparisonResult {
  actions: AgentStatusAction[];
  statuses: AgentStatusSummary[];
}


export async function compareAgentStatuses(config: CliUtil.ResourceComparisonConfig): Promise<AgentStatusComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceStatuses = await listAgentStatuses(sourceClient, sourceInstanceId);
  const targetStatuses = await listAgentStatuses(targetClient, targetInstanceId);

  // Filter to custom statuses only (exclude system statuses like Available, Offline)
  let filteredSourceStatuses = sourceStatuses.filter(s => s.Type === "CUSTOM");

  if (filterConfig) {
    filteredSourceStatuses = filteredSourceStatuses.filter(status =>
      matchesFlowFilters(status.Name!, filterConfig)
    );
  }

  const targetStatusesByName = Object.fromEntries(targetStatuses.map(s => [s.Name, s]));
  const actions: AgentStatusAction[] = [];

  for (const sourceSummary of filteredSourceStatuses) {
    const sourceStatus = await describeAgentStatus(sourceClient, sourceInstanceId, sourceSummary.Id!);
    const targetSummary = targetStatusesByName[sourceSummary.Name!];

    if (!targetSummary) {
      actions.push({
        statusName: sourceSummary.Name!,
        action: "create",
        sourceStatus
      });
      continue;
    }

    const targetStatus = await describeAgentStatus(targetClient, targetInstanceId, targetSummary.Id!);

    const contentMatches = agentStatusContentMatches(sourceStatus, targetStatus);
    const tagsMatch = CliUtil.recordsMatch(sourceStatus.Tags, targetStatus.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    actions.push({
      statusName: sourceSummary.Name!,
      action: actionType,
      sourceStatus,
      targetStatus,
      targetStatusId: targetSummary.Id,
      targetStatusArn: targetSummary.Arn
    });
  }

  return { actions, statuses: filteredSourceStatuses };
}


function agentStatusContentMatches(source: AgentStatus, target: AgentStatus): boolean {
  if (source.State !== target.State) return false;
  if (source.Description !== target.Description) return false;

  // DisplayOrder only matters when ENABLED - AWS clears it to null when DISABLED
  // and rejects attempts to set it on DISABLED statuses
  if (source.State === "ENABLED" || target.State === "ENABLED") {
    if (source.DisplayOrder !== target.DisplayOrder) return false;
  }

  return true;
}


export function getAgentStatusDiff(source: AgentStatus, target: AgentStatus): string[] {
  const diffs: string[] = [];

  if (source.State !== target.State) {
    diffs.push(`State: ${target.State} → ${source.State}`);
  }

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? "(none)"} → ${source.Description ?? "(none)"}`);
  }

  // DisplayOrder only shown if different - both DISABLED statuses have null so won't show
  if (source.DisplayOrder !== target.DisplayOrder) {
    diffs.push(`DisplayOrder: ${target.DisplayOrder ?? "(none)"} → ${source.DisplayOrder ?? "(none)"}`);
  }

  return diffs;
}


export function displayAgentStatusPlan(result: AgentStatusComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateAll = result.actions.filter(a => a.action === "update_all");
  const toUpdateData = result.actions.filter(a => a.action === "update_data");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Agent statuses to create: ${toCreate.length}`);
  console.log(`  Agent statuses to update (all): ${toUpdateAll.length}`);
  console.log(`  Agent statuses to update (data only): ${toUpdateData.length}`);
  console.log(`  Agent statuses to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Agent statuses to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.statuses.length}`);

  if (toCreate.length > 0) {
    console.log(`\nAgent statuses to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.statusName}`);
      if (verbose) {
        const status = action.sourceStatus;
        console.log(`      State: ${status.State}`);
        if (status.Description) console.log(`      Description: ${status.Description}`);
        if (status.State === "ENABLED" && status.DisplayOrder !== undefined) {
          console.log(`      DisplayOrder: ${status.DisplayOrder}`);
        }
        if (status.Tags && Object.keys(status.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(status.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nAgent statuses to update (all):`);
    for (const action of toUpdateAll) {
      console.log(`  - ${action.statusName}`);
      if (verbose && action.targetStatus) {
        const diffs = getAgentStatusDiff(action.sourceStatus, action.targetStatus);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
        const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceStatus.Tags, action.targetStatus.Tags);
        if (Object.keys(toAdd).length) console.log(`      Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (toRemove.length) console.log(`      Tags to remove: ${toRemove.join(", ")}`);
      }
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nAgent statuses to update (data only):`);
    for (const action of toUpdateData) {
      console.log(`  - ${action.statusName}`);
      if (verbose && action.targetStatus) {
        const diffs = getAgentStatusDiff(action.sourceStatus, action.targetStatus);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nAgent statuses to update (tags only):`);
    for (const action of toUpdateTags) {
      console.log(`  - ${action.statusName}`);
      if (verbose && action.targetStatus) {
        const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceStatus.Tags, action.targetStatus.Tags);
        if (Object.keys(toAdd).length) console.log(`      Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (toRemove.length) console.log(`      Tags to remove: ${toRemove.join(", ")}`);
      }
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nAgent statuses to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.statusName}`);
    }
  }
}
