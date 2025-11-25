
import type { ConnectClient } from "@aws-sdk/client-connect";

import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";
import { compareAgentStatuses, getAgentStatusDiff, getAgentStatusTagDiff } from "./report.js";
import { createAgentStatus, updateAgentStatus } from "./operations.js";

import type { AgentStatusComparisonResult, AgentStatusAction } from "./report.js";
import type { CreateAgentStatusConfig, UpdateAgentStatusConfig } from "./operations.js";


export interface CopyAgentStatusesOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


export async function copyAgentStatuses(options: CopyAgentStatusesOptions) {
  const { source: sourceConfig, target: targetConfig } = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("\nAnalyzing agent status differences...");
  const comparisonResult = await compareAgentStatuses(
    sourceClient,
    targetClient,
    sourceConfig.instanceId,
    targetConfig.instanceId,
    sourceConfig
  );

  displayAgentStatusPlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo agent statuses need to be copied - all statuses match");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying agent statuses?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying agent statuses...");
  await executeAgentStatusCopy(targetClient, targetConfig.instanceId, comparisonResult, options.verbose);
}


function displayAgentStatusPlan(result: AgentStatusComparisonResult, verbose: boolean) {
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
  console.log(`  Total processed: ${result.statusesToProcess.length}`);

  if (toCreate.length > 0) {
    console.log(`\nAgent statuses to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.statusName}`);
      if (verbose) {
        const status = action.sourceStatus;
        console.log(`      State: ${status.State}`);
        if (status.Description) console.log(`      Description: ${status.Description}`);
        if (status.State === 'ENABLED' && status.DisplayOrder !== undefined) {
          console.log(`      DisplayOrder: ${status.DisplayOrder}`);
        }
        if (status.Tags && Object.keys(status.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(status.Tags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
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
        const tagDiff = getAgentStatusTagDiff(action.sourceStatus, action.targetStatus);
        if (Object.keys(tagDiff.toAdd).length) console.log(`      Tags to add: ${Object.entries(tagDiff.toAdd).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        if (tagDiff.toRemove.length) console.log(`      Tags to remove: ${tagDiff.toRemove.join(', ')}`);
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
        const tagDiff = getAgentStatusTagDiff(action.sourceStatus, action.targetStatus);
        if (Object.keys(tagDiff.toAdd).length) console.log(`      Tags to add: ${Object.entries(tagDiff.toAdd).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        if (tagDiff.toRemove.length) console.log(`      Tags to remove: ${tagDiff.toRemove.join(', ')}`);
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


async function executeAgentStatusCopy(targetClient: ConnectClient, targetInstanceId: string, result: AgentStatusComparisonResult, verbose: boolean) {
  let created = 0;
  let updatedData = 0;
  let updatedTags = 0;

  for (const action of result.actions) {
    if (action.action === "skip") continue;

    if (action.action === "create") {
      logStatusCreate(action, verbose);

      await createAgentStatus(targetClient, targetInstanceId, {
        Name: action.sourceStatus.Name,
        State: action.sourceStatus.State,
        Description: action.sourceStatus.Description,
        DisplayOrder: action.sourceStatus.DisplayOrder,
        Tags: action.sourceStatus.Tags
      } as CreateAgentStatusConfig);
      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      logStatusUpdate(action, verbose);

      // AWS clears DisplayOrder when disabling and rejects setting it on DISABLED statuses
      await updateAgentStatus(targetClient, targetInstanceId, action.targetStatusId!, {
        Name: action.sourceStatus.Name,
        State: action.sourceStatus.State,
        Description: action.sourceStatus.Description,
        ...(action.sourceStatus.State === 'ENABLED' && { DisplayOrder: action.sourceStatus.DisplayOrder })
      } as UpdateAgentStatusConfig);
      updatedData++;
    }

    if (["update_tags", "update_all"].includes(action.action)) {
      logTagsUpdate(action, verbose);

      const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceStatus.Tags, action.targetStatus?.Tags);

      await AwsUtil.updateResourceTags(targetClient, action.targetStatusArn!, toAdd, toRemove);

      updatedTags++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updatedData} data updated, ${updatedTags} tags updated`);
}


function logStatusCreate(action: AgentStatusAction, verbose: boolean) {
  console.log(`Creating agent status: ${action.statusName}`);
  if (!verbose) return;

  const status = action.sourceStatus;
  console.log(`  State: ${status.State}`);
  if (status.Description) console.log(`  Description: ${status.Description}`);
  console.log(`  DisplayOrder: ${status.State === 'ENABLED' && status.DisplayOrder !== undefined ? status.DisplayOrder : "(none)"}`);
  console.log(`  Tags: ${!status.Tags ? "(none)" : Object.entries(status.Tags).map(([k, v]) => `    ${k}=${v}`).join("\n")}`);
}


function logStatusUpdate(action: AgentStatusAction, verbose: boolean) {
  console.log(`Updating agent status: ${action.statusName}`);
  if (!verbose || !action.targetStatus) return;

  const diffs = getAgentStatusDiff(action.sourceStatus, action.targetStatus);
  console.log(`  Diffs: ${diffs.join("\n    ")}`);
}


function logTagsUpdate(action: AgentStatusAction, verbose: boolean) {
  console.log(`Updating tags for agent status: ${action.statusName}`);
  if (!verbose) return;

  console.log(`  Tags: ${!action.sourceStatus.Tags ? "(none)" : Object.entries(action.sourceStatus.Tags).map(([k, v]) => `    ${k}=${v}`).join("\n")}`);
}
