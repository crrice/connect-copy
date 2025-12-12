
import * as CliUtil from "../../utils/cli-utils.js";
import { matchesFlowFilters } from "../../filters.js";
import { listViews, describeView } from "./operations.js";

import type { View, ViewSummary } from "@aws-sdk/client-connect";


export interface ViewAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  viewName: string;
  sourceView: View;
  targetView?: View;
  targetViewId?: string;
  targetViewArn?: string;
  isAwsManaged: boolean;
}


export interface ViewComparisonResult {
  actions: ViewAction[];
  views: ViewSummary[];
  awsManagedSkipped: number;
}


export async function compareViews(config: CliUtil.ResourceComparisonConfig): Promise<ViewComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceViews = await listViews(sourceClient, sourceInstanceId);
  const targetViews = await listViews(targetClient, targetInstanceId);

  const filteredSourceViews = sourceViews.filter(view => matchesFlowFilters(view.Name!, filterConfig));

  const targetViewsByName = new Map(targetViews.map(v => [v.Name!, v]));

  const actions: ViewAction[] = [];
  let awsManagedSkipped = 0;

  for (const viewSummary of filteredSourceViews) {
    const viewName = viewSummary.Name!;
    const isAwsManaged = viewSummary.Type === "AWS_MANAGED";
    const viewIdentifier = isAwsManaged ? viewSummary.Arn! : viewSummary.Id!;

    const sourceViewFull = await describeView(sourceClient, sourceInstanceId, viewIdentifier);
    const targetViewSummary = targetViewsByName.get(viewName);

    if (!targetViewSummary) {
      if (isAwsManaged) {
        // AWS-managed views cannot be created - skip silently
        awsManagedSkipped++;
        continue;
      }

      actions.push({
        viewName,
        action: "create",
        sourceView: sourceViewFull,
        isAwsManaged: false
      });

      continue;
    }

    const targetViewIdentifier = targetViewSummary.Type === "AWS_MANAGED" ? targetViewSummary.Arn! : targetViewSummary.Id!;
    const targetViewFull = await describeView(targetClient, targetInstanceId, targetViewIdentifier);

    const contentMatches = viewContentMatches(sourceViewFull, targetViewFull);
    const tagsMatch = CliUtil.recordsMatch(sourceViewFull.Tags, targetViewFull.Tags);

    if (contentMatches && tagsMatch) {
      actions.push({
        viewName,
        action: "skip",
        sourceView: sourceViewFull,
        targetView: targetViewFull,
        targetViewId: targetViewSummary.Id!,
        targetViewArn: targetViewSummary.Arn!,
        isAwsManaged
      });

      continue;
    }

    // AWS-managed views can only have tags updated, not content
    if (isAwsManaged) {
      if (!tagsMatch) {
        actions.push({
          viewName,
          action: "update_tags",
          sourceView: sourceViewFull,
          targetView: targetViewFull,
          targetViewId: targetViewSummary.Id!,
          targetViewArn: targetViewSummary.Arn!,
          isAwsManaged: true
        });
      } else {
        actions.push({
          viewName,
          action: "skip",
          sourceView: sourceViewFull,
          targetView: targetViewFull,
          targetViewId: targetViewSummary.Id!,
          targetViewArn: targetViewSummary.Arn!,
          isAwsManaged: true
        });
      }

      if (!contentMatches) {
        awsManagedSkipped++;
      }

      continue;
    }

    // Customer-managed views
    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : "update_tags";

    actions.push({
      viewName,
      action: actionType,
      sourceView: sourceViewFull,
      targetView: targetViewFull,
      targetViewId: targetViewSummary.Id!,
      targetViewArn: targetViewSummary.Arn!,
      isAwsManaged: false
    });
  }

  return { actions, views: filteredSourceViews, awsManagedSkipped };
}


function viewContentMatches(source: View, target: View): boolean {
  const sourceContent = source.Content;
  const targetContent = target.Content;

  if (!sourceContent || !targetContent) return false;

  if (!jsonStructureEquals(sourceContent.Actions, targetContent.Actions)) return false;
  if (!jsonStringStructureEquals(sourceContent.InputSchema, targetContent.InputSchema)) return false;
  if (!jsonStringStructureEquals(sourceContent.Template, targetContent.Template)) return false;

  return true;
}


function jsonStringStructureEquals(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;

  return jsonStructureEquals(JSON.parse(a), JSON.parse(b));
}


function jsonStructureEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => jsonStructureEquals(item, b[index]));
  }

  if (typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();

    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((key, i) => key === bKeys[i])) return false;

    return aKeys.every(key => jsonStructureEquals(aObj[key], bObj[key]));
  }

  return false;
}


export function displayViewPlan(result: ViewComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateAll = result.actions.filter(a => a.action === "update_all");
  const toUpdateData = result.actions.filter(a => a.action === "update_data");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Views to create: ${toCreate.length}`);
  console.log(`  Views to update (all): ${toUpdateAll.length}`);
  console.log(`  Views to update (data only): ${toUpdateData.length}`);
  console.log(`  Views to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Views to skip (identical): ${toSkip.length}`);
  if (result.awsManagedSkipped > 0) {
    console.log(`  AWS-managed views skipped (cannot create/update content): ${result.awsManagedSkipped}`);
  }
  console.log(`  Total processed: ${result.views.length}`);

  if (toCreate.length > 0) {
    console.log(`\nViews to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.viewName}`);
      if (verbose && action.sourceView.Description) {
        console.log(`      Description: ${action.sourceView.Description}`);
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nViews to update (all):`);
    for (const action of toUpdateAll) {
      console.log(`  - ${action.viewName}`);
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nViews to update (data only):`);
    for (const action of toUpdateData) {
      console.log(`  - ${action.viewName}`);
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nViews to update (tags only):`);
    for (const action of toUpdateTags) {
      const suffix = action.isAwsManaged ? " (AWS-managed)" : "";
      console.log(`  - ${action.viewName}${suffix}`);
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nViews to skip (identical):`);
    for (const action of toSkip) {
      const suffix = action.isAwsManaged ? " (AWS-managed)" : "";
      console.log(`  - ${action.viewName}${suffix}`);
    }
  }
}
