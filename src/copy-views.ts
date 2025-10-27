

import { readFile } from "fs/promises";
import { createInterface } from "readline";
import { DescribeViewCommand, CreateViewCommand, UpdateViewContentCommand, TagResourceCommand, UntagResourceCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, View } from "@aws-sdk/client-connect";

import { createConnectClient } from "./connect/client.js";
import { listViews } from "./connect/resources.js";
import { matchesFlowFilters } from "./filters.js";
import type { SourceConfig, TargetConfig } from "./validation.js";


export interface CopyViewsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  includeAwsManaged: boolean;
  verbose: boolean;
}


async function promptContinue(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`\n${message} (y/n): `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
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


function viewTagsMatch(sourceView: View, targetView: View): boolean {
  const sourceTags = sourceView.Tags ?? {};
  const targetTags = targetView.Tags ?? {};

  const sourceKeys = Object.keys(sourceTags).sort();
  const targetKeys = Object.keys(targetTags).sort();

  if (sourceKeys.length !== targetKeys.length) return false;

  for (const key of sourceKeys) {
    if (sourceTags[key] !== targetTags[key]) return false;
  }

  return true;
}


export async function copyViews(options: CopyViewsOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig: SourceConfig = JSON.parse(sourceConfigData);
  const targetConfig: TargetConfig = JSON.parse(targetConfigData);

  console.log("Source: " + options.sourceConfig);
  console.log(`  Instance ID: ${sourceConfig.instanceId}`);
  console.log(`  Region: ${sourceConfig.region}`);
  console.log(`  Profile: ${options.sourceProfile}`);

  console.log("\nTarget: " + options.targetConfig);
  console.log(`  Instance ID: ${targetConfig.instanceId}`);
  console.log(`  Region: ${targetConfig.region}`);
  console.log(`  Profile: ${options.targetProfile}`);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("\nGathering view inventories...");

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

  interface ViewAction {
    viewName: string;
    action: 'create' | 'update' | 'skip';
    sourceView: View;
    targetViewId?: string;
    targetViewArn?: string;
    tagsNeedUpdate?: boolean;
  }

  const viewActions: ViewAction[] = [];

  console.log("\nAnalyzing view differences...");

  for (const viewSummary of viewsToCopy) {
    const viewName = viewSummary.Name!;
    const viewIdentifier = viewSummary.Type === 'AWS_MANAGED' ? viewSummary.Arn! : viewSummary.Id!;
    const targetView = targetViewsByName.get(viewName);

    const sourceViewFull = await describeView(sourceClient, sourceConfig.instanceId, viewIdentifier);

    if (!targetView) {
      viewActions.push({
        viewName,
        action: 'create',
        sourceView: sourceViewFull
      });
      if (options.verbose) {
        console.log(`  ${viewName}: Create (does not exist in target)`);
      }

      continue;
    }

    const targetViewIdentifier = targetView.Type === 'AWS_MANAGED' ? targetView.Arn! : targetView.Id!;
    const targetViewFull = await describeView(targetClient, targetConfig.instanceId, targetViewIdentifier);

    const contentMatches = viewContentMatches(sourceViewFull, targetViewFull);
    const tagsMatch = viewTagsMatch(sourceViewFull, targetViewFull);

    if (contentMatches && tagsMatch) {
      viewActions.push({
        viewName,
        action: 'skip',
        sourceView: sourceViewFull,
        targetViewId: targetView.Id!,
        targetViewArn: targetView.Arn!
      });
      if (options.verbose) {
        console.log(`  ${viewName}: Skip (content and tags match)`);
      }

      continue;
    }

    if (contentMatches && !tagsMatch) {
      viewActions.push({
        viewName,
        action: 'skip',
        sourceView: sourceViewFull,
        targetViewId: targetView.Id!,
        targetViewArn: targetView.Arn!,
        tagsNeedUpdate: true
      });
      if (options.verbose) {
        console.log(`  ${viewName}: Update tags only (content matches, tags differ)`);
      }

      continue;
    }

    viewActions.push({
      viewName,
      action: 'update',
      sourceView: sourceViewFull,
      targetViewId: targetView.Id!,
      targetViewArn: targetView.Arn!,
      tagsNeedUpdate: !tagsMatch
    });
    if (options.verbose) {
      console.log(`  ${viewName}: Update (content differs${!tagsMatch ? ', tags differ' : ''})`);
    }
  }

  const copyableActions = viewActions.filter(a => {
    if (a.action === 'skip') return true;

    const viewSummary = viewsToCopy.find(v => v.Name === a.viewName);
    return viewSummary?.Type !== 'AWS_MANAGED';
  });

  const awsManagedFiltered = viewActions.length - copyableActions.length;

  const toCreate = copyableActions.filter(a => a.action === 'create').length;
  const toUpdate = copyableActions.filter(a => a.action === 'update').length;
  const toUpdateTagsOnly = copyableActions.filter(a => a.action === 'skip' && a.tagsNeedUpdate).length;
  const toSkip = copyableActions.filter(a => a.action === 'skip' && !a.tagsNeedUpdate).length;

  console.log(`\nSummary:`);
  console.log(`  Views to create: ${toCreate}`);
  console.log(`  Views to update: ${toUpdate}`);
  if (toUpdateTagsOnly > 0) {
    console.log(`  Views to update tags only: ${toUpdateTagsOnly}`);
  }
  console.log(`  Views to skip: ${toSkip}`);
  if (awsManagedFiltered > 0) {
    console.log(`  AWS managed views filtered: ${awsManagedFiltered}`);
  }
  console.log(`  Total processed: ${viewsToCopy.length}`);

  if (toCreate === 0 && toUpdate === 0 && toUpdateTagsOnly === 0) {
    console.log("\nNo views need to be copied - all views match");
    return;
  }

  const shouldContinue = await promptContinue("Proceed with copying views?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying views...");

  for (const action of copyableActions) {
    if (action.action === 'skip' && !action.tagsNeedUpdate) continue;

    if (action.action === 'create') {
      console.log(`Creating view: ${action.viewName}`);
      await targetClient.send(
        new CreateViewCommand({
          InstanceId: targetConfig.instanceId,
          Name: action.sourceView.Name,
          Description: action.sourceView.Description,
          Status: action.sourceView.Status,
          Content: action.sourceView.Content,
          Tags: action.sourceView.Tags
        })
      );
    }

    if (action.action === 'update') {
      console.log(`Updating view: ${action.viewName}`);
      await targetClient.send(
        new UpdateViewContentCommand({
          InstanceId: targetConfig.instanceId,
          ViewId: action.targetViewId!,
          Status: action.sourceView.Status,
          Content: action.sourceView.Content
        })
      );
    }

    if (action.tagsNeedUpdate) {
      console.log(`Updating tags for view: ${action.viewName}`);

      const sourceTags = action.sourceView.Tags ?? {};
      const targetViewFull = await describeView(targetClient, targetConfig.instanceId, action.targetViewId!);
      const targetTags = targetViewFull.Tags ?? {};

      const tagsToAdd: Record<string, string> = {};
      for (const [key, value] of Object.entries(sourceTags)) {
        if (targetTags[key] !== value) {
          tagsToAdd[key] = value;
        }
      }

      const tagsToRemove = Object.keys(targetTags).filter(key => !(key in sourceTags));

      if (Object.keys(tagsToAdd).length > 0) {
        await targetClient.send(
          new TagResourceCommand({
            resourceArn: action.targetViewArn!,
            tags: tagsToAdd
          })
        );
      }

      if (tagsToRemove.length > 0) {
        await targetClient.send(
          new UntagResourceCommand({
            resourceArn: action.targetViewArn!,
            tagKeys: tagsToRemove
          })
        );
      }
    }
  }

  console.log(`\nCopy complete: ${toCreate} created, ${toUpdate} updated, ${toUpdateTagsOnly} tags updated, ${toSkip} skipped`);
}

