
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";
import { compareHoursOfOperations, displayHoursOfOperationPlan, getHoursOfOperationDiff } from "./report.js";
import { createHoursOfOperation, updateHoursOfOperation } from "./operations.js";

import type { ConnectClient } from "@aws-sdk/client-connect";
import type { HoursOfOperationComparisonResult, HoursOfOperationAction } from "./report.js";


export interface CopyHoursOfOperationsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


export async function copyHoursOfOperations(options: CopyHoursOfOperationsOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing hours of operation differences...");
  const comparisonResult = await compareHoursOfOperations({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.hoursFilters
  });

  displayHoursOfOperationPlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo hours of operation need to be copied - all hours match");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying hours of operation?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying hours of operation...");
  await executeHoursOfOperationCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);
}


async function executeHoursOfOperationCopy(targetClient: ConnectClient, targetInstanceId: string, result: HoursOfOperationComparisonResult, verbose: boolean) {
  let created = 0;
  let updatedData = 0;
  let updatedTags = 0;

  for (const action of result.actions) {
    if (action.action === "skip") continue;

    if (action.action === "create") {
      logHoursCreate(action, verbose);

      await createHoursOfOperation(targetClient, targetInstanceId, {
        Name: action.sourceHours.Name!,
        TimeZone: action.sourceHours.TimeZone!,
        Config: action.sourceHours.Config!,
        Description: action.sourceHours.Description,
        Tags: action.sourceHours.Tags
      });

      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      logHoursUpdate(action, verbose);

      await updateHoursOfOperation(targetClient, targetInstanceId, action.targetHoursId!, {
        Name: action.sourceHours.Name,
        Description: action.sourceHours.Description,
        TimeZone: action.sourceHours.TimeZone,
        Config: action.sourceHours.Config
      });

      updatedData++;
    }

    if (["update_tags", "update_all"].includes(action.action)) {
      logTagsUpdate(action, verbose);

      const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceHours.Tags, action.targetHours?.Tags);
      await AwsUtil.updateResourceTags(targetClient, action.targetHoursArn!, toAdd, toRemove);

      updatedTags++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updatedData} data updated, ${updatedTags} tags updated`);
}


function logHoursCreate(action: HoursOfOperationAction, verbose: boolean) {
  console.log(`Creating hours of operation: ${action.hoursName}`);
  if (!verbose) return;

  const hours = action.sourceHours;
  console.log(`  TimeZone: ${hours.TimeZone}`);
  if (hours.Description) console.log(`  Description: ${hours.Description}`);
  if (hours.Tags && Object.keys(hours.Tags).length > 0) {
    console.log(`  Tags: ${Object.entries(hours.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
}


function logHoursUpdate(action: HoursOfOperationAction, verbose: boolean) {
  console.log(`Updating hours of operation: ${action.hoursName}`);
  if (!verbose || !action.targetHours) return;

  const diffs = getHoursOfOperationDiff(action.sourceHours, action.targetHours);
  for (const diff of diffs) {
    console.log(`  ${diff}`);
  }
}


function logTagsUpdate(action: HoursOfOperationAction, verbose: boolean) {
  console.log(`Updating tags for hours of operation: ${action.hoursName}`);
  if (!verbose || !action.targetHours) return;

  const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceHours.Tags, action.targetHours.Tags);
  if (Object.keys(toAdd).length) console.log(`  Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (toRemove.length) console.log(`  Tags to remove: ${toRemove.join(", ")}`);
}
