
import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";

import { createView, updateViewContent } from "./operations.js";
import { compareViews, displayViewPlan } from "./report.js";

import type { ConnectClient, ViewStatus } from "@aws-sdk/client-connect";
import type { ViewComparisonResult } from "./report.js";


export interface CopyViewsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
}


export async function copyViews(options: CopyViewsOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  console.log("\nAnalyzing view differences...");
  const comparisonResult = await compareViews({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.viewFilters
  });

  displayViewPlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo views need to be copied - all views match");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying views?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying views...");
  await executeViewCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);
}


async function executeViewCopy(targetClient: ConnectClient, targetInstanceId: string, result: ViewComparisonResult, _verbose: boolean) {
  let created = 0;
  let updatedData = 0;
  let updatedTags = 0;

  for (const action of result.actions) {
    if (action.action === "skip") continue;

    if (action.action === "create") {
      console.log(`Creating view: ${action.viewName}`);

      await createView(targetClient, targetInstanceId, {
        Name: action.sourceView.Name!,
        Description: action.sourceView.Description,
        Status: action.sourceView.Status as ViewStatus,
        Content: action.sourceView.Content!,
        Tags: action.sourceView.Tags
      });

      created++;
    }

    if (["update_data", "update_all"].includes(action.action)) {
      console.log(`Updating view: ${action.viewName}`);

      await updateViewContent(
        targetClient,
        targetInstanceId,
        action.targetViewId!,
        action.sourceView.Status as ViewStatus,
        action.sourceView.Content!
      );

      updatedData++;
    }

    if (["update_tags", "update_all"].includes(action.action)) {
      console.log(`Updating tags for view: ${action.viewName}`);

      const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceView.Tags, action.targetView?.Tags);
      await AwsUtil.updateResourceTags(targetClient, action.targetViewArn!, toAdd, toRemove);

      updatedTags++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updatedData} data updated, ${updatedTags} tags updated`);
}
