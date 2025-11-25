
import type { ConnectClient, AgentStatusSummary, AgentStatus } from "@aws-sdk/client-connect";

import * as CliUtil from "../../utils/cli-utils.js";
import { listAgentStatuses } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeAgentStatus } from "./operations.js";

import type { SourceConfig } from "../../validation.js";


export interface AgentStatusAction {
  statusName: string;
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";
  sourceStatus: AgentStatus;
  targetStatus?: AgentStatus;
  targetStatusId?: string;
  targetStatusArn?: string;
}


export interface AgentStatusComparisonResult {
  actions: AgentStatusAction[];
  statusesToProcess: AgentStatusSummary[];
}


function filterSystemStatuses(statuses: AgentStatusSummary[]): AgentStatusSummary[] {
  return statuses.filter(s => s.Type === 'CUSTOM');
}


function agentStatusContentMatches(source: AgentStatus, target: AgentStatus): boolean {
  if (source.State !== target.State) return false;
  if (source.Description !== target.Description) return false;

  // DisplayOrder only matters when ENABLED - AWS clears it to null when DISABLED
  // and rejects attempts to set it on DISABLED statuses
  if (source.State === 'ENABLED' || target.State === 'ENABLED') {
    if (source.DisplayOrder !== target.DisplayOrder) return false;
  }

  return true;
}


function agentStatusTagsMatch(source: AgentStatus, target: AgentStatus): boolean {
  return CliUtil.recordsMatch(source.Tags, target.Tags);
}


export function getAgentStatusDiff(source: AgentStatus, target: AgentStatus): string[] {
  const diffs: string[] = [];

  if (source.State !== target.State) {
    diffs.push(`State: ${target.State} → ${source.State}`);
  }

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? '(none)'} → ${source.Description ?? '(none)'}`);
  }

  // DisplayOrder only shown if different - both DISABLED statuses have null so won't show
  if (source.DisplayOrder !== target.DisplayOrder) {
    diffs.push(`DisplayOrder: ${target.DisplayOrder ?? '(none)'} → ${source.DisplayOrder ?? '(none)'}`);
  }

  return diffs;
}


export function getAgentStatusTagDiff(source: AgentStatus, target: AgentStatus): { toAdd: Record<string, string>; toRemove: string[] } {
  return CliUtil.getRecordDiff(source.Tags, target.Tags);
}


export async function compareAgentStatuses(sourceClient: ConnectClient, targetClient: ConnectClient, sourceInstanceId: string, targetInstanceId: string, sourceConfig: SourceConfig): Promise<AgentStatusComparisonResult> {
  const sourceStatuses = await listAgentStatuses(sourceClient, sourceInstanceId);
  const targetStatuses = await listAgentStatuses(targetClient, targetInstanceId);

  let statusesToCopy = filterSystemStatuses(sourceStatuses);

  if (sourceConfig.agentStatusFilters) {
    statusesToCopy = statusesToCopy.filter(status =>
      matchesFlowFilters(status.Name ?? "", sourceConfig.agentStatusFilters)
    );
  }

  const targetStatusesByName = new Map(
    targetStatuses.map(s => [s.Name!, s])
  );

  const actions: AgentStatusAction[] = [];

  for (const statusSummary of statusesToCopy) {
    const statusName = statusSummary.Name!;
    const targetStatus = targetStatusesByName.get(statusName);

    const sourceStatusFull = await describeAgentStatus(
      sourceClient,
      sourceInstanceId,
      statusSummary.Id!
    );

    if (!targetStatus) {
      actions.push({
        statusName,
        action: 'create',
        sourceStatus: sourceStatusFull
      });
      continue;
    }

    const targetStatusFull = await describeAgentStatus(
      targetClient,
      targetInstanceId,
      targetStatus.Id!
    );

    const contentMatches = agentStatusContentMatches(sourceStatusFull, targetStatusFull);
    const tagsMatch = agentStatusTagsMatch(sourceStatusFull, targetStatusFull);

    let actionType: "update_all" | "update_tags" | "update_data" | "skip";
    if (!contentMatches && !tagsMatch) {
      actionType = "update_all";
    } else if (!contentMatches) {
      actionType = "update_data";
    } else if (!tagsMatch) {
      actionType = "update_tags";
    } else {
      actionType = "skip";
    }

    const action: AgentStatusAction = {
      statusName,
      action: actionType,
      sourceStatus: sourceStatusFull,
      targetStatus: targetStatusFull
    };
    if (targetStatus.Id !== undefined) action.targetStatusId = targetStatus.Id;
    if (targetStatus.Arn !== undefined) action.targetStatusArn = targetStatus.Arn;
    actions.push(action);
  }

  return {
    actions,
    statusesToProcess: statusesToCopy
  };
}
