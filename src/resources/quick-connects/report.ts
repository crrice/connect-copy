

import * as CliUtil from "../../utils/cli-utils.js";
import { matchesFlowFilters } from "../../filters.js";
import { listQuickConnects, listUsers, listQueues, listContactFlows, describeQuickConnect, listQueueQuickConnects } from "./operations.js";

import type { QuickConnectSummary, QuickConnect, QuickConnectConfig, QueueSummary, ConnectClient } from "@aws-sdk/client-connect";


export type QuickConnectActionType = "create" | "update_all" | "update_tags" | "update_data" | "skip" | "skip_missing_deps";


export interface QuickConnectAction {
  action: QuickConnectActionType;

  quickConnectName: string;
  quickConnectType: "USER" | "QUEUE" | "PHONE_NUMBER";
  sourceQuickConnect: QuickConnect;
  targetQuickConnect?: QuickConnect;
  targetQuickConnectId?: string;
  targetQuickConnectArn?: string;
  missingDeps?: string[];
}


export interface QuickConnectComparisonResult {
  actions: QuickConnectAction[];
  quickConnects: QuickConnectSummary[];
  queueAssociationActions: QueueAssociationAction[];

  sourceQueues: QueueSummary[];
  targetQueues: QueueSummary[];
  userMapping: Record<string, string>;
  queueMapping: Record<string, string>;
  flowMapping: Record<string, string>;
}


export interface QueueAssociationAction {
  queueName: string;
  targetQueueId: string;
  toAssociate: string[];
  toDisassociate: string[];
}


interface Mappings {
  userMapping: Record<string, string>;
  queueMapping: Record<string, string>;
  flowMapping: Record<string, string>;
}


export async function compareQuickConnects(config: CliUtil.ResourceComparisonConfig): Promise<QuickConnectComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceQuickConnects = await listQuickConnects(sourceClient, sourceInstanceId);
  const targetQuickConnects = await listQuickConnects(targetClient, targetInstanceId);

  let filteredSourceQuickConnects = sourceQuickConnects;

  if (filterConfig) {
    filteredSourceQuickConnects = filteredSourceQuickConnects.filter(qc =>
      matchesFlowFilters(qc.Name!, filterConfig)
    );
  }

  // Build user mapping (by Username)
  const sourceUsers = await listUsers(sourceClient, sourceInstanceId);
  const targetUsers = await listUsers(targetClient, targetInstanceId);
  const targetUsersByUsername = Object.fromEntries(targetUsers.map(u => [u.Username, u]));
  const userMapping: Record<string, string> = {};

  for (const user of sourceUsers) {
    const targetMatch = targetUsersByUsername[user.Username!];
    if (targetMatch) {
      userMapping[user.Id!] = targetMatch.Id!;
    }
  }

  // Build queue mapping (by Name)
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

  // Build flow mapping (by Name, ARN to ARN)
  const sourceFlows = await listContactFlows(sourceClient, sourceInstanceId);
  const targetFlows = await listContactFlows(targetClient, targetInstanceId);
  const targetFlowsByName = Object.fromEntries(targetFlows.map(f => [f.Name, f]));
  const flowMapping: Record<string, string> = {};

  for (const flow of sourceFlows) {
    const targetMatch = targetFlowsByName[flow.Name!];
    if (targetMatch) {
      flowMapping[flow.Id!] = targetMatch.Id!;
    }
  }

  const mappings: Mappings = { userMapping, queueMapping, flowMapping };

  // Build reverse lookups for missing dep messages
  const sourceUsersById = Object.fromEntries(sourceUsers.map(u => [u.Id, u]));
  const sourceQueuesById = Object.fromEntries(sourceQueues.map(q => [q.Id, q]));
  const sourceFlowsById = Object.fromEntries(sourceFlows.map(f => [f.Id, f]));

  const targetQuickConnectsByName = Object.fromEntries(targetQuickConnects.map(qc => [qc.Name, qc]));
  const actions: QuickConnectAction[] = [];

  for (const sourceSummary of filteredSourceQuickConnects) {
    const sourceQuickConnect = await describeQuickConnect(sourceClient, sourceInstanceId, sourceSummary.Id!);
    const targetSummary = targetQuickConnectsByName[sourceSummary.Name!];
    const quickConnectType = sourceQuickConnect.QuickConnectConfig!.QuickConnectType!;

    // Check for missing dependencies
    const missingDeps = getMissingDeps(sourceQuickConnect, mappings, sourceUsersById, sourceQueuesById, sourceFlowsById);

    if (!targetSummary) {
      if (missingDeps.length > 0) {
        actions.push({
          quickConnectName: sourceSummary.Name!,
          quickConnectType,
          action: "skip_missing_deps",
          sourceQuickConnect,
          missingDeps
        });
      } else {
        actions.push({
          quickConnectName: sourceSummary.Name!,
          quickConnectType,
          action: "create",
          sourceQuickConnect
        });
      }
      continue;
    }

    const targetQuickConnect = await describeQuickConnect(targetClient, targetInstanceId, targetSummary.Id!);

    if (missingDeps.length > 0) {
      actions.push({
        quickConnectName: sourceSummary.Name!,
        quickConnectType,
        action: "skip_missing_deps",
        sourceQuickConnect,
        targetQuickConnect,
        targetQuickConnectId: targetSummary.Id,
        targetQuickConnectArn: targetSummary.Arn,
        missingDeps
      });
      continue;
    }

    const contentMatches = quickConnectContentMatches(sourceQuickConnect, targetQuickConnect, mappings);
    const tagsMatch = CliUtil.recordsMatch(sourceQuickConnect.Tags, targetQuickConnect.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    actions.push({
      quickConnectName: sourceSummary.Name!,
      quickConnectType,
      action: actionType,
      sourceQuickConnect,
      targetQuickConnect,
      targetQuickConnectId: targetSummary.Id,
      targetQuickConnectArn: targetSummary.Arn
    });
  }

  // Build set of QC names that will exist in target after copy
  // (existing target QCs + QCs being created)
  const qcNamesWillExist = new Set<string>();
  for (const qc of targetQuickConnects) {
    qcNamesWillExist.add(qc.Name!);
  }
  for (const action of actions) {
    if (action.action === "create") {
      qcNamesWillExist.add(action.quickConnectName);
    }
  }

  // Compare queue associations
  const queueAssociationActions = await compareQueueAssociations(
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    sourceQueues,
    targetQueues,
    queueMapping,
    qcNamesWillExist
  );

  return {
    actions,
    quickConnects: filteredSourceQuickConnects,
    queueAssociationActions,
    sourceQueues,
    targetQueues,
    userMapping,
    queueMapping,
    flowMapping
  };
}


async function compareQueueAssociations(
  sourceClient: ConnectClient,
  targetClient: ConnectClient,
  sourceInstanceId: string,
  targetInstanceId: string,
  sourceQueues: QueueSummary[],
  targetQueues: QueueSummary[],
  queueMapping: Record<string, string>,
  qcNamesWillExist: Set<string>
): Promise<QueueAssociationAction[]> {
  const actions: QueueAssociationAction[] = [];
  const targetQueuesById = Object.fromEntries(targetQueues.map(q => [q.Id, q]));

  for (const sourceQueue of sourceQueues) {
    const targetQueueId = queueMapping[sourceQueue.Id!];
    if (!targetQueueId) continue;

    const targetQueue = targetQueuesById[targetQueueId];
    if (!targetQueue) continue;

    const sourceQueueQcs = await listQueueQuickConnects(sourceClient, sourceInstanceId, sourceQueue.Id!);
    const targetQueueQcs = await listQueueQuickConnects(targetClient, targetInstanceId, targetQueueId);

    const sourceQcNames = new Set(sourceQueueQcs.map(qc => qc.Name!));
    const targetQcNames = new Set(targetQueueQcs.map(qc => qc.Name!));

    const toAssociate: string[] = [];
    const toDisassociate: string[] = [];

    for (const name of sourceQcNames) {
      // Include if not already associated AND will exist in target after copy
      if (!targetQcNames.has(name) && qcNamesWillExist.has(name)) {
        toAssociate.push(name);
      }
    }

    for (const name of targetQcNames) {
      if (!sourceQcNames.has(name)) {
        toDisassociate.push(name);
      }
    }

    if (toAssociate.length > 0 || toDisassociate.length > 0) {
      actions.push({
        queueName: sourceQueue.Name!,
        targetQueueId,
        toAssociate,
        toDisassociate
      });
    }
  }

  return actions;
}


function getMissingDeps(
  source: QuickConnect,
  mappings: Mappings,
  sourceUsersById: Record<string, { Username?: string }>,
  sourceQueuesById: Record<string, { Name?: string }>,
  sourceFlowsById: Record<string, { Name?: string }>
): string[] {
  const missing: string[] = [];
  const config = source.QuickConnectConfig!;

  switch (config.QuickConnectType) {
    case "USER": {
      const userId = config.UserConfig!.UserId!;
      const flowId = config.UserConfig!.ContactFlowId!;

      if (!mappings.userMapping[userId]) {
        const username = sourceUsersById[userId]?.Username ?? userId;
        missing.push(`User "${username}" not found in target`);
      }
      if (!mappings.flowMapping[flowId]) {
        const flowName = sourceFlowsById[flowId]?.Name ?? flowId;
        missing.push(`Flow "${flowName}" not found in target`);
      }
      break;
    }

    case "QUEUE": {
      const queueId = config.QueueConfig!.QueueId!;
      const flowId = config.QueueConfig!.ContactFlowId!;

      if (!mappings.queueMapping[queueId]) {
        const queueName = sourceQueuesById[queueId]?.Name ?? queueId;
        missing.push(`Queue "${queueName}" not found in target`);
      }
      if (!mappings.flowMapping[flowId]) {
        const flowName = sourceFlowsById[flowId]?.Name ?? flowId;
        missing.push(`Flow "${flowName}" not found in target`);
      }
      break;
    }

    case "PHONE_NUMBER":
      // No dependencies to check
      break;
  }

  return missing;
}


function quickConnectContentMatches(source: QuickConnect, target: QuickConnect, mappings: Mappings): boolean {
  if (source.Name !== target.Name) return false;
  if (source.Description !== target.Description) return false;

  const sourceConfig = source.QuickConnectConfig!;
  const targetConfig = target.QuickConnectConfig!;

  if (sourceConfig.QuickConnectType !== targetConfig.QuickConnectType) return false;

  switch (sourceConfig.QuickConnectType) {
    case "USER": {
      const mappedUserId = mappings.userMapping[sourceConfig.UserConfig!.UserId!];
      const mappedFlowId = mappings.flowMapping[sourceConfig.UserConfig!.ContactFlowId!];
      return mappedUserId === targetConfig.UserConfig?.UserId
          && mappedFlowId === targetConfig.UserConfig?.ContactFlowId;
    }

    case "QUEUE": {
      const mappedQueueId = mappings.queueMapping[sourceConfig.QueueConfig!.QueueId!];
      const mappedFlowId = mappings.flowMapping[sourceConfig.QueueConfig!.ContactFlowId!];
      return mappedQueueId === targetConfig.QueueConfig?.QueueId
          && mappedFlowId === targetConfig.QueueConfig?.ContactFlowId;
    }

    case "PHONE_NUMBER":
      return sourceConfig.PhoneConfig!.PhoneNumber === targetConfig.PhoneConfig?.PhoneNumber;
  }

  return false;
}


export function getQuickConnectDiff(source: QuickConnect, target: QuickConnect, mappings: Mappings): string[] {
  const diffs: string[] = [];

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? "(none)"} → ${source.Description ?? "(none)"}`);
  }

  const sourceConfig = source.QuickConnectConfig!;
  const targetConfig = target.QuickConnectConfig!;

  if (sourceConfig.QuickConnectType !== targetConfig.QuickConnectType) {
    diffs.push(`Type: ${targetConfig.QuickConnectType} → ${sourceConfig.QuickConnectType}`);
    return diffs;
  }

  switch (sourceConfig.QuickConnectType) {
    case "USER": {
      const mappedUserId = mappings.userMapping[sourceConfig.UserConfig!.UserId!];
      const mappedFlowId = mappings.flowMapping[sourceConfig.UserConfig!.ContactFlowId!];

      if (mappedUserId !== targetConfig.UserConfig?.UserId) {
        diffs.push(`UserId: ${targetConfig.UserConfig?.UserId ?? "(none)"} → ${mappedUserId}`);
      }
      if (mappedFlowId !== targetConfig.UserConfig?.ContactFlowId) {
        diffs.push(`ContactFlowId: ${targetConfig.UserConfig?.ContactFlowId ?? "(none)"} → ${mappedFlowId}`);
      }
      break;
    }

    case "QUEUE": {
      const mappedQueueId = mappings.queueMapping[sourceConfig.QueueConfig!.QueueId!];
      const mappedFlowId = mappings.flowMapping[sourceConfig.QueueConfig!.ContactFlowId!];

      if (mappedQueueId !== targetConfig.QueueConfig?.QueueId) {
        diffs.push(`QueueId: ${targetConfig.QueueConfig?.QueueId ?? "(none)"} → ${mappedQueueId}`);
      }
      if (mappedFlowId !== targetConfig.QueueConfig?.ContactFlowId) {
        diffs.push(`ContactFlowId: ${targetConfig.QueueConfig?.ContactFlowId ?? "(none)"} → ${mappedFlowId}`);
      }
      break;
    }

    case "PHONE_NUMBER": {
      if (sourceConfig.PhoneConfig!.PhoneNumber !== targetConfig.PhoneConfig?.PhoneNumber) {
        diffs.push(`PhoneNumber: ${targetConfig.PhoneConfig?.PhoneNumber ?? "(none)"} → ${sourceConfig.PhoneConfig!.PhoneNumber}`);
      }
      break;
    }
  }

  return diffs;
}


export function displayQuickConnectPlan(result: QuickConnectComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateAll = result.actions.filter(a => a.action === "update_all");
  const toUpdateData = result.actions.filter(a => a.action === "update_data");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toSkip = result.actions.filter(a => a.action === "skip");
  const toSkipMissingDeps = result.actions.filter(a => a.action === "skip_missing_deps");

  console.log(`\nSummary:`);
  console.log(`  Quick connects to create: ${toCreate.length}`);
  console.log(`  Quick connects to update (all): ${toUpdateAll.length}`);
  console.log(`  Quick connects to update (data only): ${toUpdateData.length}`);
  console.log(`  Quick connects to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Quick connects to skip (identical): ${toSkip.length}`);
  console.log(`  Quick connects to skip (missing deps): ${toSkipMissingDeps.length}`);
  console.log(`  Total processed: ${result.quickConnects.length}`);

  const mappings: Mappings = {
    userMapping: result.userMapping,
    queueMapping: result.queueMapping,
    flowMapping: result.flowMapping
  };

  if (toCreate.length > 0) {
    console.log(`\nQuick connects to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.quickConnectName} (${action.quickConnectType})`);
      if (verbose) {
        const qc = action.sourceQuickConnect;
        if (qc.Description) console.log(`      Description: ${qc.Description}`);
        logConfigDetails(qc.QuickConnectConfig!, "      ");
        if (qc.Tags && Object.keys(qc.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(qc.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nQuick connects to update (all):`);
    for (const action of toUpdateAll) {
      console.log(`  - ${action.quickConnectName} (${action.quickConnectType})`);
      if (verbose && action.targetQuickConnect) {
        const diffs = getQuickConnectDiff(action.sourceQuickConnect, action.targetQuickConnect, mappings);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
        const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceQuickConnect.Tags, action.targetQuickConnect.Tags);
        if (Object.keys(toAdd).length) console.log(`      Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (toRemove.length) console.log(`      Tags to remove: ${toRemove.join(", ")}`);
      }
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nQuick connects to update (data only):`);
    for (const action of toUpdateData) {
      console.log(`  - ${action.quickConnectName} (${action.quickConnectType})`);
      if (verbose && action.targetQuickConnect) {
        const diffs = getQuickConnectDiff(action.sourceQuickConnect, action.targetQuickConnect, mappings);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nQuick connects to update (tags only):`);
    for (const action of toUpdateTags) {
      console.log(`  - ${action.quickConnectName} (${action.quickConnectType})`);
      if (verbose && action.targetQuickConnect) {
        const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceQuickConnect.Tags, action.targetQuickConnect.Tags);
        if (Object.keys(toAdd).length) console.log(`      Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (toRemove.length) console.log(`      Tags to remove: ${toRemove.join(", ")}`);
      }
    }
  }

  if (toSkipMissingDeps.length > 0) {
    console.log(`\nQuick connects to skip (missing deps):`);
    for (const action of toSkipMissingDeps) {
      console.log(`  - ${action.quickConnectName} (${action.quickConnectType})`);
      for (const dep of action.missingDeps!) {
        console.log(`      Missing: ${dep}`);
      }
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nQuick connects to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.quickConnectName} (${action.quickConnectType})`);
    }
  }

  // Queue association changes
  const queueAssociationChanges = result.queueAssociationActions.filter(
    a => a.toAssociate.length > 0 || a.toDisassociate.length > 0
  );

  if (queueAssociationChanges.length > 0) {
    console.log(`\nQueue association changes:`);
    for (const action of queueAssociationChanges) {
      console.log(`  ${action.queueName}:`);
      if (action.toAssociate.length > 0) {
        console.log(`    Associate: ${action.toAssociate.join(", ")}`);
      }
      if (action.toDisassociate.length > 0) {
        console.log(`    Disassociate: ${action.toDisassociate.join(", ")}`);
      }
    }
  }
}


function logConfigDetails(config: QuickConnectConfig, indent: string) {
  switch (config.QuickConnectType) {
    case "USER":
      console.log(`${indent}UserId: ${config.UserConfig!.UserId}`);
      console.log(`${indent}ContactFlowId: ${config.UserConfig!.ContactFlowId}`);
      break;

    case "QUEUE":
      console.log(`${indent}QueueId: ${config.QueueConfig!.QueueId}`);
      console.log(`${indent}ContactFlowId: ${config.QueueConfig!.ContactFlowId}`);
      break;

    case "PHONE_NUMBER":
      console.log(`${indent}PhoneNumber: ${config.PhoneConfig!.PhoneNumber}`);
      break;
  }
}
