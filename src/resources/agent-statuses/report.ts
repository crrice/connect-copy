
import type { ConnectClient, AgentStatusSummary, AgentStatus } from "@aws-sdk/client-connect";
import { listAgentStatuses } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeAgentStatus } from "./operations.js";

import type { SourceConfig } from "../../validation.js";


export interface AgentStatusAction {
  statusName: string;
  action: 'create' | 'update' | 'skip';
  sourceStatus: AgentStatus;
  targetStatus?: AgentStatus;
  targetStatusId?: string;
  targetStatusArn?: string;
  tagsNeedUpdate?: boolean;
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
  const sourceTags = source.Tags ?? {};
  const targetTags = target.Tags ?? {};

  const sourceKeys = Object.keys(sourceTags).sort();
  const targetKeys = Object.keys(targetTags).sort();

  if (sourceKeys.length !== targetKeys.length) return false;

  for (const key of sourceKeys) {
    if (sourceTags[key] !== targetTags[key]) return false;
  }

  return true;
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


export function getAgentStatusTagDiff(source: AgentStatus, target: AgentStatus): { toAdd: string[]; toRemove: string[] } {
  const sourceTags = source.Tags ?? {};
  const targetTags = target.Tags ?? {};

  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const [key, value] of Object.entries(sourceTags)) {
    if (targetTags[key] !== value) {
      toAdd.push(`${key}=${value}`);
    }
  }

  for (const key of Object.keys(targetTags)) {
    if (!(key in sourceTags)) {
      toRemove.push(key);
    }
  }

  return { toAdd, toRemove };
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

    if (contentMatches && tagsMatch) {
      actions.push({
        statusName,
        action: 'skip',
        sourceStatus: sourceStatusFull,
        targetStatus: targetStatusFull,
        targetStatusId: targetStatus.Id!,
        targetStatusArn: targetStatus.Arn!
      });
    } else if (contentMatches && !tagsMatch) {
      actions.push({
        statusName,
        action: 'skip',
        sourceStatus: sourceStatusFull,
        targetStatus: targetStatusFull,
        targetStatusId: targetStatus.Id!,
        targetStatusArn: targetStatus.Arn!,
        tagsNeedUpdate: true
      });
    } else {
      actions.push({
        statusName,
        action: 'update',
        sourceStatus: sourceStatusFull,
        targetStatus: targetStatusFull,
        targetStatusId: targetStatus.Id!,
        targetStatusArn: targetStatus.Arn!,
        tagsNeedUpdate: !tagsMatch
      });
    }
  }

  return {
    actions,
    statusesToProcess: statusesToCopy
  };
}
