

import { readFile } from "fs/promises";
import { DescribeViewCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, View } from "@aws-sdk/client-connect";

import { createConnectClient } from "./connect/client.js";
import { listViews } from "./connect/resources.js";
import { matchesFlowFilters } from "./filters.js";
import type { ConnectConfig } from "./validation.js";


export interface CopyViewsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  includeAwsManaged: boolean;
  verbose: boolean;
}


async function describeView(client: ConnectClient, instanceId: string, viewId: string): Promise<View> {
  const response = await client.send(
    new DescribeViewCommand({
      InstanceId: instanceId,
      ViewId: viewId
    })
  );

  if (!response.View) {
    throw new Error(`View not found: ${viewId}`);
  }

  return response.View;
}


function viewContentMatches(sourceView: View, targetView: View): boolean {
  const sourceContent = sourceView.Content;
  const targetContent = targetView.Content;

  if (!sourceContent || !targetContent) return false;

  const sourceActions = JSON.stringify(sourceContent.Actions?.sort());
  const targetActions = JSON.stringify(targetContent.Actions?.sort());
  if (sourceActions !== targetActions) return false;

  return sourceContent.InputSchema === targetContent.InputSchema &&
         sourceContent.Template === targetContent.Template;
}


export async function copyViews(options: CopyViewsOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig: ConnectConfig = JSON.parse(sourceConfigData);
  const targetConfig: ConnectConfig = JSON.parse(targetConfigData);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("Gathering view inventories...");

  const sourceViews = await listViews(sourceClient, sourceConfig.instanceId);
  const targetViews = await listViews(targetClient, targetConfig.instanceId);

  console.log(`Source instance has ${sourceViews.length} views`);
  console.log(`Target instance has ${targetViews.length} views`);

  let viewsToCopy = sourceViews;

  if (!options.includeAwsManaged) {
    viewsToCopy = viewsToCopy.filter(view => view.Type !== 'AWS_MANAGED');
    console.log(`Filtered to ${viewsToCopy.length} customer-managed views`);
  }

  if (sourceConfig.viewFilters) {
    viewsToCopy = viewsToCopy.filter(view =>
      matchesFlowFilters(view.Name ?? "", sourceConfig.viewFilters)
    );
    console.log(`After filters: ${viewsToCopy.length} views to copy`);
  }

  if (viewsToCopy.length === 0) {
    console.log("No views to copy");
    return;
  }

  const targetViewsByName = new Map(targetViews.map(v => [v.Name!, v]));

  let toCreate = 0;
  let toUpdate = 0;
  let toSkip = 0;

  console.log("\nAnalyzing view differences...");

  for (const viewSummary of viewsToCopy) {
    const viewName = viewSummary.Name!;
    const viewIdentifier = viewSummary.Type === 'AWS_MANAGED' ? viewSummary.Arn! : viewSummary.Id!;
    const targetView = targetViewsByName.get(viewName);

    const sourceViewFull = await describeView(sourceClient, sourceConfig.instanceId, viewIdentifier);

    if (!targetView) {
      toCreate++;
      if (options.verbose) {
        console.log(`  ${viewName}: Create (does not exist in target)`);
      }

      continue;
    }

    const targetViewIdentifier = targetView.Type === 'AWS_MANAGED' ? targetView.Arn! : targetView.Id!;
    const targetViewFull = await describeView(targetClient, targetConfig.instanceId, targetViewIdentifier);

    if (viewContentMatches(sourceViewFull, targetViewFull)) {
      toSkip++;
      if (options.verbose) {
        console.log(`  ${viewName}: Skip (content matches)`);
      }

      continue;
    }

    toUpdate++;
    if (options.verbose) {
      console.log(`  ${viewName}: Update (content differs)`);
    }
  }

  console.log(`\nSummary:`);
  console.log(`  Views to create: ${toCreate}`);
  console.log(`  Views to update: ${toUpdate}`);
  console.log(`  Views to skip: ${toSkip}`);
  console.log(`  Total processed: ${viewsToCopy.length}`);
}

