
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";

import {
  createQueue,
  updateQueueName,
  updateQueueHoursOfOperation,
  updateQueueMaxContacts,
  updateQueueOutboundCallerConfig,
  updateQueueStatus
} from "./operations.js";
import { compareQueues, getQueueDiff, displayQueuePlan } from "./report.js";

import type { ConnectClient } from "@aws-sdk/client-connect";
import type { QueueComparisonResult, QueueAction } from "./report.js";


export interface CopyQueuesOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
  skipOutboundFlow: boolean;
}


export async function copyQueues(options: CopyQueuesOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing queue differences...");
  const comparisonResult = await compareQueues(
    {
      sourceClient,
      targetClient,
      sourceInstanceId: config.source.instanceId,
      targetInstanceId: config.target.instanceId,
      filterConfig: config.source.queueFilters
    },
    options.skipOutboundFlow
  );

  if (comparisonResult.actions.length === 0 && comparisonResult.queues.length === 0) {
    // Validation failed - compareQueues already printed the error
    return;
  }

  displayQueuePlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo queues need to be copied - all queues match");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying queues?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying queues...");
  await executeQueueCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose, options.skipOutboundFlow);
}


async function executeQueueCopy(targetClient: ConnectClient, targetInstanceId: string, result: QueueComparisonResult, verbose: boolean, skipOutboundFlow: boolean) {
  let created = 0;
  let updatedData = 0;
  let updatedTags = 0;

  for (const action of result.actions) {
    if (action.action === "skip") continue;

    if (action.action === "create") {
      logQueueCreate(action, verbose);

      const outboundConfig = buildOutboundCallerConfig(action.sourceQueue, result.flowMapping, skipOutboundFlow);

      const createdQueue = await createQueue(targetClient, targetInstanceId, {
        Name: action.sourceQueue.Name,
        HoursOfOperationId: result.hooMapping[action.sourceQueue.HoursOfOperationId!]!,
        Description: action.sourceQueue.Description,
        MaxContacts: action.sourceQueue.MaxContacts,
        OutboundCallerConfig: outboundConfig,
        Tags: action.sourceQueue.Tags
      });

      // Queues are created ENABLED by default - update status if source is DISABLED
      if (action.sourceQueue.Status === "DISABLED") {
        await updateQueueStatus(targetClient, targetInstanceId, createdQueue.id, "DISABLED");
      }

      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      logQueueUpdate(action, result, verbose, skipOutboundFlow);

      // Update name and description
      await updateQueueName(
        targetClient,
        targetInstanceId,
        action.targetQueueId!,
        action.sourceQueue.Name,
        action.sourceQueue.Description
      );

      // Update hours of operation
      await updateQueueHoursOfOperation(
        targetClient,
        targetInstanceId,
        action.targetQueueId!,
        result.hooMapping[action.sourceQueue.HoursOfOperationId!]!
      );

      // Update max contacts (passing undefined clears it)
      await updateQueueMaxContacts(
        targetClient,
        targetInstanceId,
        action.targetQueueId!,
        action.sourceQueue.MaxContacts
      );

      // Update outbound caller config
      const outboundConfig = buildOutboundCallerConfig(action.sourceQueue, result.flowMapping, skipOutboundFlow);
      if (outboundConfig) {
        await updateQueueOutboundCallerConfig(
          targetClient,
          targetInstanceId,
          action.targetQueueId!,
          outboundConfig
        );
      }

      // Update status
      if (action.sourceQueue.Status && action.sourceQueue.Status !== action.targetQueue?.Status) {
        await updateQueueStatus(
          targetClient,
          targetInstanceId,
          action.targetQueueId!,
          action.sourceQueue.Status as "ENABLED" | "DISABLED"
        );
      }

      updatedData++;
    }

    if (["update_tags", "update_all"].includes(action.action)) {
      logTagsUpdate(action, verbose);

      const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceQueue.Tags, action.targetQueue?.Tags);
      await AwsUtil.updateResourceTags(targetClient, action.targetQueueArn!, toAdd, toRemove);

      updatedTags++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updatedData} data updated, ${updatedTags} tags updated`);
  logManualConfigurationWarning(skipOutboundFlow);
}


function buildOutboundCallerConfig(sourceQueue: QueueAction["sourceQueue"], flowMapping: Record<string, string>, skipOutboundFlow: boolean) {
  const sourceConfig = sourceQueue.OutboundCallerConfig;
  if (!sourceConfig) return undefined;

  const config: { OutboundCallerIdName?: string; OutboundFlowId?: string } = {};

  if (sourceConfig.OutboundCallerIdName) {
    config.OutboundCallerIdName = sourceConfig.OutboundCallerIdName;
  }

  if (!skipOutboundFlow && sourceConfig.OutboundFlowId) {
    const mappedFlowId = flowMapping[sourceConfig.OutboundFlowId];
    if (mappedFlowId) config.OutboundFlowId = mappedFlowId;
  }

  // Only return config if there's something to set
  if (Object.keys(config).length === 0) return undefined;

  return config;
}


function logQueueCreate(action: QueueAction, verbose: boolean) {
  console.log(`Creating queue: ${action.queueName}`);
  if (!verbose) return;

  const queue = action.sourceQueue;
  if (queue.Description) console.log(`  Description: ${queue.Description}`);
  console.log(`  Status: ${queue.Status}`);
  if (queue.MaxContacts) console.log(`  MaxContacts: ${queue.MaxContacts}`);
  console.log(`  Tags: ${!queue.Tags ? "(none)" : Object.entries(queue.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}


function logQueueUpdate(action: QueueAction, result: QueueComparisonResult, verbose: boolean, skipOutboundFlow: boolean) {
  console.log(`Updating queue: ${action.queueName}`);
  if (!verbose || !action.targetQueue) return;

  const diffs = getQueueDiff(action.sourceQueue, action.targetQueue, result.hooMapping, result.flowMapping, skipOutboundFlow);
  console.log(`  Diffs: ${diffs.join("\n    ")}`);
}


function logTagsUpdate(action: QueueAction, verbose: boolean) {
  console.log(`Updating tags for queue: ${action.queueName}`);
  if (!verbose) return;

  console.log(`  Tags: ${!action.sourceQueue.Tags ? "(none)" : Object.entries(action.sourceQueue.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}


function logManualConfigurationWarning(skipOutboundFlow: boolean) {
  console.log("\n" + "=".repeat(72));
  console.log("⚠️  MANUAL CONFIGURATION MAY BE REQUIRED");
  console.log("=".repeat(72));
  console.log("\nThe following queue settings cannot be copied automatically:");
  console.log("\n• Outbound Caller ID Number - Phone numbers are instance-specific");
  console.log("  Configure manually in the AWS Connect Console.");
  console.log("\n• Outbound Email Address - Email addresses are instance-specific");
  console.log("  Configure manually in the AWS Connect Console.");
  console.log("\n• Quick Connect Associations - Run copy-quick-connects after this tool");

  if (skipOutboundFlow) {
    console.log("\n• Outbound Whisper Flow - Re-run without --skip-outbound-flow after copying flows");
  }

  console.log("\n" + "=".repeat(72));
}
