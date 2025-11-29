
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";
import { compareQuickConnects, displayQuickConnectPlan, getQuickConnectDiff } from "./report.js";
import { createQuickConnect, updateQuickConnectName, updateQuickConnectConfig, associateQueueQuickConnects, disassociateQueueQuickConnects, listQuickConnects } from "./operations.js";

import type { ConnectClient, QuickConnectConfig } from "@aws-sdk/client-connect";
import type { QuickConnectComparisonResult, QuickConnectAction, QueueAssociationAction } from "./report.js";


export interface CopyQuickConnectsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


interface Mappings {
  userMapping: Record<string, string>;
  queueMapping: Record<string, string>;
  flowMapping: Record<string, string>;
}


export async function copyQuickConnects(options: CopyQuickConnectsOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing quick connect differences...");
  const comparisonResult = await compareQuickConnects({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.quickConnectFilters
  });

  displayQuickConnectPlan(comparisonResult, options.verbose);

  const needsQuickConnectCopy = comparisonResult.actions.some(a => a.action !== "skip" && a.action !== "skip_missing_deps");
  const needsAssociationSync = comparisonResult.queueAssociationActions.some(a => a.toAssociate.length > 0 || a.toDisassociate.length > 0);

  if (!needsQuickConnectCopy && !needsAssociationSync) {
    console.log("\nNo quick connects or queue associations need to be copied");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying quick connects?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying quick connects...");
  const createdQuickConnects = await executeQuickConnectCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);

  if (needsAssociationSync || Object.keys(createdQuickConnects).length > 0) {
    console.log("\nSyncing queue associations...");
    await executeQueueAssociationSync(targetClient, config.target.instanceId, comparisonResult, createdQuickConnects, options.verbose);
  }
}


async function executeQuickConnectCopy(targetClient: ConnectClient, targetInstanceId: string, result: QuickConnectComparisonResult, verbose: boolean): Promise<Record<string, string>> {
  let created = 0;
  let updatedData = 0;
  let updatedTags = 0;

  const createdQuickConnects: Record<string, string> = {};

  const mappings: Mappings = {
    userMapping: result.userMapping,
    queueMapping: result.queueMapping,
    flowMapping: result.flowMapping
  };

  for (const action of result.actions) {
    if (action.action === "skip" || action.action === "skip_missing_deps") continue;

    if (action.action === "create") {
      logQuickConnectCreate(action, verbose);

      const { id } = await createQuickConnect(targetClient, targetInstanceId, {
        Name: action.sourceQuickConnect.Name!,
        Description: action.sourceQuickConnect.Description,
        QuickConnectConfig: buildQuickConnectConfig(action.sourceQuickConnect.QuickConnectConfig!, mappings),
        Tags: action.sourceQuickConnect.Tags
      });

      createdQuickConnects[action.sourceQuickConnect.Name!] = id;
      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      logQuickConnectUpdate(action, mappings, verbose);

      await updateQuickConnectName(targetClient, targetInstanceId, action.targetQuickConnectId!, {
        Name: action.sourceQuickConnect.Name,
        Description: action.sourceQuickConnect.Description
      });

      await updateQuickConnectConfig(targetClient, targetInstanceId, action.targetQuickConnectId!,
        buildQuickConnectConfig(action.sourceQuickConnect.QuickConnectConfig!, mappings)
      );

      updatedData++;
    }

    if (["update_tags", "update_all"].includes(action.action)) {
      logTagsUpdate(action, verbose);

      const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceQuickConnect.Tags, action.targetQuickConnect?.Tags);
      await AwsUtil.updateResourceTags(targetClient, action.targetQuickConnectArn!, toAdd, toRemove);

      updatedTags++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updatedData} data updated, ${updatedTags} tags updated`);

  return createdQuickConnects;
}


function buildQuickConnectConfig(sourceConfig: QuickConnectConfig, mappings: Mappings): QuickConnectConfig {
  switch (sourceConfig.QuickConnectType) {
    case "USER":
      return {
        QuickConnectType: "USER",
        UserConfig: {
          UserId: mappings.userMapping[sourceConfig.UserConfig!.UserId!],
          ContactFlowId: mappings.flowMapping[sourceConfig.UserConfig!.ContactFlowId!]
        }
      };

    case "QUEUE":
      return {
        QuickConnectType: "QUEUE",
        QueueConfig: {
          QueueId: mappings.queueMapping[sourceConfig.QueueConfig!.QueueId!],
          ContactFlowId: mappings.flowMapping[sourceConfig.QueueConfig!.ContactFlowId!]
        }
      };

    case "PHONE_NUMBER":
      return {
        QuickConnectType: "PHONE_NUMBER",
        PhoneConfig: {
          PhoneNumber: sourceConfig.PhoneConfig!.PhoneNumber!
        }
      };

    default:
      throw new Error(`Unknown quick connect type: ${sourceConfig.QuickConnectType}`);
  }
}


function logQuickConnectCreate(action: QuickConnectAction, verbose: boolean) {
  console.log(`Creating quick connect: ${action.quickConnectName} (${action.quickConnectType})`);
  if (!verbose) return;

  const qc = action.sourceQuickConnect;
  if (qc.Description) console.log(`  Description: ${qc.Description}`);
  if (qc.Tags && Object.keys(qc.Tags).length > 0) {
    console.log(`  Tags: ${Object.entries(qc.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
}


function logQuickConnectUpdate(action: QuickConnectAction, mappings: Mappings, verbose: boolean) {
  console.log(`Updating quick connect: ${action.quickConnectName} (${action.quickConnectType})`);
  if (!verbose || !action.targetQuickConnect) return;

  const diffs = getQuickConnectDiff(action.sourceQuickConnect, action.targetQuickConnect, mappings);
  for (const diff of diffs) {
    console.log(`  ${diff}`);
  }
}


function logTagsUpdate(action: QuickConnectAction, verbose: boolean) {
  console.log(`Updating tags for quick connect: ${action.quickConnectName}`);
  if (!verbose || !action.targetQuickConnect) return;

  const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceQuickConnect.Tags, action.targetQuickConnect.Tags);
  if (Object.keys(toAdd).length) console.log(`  Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (toRemove.length) console.log(`  Tags to remove: ${toRemove.join(", ")}`);
}


async function executeQueueAssociationSync(
  targetClient: ConnectClient,
  targetInstanceId: string,
  result: QuickConnectComparisonResult,
  createdQuickConnects: Record<string, string>,
  verbose: boolean
) {
  // Build name → ID mapping from existing target QCs plus newly created ones
  const targetQuickConnects = await listQuickConnects(targetClient, targetInstanceId);
  const quickConnectNameToId: Record<string, string> = {
    ...Object.fromEntries(targetQuickConnects.map(qc => [qc.Name!, qc.Id!])),
    ...createdQuickConnects
  };

  // Recalculate associations to include newly created QCs
  const actions = recalculateQueueAssociations(result, quickConnectNameToId);

  let associated = 0;
  let disassociated = 0;

  for (const action of actions) {
    if (action.toDisassociate.length > 0) {
      const idsToDisassociate = action.toDisassociate
        .map(name => quickConnectNameToId[name])
        .filter((id): id is string => id !== undefined);

      if (idsToDisassociate.length > 0) {
        if (verbose) {
          console.log(`Disassociating from ${action.queueName}: ${action.toDisassociate.join(", ")}`);
        }
        await disassociateQueueQuickConnects(targetClient, targetInstanceId, action.targetQueueId, idsToDisassociate);
        disassociated += idsToDisassociate.length;
      }
    }

    if (action.toAssociate.length > 0) {
      const idsToAssociate = action.toAssociate
        .map(name => quickConnectNameToId[name])
        .filter((id): id is string => id !== undefined);

      if (idsToAssociate.length > 0) {
        if (verbose) {
          console.log(`Associating to ${action.queueName}: ${action.toAssociate.join(", ")}`);
        }
        await associateQueueQuickConnects(targetClient, targetInstanceId, action.targetQueueId, idsToAssociate);
        associated += idsToAssociate.length;
      }
    }
  }

  if (associated > 0 || disassociated > 0) {
    console.log(`\nQueue associations: ${associated} associated, ${disassociated} disassociated`);
  }
}


function recalculateQueueAssociations(result: QuickConnectComparisonResult, quickConnectNameToId: Record<string, string>): QueueAssociationAction[] {
  const actions: QueueAssociationAction[] = [];

  for (const origAction of result.queueAssociationActions) {
    // Filter toAssociate to only include QCs that now exist in target
    const toAssociate = origAction.toAssociate.filter(name => quickConnectNameToId[name]);

    if (toAssociate.length > 0 || origAction.toDisassociate.length > 0) {
      actions.push({
        ...origAction,
        toAssociate
      });
    }
  }

  return actions;
}
