
import * as CliUtil from "../../utils/cli-utils.js";
import { listHoursOfOperations } from "../../connect/resources.js";
import { listContactFlows } from "../../connect/flows.js";
import { matchesFlowFilters } from "../../filters.js";
import { listStandardQueues, listPhoneNumbers, describeQueue } from "./operations.js";

import type { QueueSummary, Queue } from "@aws-sdk/client-connect";


export interface QueueAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  queueName: string;
  sourceQueue: NoUndefinedVals<Queue> & { Name: string };
  targetQueue?: NoUndefinedVals<Queue> & { Name: string };
  targetQueueId?: string;
  targetQueueArn?: string;
}


export interface QueueComparisonResult {
  actions: QueueAction[];
  queues: QueueSummary[];

  hooMapping: Record<string, string>;
  flowMapping: Record<string, string>;
  phoneMapping: Record<string, string>;
  queuesWithUnmappedPhones: string[];
}


export interface CompareQueuesOptions {
  skipOutboundFlow: boolean;
  phoneNumberMappings?: Record<string, string> | undefined;
}


export async function compareQueues(config: CliUtil.ResourceComparisonConfig, options: CompareQueuesOptions): Promise<QueueComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceQueues = await listStandardQueues(sourceClient, sourceInstanceId);
  const targetQueues = await listStandardQueues(targetClient, targetInstanceId);

  const filteredSourceQueues = sourceQueues.filter(queue => matchesFlowFilters(queue.Name!, filterConfig));

  // Build hours of operation mapping (sourceId → targetId)
  const sourceHoo = await listHoursOfOperations(sourceClient, sourceInstanceId);
  const targetHoo = await listHoursOfOperations(targetClient, targetInstanceId);

  const targetHooByName = Object.fromEntries(targetHoo.map(h => [h.Name, h]));
  const hooMapping: Record<string, string> = {};

  for (const hoo of sourceHoo) {
    const targetMatch = targetHooByName[hoo.Name!];
    if (targetMatch) {
      hooMapping[hoo.Id!] = targetMatch.Id!;
    }
  }

  // Build flow mapping if needed (sourceArn → targetArn)
  const flowMapping: Record<string, string> = {};

  if (!options.skipOutboundFlow) {
    const sourceFlows = await listContactFlows(sourceClient, sourceInstanceId);
    const targetFlows = await listContactFlows(targetClient, targetInstanceId);

    const targetFlowsByName = Object.fromEntries(targetFlows.map(f => [f.Name, f]));

    for (const flow of sourceFlows) {
      const targetMatch = targetFlowsByName[flow.Name!];
      if (targetMatch) {
        flowMapping[flow.Arn!] = targetMatch.Arn!;
      }
    }
  }

  // Build phone number mapping (sourceId → targetId) and validate
  // Supports both E164 format (+1234567890) and phone number IDs (UUIDs)
  const phoneMapping: Record<string, string> = {};
  const sourcePhoneNumbers = await listPhoneNumbers(sourceClient, sourceInstanceId);
  const targetPhoneNumbers = await listPhoneNumbers(targetClient, targetInstanceId);

  const sourcePhoneById = new Map(sourcePhoneNumbers.map(p => [p.PhoneNumberId, p]));
  const sourcePhoneByE164 = new Map(sourcePhoneNumbers.map(p => [p.PhoneNumber, p]));
  const targetPhoneById = new Map(targetPhoneNumbers.map(p => [p.PhoneNumberId, p]));
  const targetPhoneByE164 = new Map(targetPhoneNumbers.map(p => [p.PhoneNumber, p]));

  if (options.phoneNumberMappings) {
    const invalidMappings: string[] = [];

    for (const [sourceKey, targetKey] of Object.entries(options.phoneNumberMappings)) {
      // Resolve source to phone number ID
      const sourcePhone = sourceKey.startsWith("+")
        ? sourcePhoneByE164.get(sourceKey)
        : sourcePhoneById.get(sourceKey);

      // Resolve target to phone number ID
      const targetPhone = targetKey.startsWith("+")
        ? targetPhoneByE164.get(targetKey)
        : targetPhoneById.get(targetKey);

      if (!sourcePhone) {
        invalidMappings.push(`${sourceKey} (not found in source instance)`);
      } else if (!targetPhone) {
        invalidMappings.push(`${sourceKey} → ${targetKey} (target not found)`);
      } else {
        phoneMapping[sourcePhone.PhoneNumberId!] = targetPhone.PhoneNumberId!;
      }
    }

    if (invalidMappings.length > 0) {
      console.log("\n⚠️  Validation Error: Invalid phone number mappings\n");
      console.log("The following phone number mappings are invalid:\n");
      for (const mapping of invalidMappings) {
        console.log(`  - ${mapping}`);
      }
      console.log("\nCheck your phoneNumberMappings in the source config file.\n");

      return { actions: [], queues: [], hooMapping, flowMapping, phoneMapping, queuesWithUnmappedPhones: [] };
    }
  }

  // Get full details for filtered source queues
  const sourceQueueDetails = await Promise.all(
    filteredSourceQueues.map(q => describeQueue(sourceClient, sourceInstanceId, q.Id!))
  );

  // Validate hours of operation dependencies
  const queuesWithMissingHoo = sourceQueueDetails.filter(q => !hooMapping[q.HoursOfOperationId!]);

  if (queuesWithMissingHoo.length > 0) {
    console.log("\n⚠️  Validation Error: Cannot copy queues\n");
    console.log("The following queues reference hours of operation that don't exist in the target instance:\n");

    for (const queue of queuesWithMissingHoo) {
      const hooName = sourceHoo.find(h => h.Id === queue.HoursOfOperationId)?.Name ?? queue.HoursOfOperationId;
      console.log(`  - "${queue.Name}" → Hours of Operation: "${hooName}"`);
    }

    console.log("\nTo resolve this issue:");
    console.log("  • Run copy-hours-of-operation first, OR");
    console.log("  • Exclude these queues using filters in your source config\n");

    return { actions: [], queues: [], hooMapping, flowMapping, phoneMapping, queuesWithUnmappedPhones: [] };
  }

  // Validate outbound flow dependencies (if not skipped)
  if (!options.skipOutboundFlow) {
    const queuesWithMissingFlow = sourceQueueDetails.filter(q => {
      const flowArn = q.OutboundCallerConfig?.OutboundFlowId;
      return flowArn && !flowMapping[flowArn];
    });

    if (queuesWithMissingFlow.length > 0) {
      console.log("\n⚠️  Validation Error: Cannot copy queues\n");
      console.log("The following queues reference outbound whisper flows that don't exist in the target instance:\n");

      const sourceFlows = await listContactFlows(sourceClient, sourceInstanceId);
      const sourceFlowsByArn = Object.fromEntries(sourceFlows.map(f => [f.Arn, f]));

      for (const queue of queuesWithMissingFlow) {
        const flowArn = queue.OutboundCallerConfig?.OutboundFlowId;
        const flowName = sourceFlowsByArn[flowArn!]?.Name ?? flowArn;
        console.log(`  - "${queue.Name}" → Outbound Flow: "${flowName}"`);
      }

      console.log("\nTo resolve this issue:");
      console.log("  • Run copy (flow copy) first, OR");
      console.log("  • Use --skip-outbound-flow flag, OR");
      console.log("  • Exclude these queues using filters in your source config\n");

      return { actions: [], queues: [], hooMapping, flowMapping, phoneMapping, queuesWithUnmappedPhones: [] };
    }
  }

  // Track queues with unmapped phone numbers (for warning at end)
  const queuesWithUnmappedPhones: string[] = [];

  for (const queue of sourceQueueDetails) {
    const phoneId = queue.OutboundCallerConfig?.OutboundCallerIdNumberId;
    if (phoneId && !phoneMapping[phoneId]) {
      queuesWithUnmappedPhones.push(queue.Name);
    }
  }

  // Build comparison actions
  const targetQueuesByName = Object.fromEntries(targetQueues.map(q => [q.Name, q]));
  const actions: QueueAction[] = [];

  for (const sourceQueue of sourceQueueDetails) {
    const targetQueueSummary = targetQueuesByName[sourceQueue.Name!];

    if (!targetQueueSummary) {
      actions.push({
        queueName: sourceQueue.Name!,
        action: "create",
        sourceQueue
      });
      continue;
    }

    const targetQueue = await describeQueue(targetClient, targetInstanceId, targetQueueSummary.Id!);

    const contentMatches = queueContentMatches(sourceQueue, targetQueue, hooMapping, flowMapping, phoneMapping, options.skipOutboundFlow);
    const tagsMatch = CliUtil.recordsMatch(sourceQueue.Tags, targetQueue.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    const action: QueueAction = {
      queueName: sourceQueue.Name!,
      action: actionType,
      sourceQueue,
      targetQueue
    };

    if (targetQueueSummary.Id) action.targetQueueId = targetQueueSummary.Id;
    if (targetQueueSummary.Arn) action.targetQueueArn = targetQueueSummary.Arn;

    actions.push(action);
  }

  return { actions, queues: filteredSourceQueues, hooMapping, flowMapping, phoneMapping, queuesWithUnmappedPhones };
}


function queueContentMatches(source: NoUndefinedVals<Queue>, target: NoUndefinedVals<Queue>, hooMapping: Record<string, string>, flowMapping: Record<string, string>, phoneMapping: Record<string, string>, skipOutboundFlow: boolean): boolean {
  if (source.Description !== target.Description) return false;
  if (source.MaxContacts !== target.MaxContacts) return false;
  if (source.Status !== target.Status) return false;

  // Hours of operation - compare by mapped ID
  if (hooMapping[source.HoursOfOperationId!] !== target.HoursOfOperationId) return false;

  // Outbound caller config - compare OutboundCallerIdName
  const sourceCallerName = source.OutboundCallerConfig?.OutboundCallerIdName;
  const targetCallerName = target.OutboundCallerConfig?.OutboundCallerIdName;
  if (sourceCallerName !== targetCallerName) return false;

  // Outbound caller ID number - compare by mapped ID (only if mapping exists)
  const sourcePhoneId = source.OutboundCallerConfig?.OutboundCallerIdNumberId;
  const targetPhoneId = target.OutboundCallerConfig?.OutboundCallerIdNumberId;

  if (sourcePhoneId && phoneMapping[sourcePhoneId]) {
    if (phoneMapping[sourcePhoneId] !== targetPhoneId) return false;
  }

  // Outbound flow - compare by mapped ARN (if not skipped)
  if (!skipOutboundFlow) {
    const sourceFlowArn = source.OutboundCallerConfig?.OutboundFlowId;
    const targetFlowArn = target.OutboundCallerConfig?.OutboundFlowId;

    if (sourceFlowArn) {
      if (flowMapping[sourceFlowArn] !== targetFlowArn) return false;
    } else if (targetFlowArn) {
      return false;
    }
  }

  return true;
}


export function getQueueDiff(source: NoUndefinedVals<Queue>, target: NoUndefinedVals<Queue>, hooMapping: Record<string, string>, flowMapping: Record<string, string>, phoneMapping: Record<string, string>, skipOutboundFlow: boolean): string[] {
  const diffs: string[] = [];

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? "(none)"} → ${source.Description ?? "(none)"}`);
  }

  if (source.MaxContacts !== target.MaxContacts) {
    diffs.push(`MaxContacts: ${target.MaxContacts ?? "(none)"} → ${source.MaxContacts ?? "(none)"}`);
  }

  if (source.Status !== target.Status) {
    diffs.push(`Status: ${target.Status} → ${source.Status}`);
  }

  if (hooMapping[source.HoursOfOperationId!] !== target.HoursOfOperationId) {
    diffs.push(`HoursOfOperationId: changed`);
  }

  const sourceCallerName = source.OutboundCallerConfig?.OutboundCallerIdName;
  const targetCallerName = target.OutboundCallerConfig?.OutboundCallerIdName;
  if (sourceCallerName !== targetCallerName) {
    diffs.push(`OutboundCallerIdName: ${targetCallerName ?? "(none)"} → ${sourceCallerName ?? "(none)"}`);
  }

  // Outbound caller ID number - only show diff if mapping exists
  const sourcePhoneId = source.OutboundCallerConfig?.OutboundCallerIdNumberId;
  const targetPhoneId = target.OutboundCallerConfig?.OutboundCallerIdNumberId;

  if (sourcePhoneId && phoneMapping[sourcePhoneId]) {
    if (phoneMapping[sourcePhoneId] !== targetPhoneId) {
      diffs.push(`OutboundCallerIdNumberId: changed`);
    }
  }

  if (!skipOutboundFlow) {
    const sourceFlowArn = source.OutboundCallerConfig?.OutboundFlowId;
    const targetFlowArn = target.OutboundCallerConfig?.OutboundFlowId;

    if (sourceFlowArn && flowMapping[sourceFlowArn] !== targetFlowArn) {
      diffs.push(`OutboundFlowId: changed`);
    } else if (!sourceFlowArn && targetFlowArn) {
      diffs.push(`OutboundFlowId: ${targetFlowArn} → (none)`);
    }
  }

  return diffs;
}


export function displayQueuePlan(result: QueueComparisonResult, verbose: boolean, skipOutboundFlow: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateAll = result.actions.filter(a => a.action === "update_all");
  const toUpdateData = result.actions.filter(a => a.action === "update_data");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Queues to create: ${toCreate.length}`);
  console.log(`  Queues to update (all): ${toUpdateAll.length}`);
  console.log(`  Queues to update (data only): ${toUpdateData.length}`);
  console.log(`  Queues to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Queues to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.queues.length}`);

  if (toCreate.length > 0) {
    console.log(`\nQueues to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.queueName}`);
      if (verbose) {
        const queue = action.sourceQueue;
        if (queue.Description) console.log(`      Description: ${queue.Description}`);
        console.log(`      Status: ${queue.Status}`);
        if (queue.MaxContacts) console.log(`      MaxContacts: ${queue.MaxContacts}`);
        if (queue.Tags && Object.keys(queue.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(queue.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nQueues to update (all):`);
    for (const action of toUpdateAll) {
      console.log(`  - ${action.queueName}`);
      if (verbose && action.targetQueue) {
        const diffs = getQueueDiff(action.sourceQueue, action.targetQueue, result.hooMapping, result.flowMapping, result.phoneMapping, skipOutboundFlow);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nQueues to update (data only):`);
    for (const action of toUpdateData) {
      console.log(`  - ${action.queueName}`);
      if (verbose && action.targetQueue) {
        const diffs = getQueueDiff(action.sourceQueue, action.targetQueue, result.hooMapping, result.flowMapping, result.phoneMapping, skipOutboundFlow);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nQueues to update (tags only):`);
    for (const action of toUpdateTags) {
      console.log(`  - ${action.queueName}`);
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nQueues to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.queueName}`);
    }
  }
}
