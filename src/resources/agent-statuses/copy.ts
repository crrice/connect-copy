
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";
import { compareAgentStatuses, displayAgentStatusPlan, getAgentStatusDiff } from "./report.js";
import { createAgentStatus, updateAgentStatus } from "./operations.js";

import type { ConnectClient } from "@aws-sdk/client-connect";
import type { AgentStatusComparisonResult, AgentStatusAction } from "./report.js";


export interface CopyAgentStatusesOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


export async function copyAgentStatuses(options: CopyAgentStatusesOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing agent status differences...");
  const comparisonResult = await compareAgentStatuses({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.agentStatusFilters
  });

  displayAgentStatusPlan(comparisonResult, options.verbose);

  const toCreate = comparisonResult.actions.filter(a => a.action === "create");
  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo agent statuses need to be copied - all statuses match");
    return;
  }

  if (toCreate.length > 0) {
    console.log("\n[WARNING] Agent statuses cannot be deleted once created.");
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying agent statuses?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying agent statuses...");
  await executeAgentStatusCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);
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
        Name: action.sourceStatus.Name!,
        State: action.sourceStatus.State as "ENABLED" | "DISABLED",
        Description: action.sourceStatus.Description,
        DisplayOrder: action.sourceStatus.DisplayOrder,
        Tags: action.sourceStatus.Tags
      });

      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      logStatusUpdate(action, verbose);

      // AWS clears DisplayOrder when disabling and rejects setting it on DISABLED statuses
      await updateAgentStatus(targetClient, targetInstanceId, action.targetStatusId!, {
        Name: action.sourceStatus.Name,
        State: action.sourceStatus.State as "ENABLED" | "DISABLED",
        Description: action.sourceStatus.Description,
        ...(action.sourceStatus.State === "ENABLED" && { DisplayOrder: action.sourceStatus.DisplayOrder })
      });

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
  if (status.State === "ENABLED" && status.DisplayOrder !== undefined) {
    console.log(`  DisplayOrder: ${status.DisplayOrder}`);
  }
  if (status.Tags && Object.keys(status.Tags).length > 0) {
    console.log(`  Tags: ${Object.entries(status.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
}


function logStatusUpdate(action: AgentStatusAction, verbose: boolean) {
  console.log(`Updating agent status: ${action.statusName}`);
  if (!verbose || !action.targetStatus) return;

  const diffs = getAgentStatusDiff(action.sourceStatus, action.targetStatus);
  for (const diff of diffs) {
    console.log(`  ${diff}`);
  }
}


function logTagsUpdate(action: AgentStatusAction, verbose: boolean) {
  console.log(`Updating tags for agent status: ${action.statusName}`);
  if (!verbose || !action.targetStatus) return;

  const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceStatus.Tags, action.targetStatus.Tags);
  if (Object.keys(toAdd).length) console.log(`  Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (toRemove.length) console.log(`  Tags to remove: ${toRemove.join(", ")}`);
}
