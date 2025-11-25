

import type { ConnectClient } from "@aws-sdk/client-connect";
import type { HierarchyGroupAction, HierarchyGroupComparisonResult } from "./report.js";

import * as AwsUtil from "../../utils/aws-utils.js";
import * as CliUtil from "../../utils/cli-utils.js";
import { createConnectClient } from "../../connect/client.js";
import { compareHierarchyGroups, displayHierarchyGroupPlan, getParentLevel } from "./report.js";
import { createHierarchyGroup, updateUserHierarchyStructure, deleteHierarchyGroup } from "./operations.js";


export interface CopyHierarchyGroupsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
  forceHierarchyRecreate?: boolean;
  forceStructureUpdate?: boolean;
}


async function executeHierarchyGroupCopy(targetClient: ConnectClient, targetInstanceId: string, result: HierarchyGroupComparisonResult, verbose: boolean) {

  const toSkip = result.actions.filter(a => a.action === "skip");
  const toRecreate = result.actions.filter(a => a.action === "recreate");
  const toCreate = result.actions.filter(a => a.action === "create");
  const toTag = result.actions.filter(a => a.action === "update_tags");

  // Delete any items that will be recreated first (reverse level order - children before parents):
  for (const recreateOp of toRecreate.sort((a, b) => +(b.sourceGroup.LevelId ?? 0) - +(a.sourceGroup.LevelId ?? 0))) {
    logGroupRecreate(recreateOp, verbose);
    await deleteHierarchyGroup(targetClient, targetInstanceId, recreateOp.targetGroup?.Id!);
  }

  // Used for logging in verbose mode:
  const sourceGroupNameToParentName = Object.fromEntries(result.actions
    .map(op => [op.sourceGroup.Name!, getParentLevel(op.sourceGroup)?.Name]));

  // Build mapping of group names to target IDs (for parent references):
  const nameToTargetId = new Map<string, string>();
  for (const action of result.actions) {
    if (action.targetGroup && action.action !== "recreate") {
      nameToTargetId.set(action.sourceGroup.Name!, action.targetGroup.Id!);
    }
  }

  // Create the new groups (sequential, parents before children):
  const orderedCreates = [...toCreate, ...toRecreate]
    .sort((o1, o2) => +(o1.sourceGroup.LevelId ?? 0) - +(o2.sourceGroup.LevelId ?? 0));

  for (const createOp of orderedCreates) {
    logGroupCreate(createOp, sourceGroupNameToParentName, verbose);

    const sourceParentName = sourceGroupNameToParentName[createOp.sourceGroup.Name!];
    const parentGroupId = sourceParentName ? nameToTargetId.get(sourceParentName) : undefined;

    const config: { Name: string; ParentGroupId?: string; Tags?: Record<string, string> } = {
      Name: createOp.sourceGroup.Name!
    };
    if (parentGroupId !== undefined) config.ParentGroupId = parentGroupId;
    if (Object.keys(createOp.sourceGroup.Tags ?? {}).length) config.Tags = createOp.sourceGroup.Tags!;

    const createdGroup = await createHierarchyGroup(targetClient, targetInstanceId, config);
    nameToTargetId.set(createOp.sourceGroup.Name!, createdGroup.id);
  }

  await Promise.all(toTag.map(async tagOp => {
    logTagsUpdate(tagOp, verbose);

    const { toAdd, toRemove } = CliUtil.getRecordDiff(tagOp.sourceGroup.Tags, tagOp.targetGroup?.Tags);
    await AwsUtil.updateResourceTags(targetClient, tagOp.targetGroup!.Arn!, toAdd, toRemove);
  }));

  console.log(`\nCopy complete: ${toCreate.length} created, ${toTag.length} tag updates, ${toRecreate.length} recreated, ${toSkip.length} skipped`);
}


function logGroupCreate(action: HierarchyGroupAction, sourceGroupNameToParentName: Record<string, string | undefined>, verbose: boolean) {
  console.log(`Creating hierarchy group: ${action.sourceGroup.Name}`);
  if (!verbose) return;

  const parentName = sourceGroupNameToParentName[action.sourceGroup.Name!] ?? "(none)";
  console.log(`  Parent: ${parentName}`);
  console.log(`  Tags: ${!action.sourceGroup.Tags ? "(none)" : Object.entries(action.sourceGroup.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
}


function logGroupRecreate(action: HierarchyGroupAction, verbose: boolean) {
  console.log(`Recreating hierarchy group: ${action.sourceGroup.Name}`);
  if (!verbose) return;

  console.log(`  Parent changed - deleting and recreating`);
}


function logTagsUpdate(action: HierarchyGroupAction, verbose: boolean) {
  console.log(`Updating tags for hierarchy group: ${action.sourceGroup.Name}`);
  if (!verbose) return;

  const tagDiff = CliUtil.getRecordDiff(action.sourceGroup.Tags, action.targetGroup!.Tags);
  if (Object.keys(tagDiff.toAdd).length) console.log(`  Tags to add: ${Object.entries(tagDiff.toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (tagDiff.toRemove.length) console.log(`  Tags to remove: ${tagDiff.toRemove.join(", ")}`);
}


export async function copyHierarchyGroups(options: CopyHierarchyGroupsOptions) {
  const { source: sourceConfig, target: targetConfig } = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("\nAnalyzing hierarchy group differences...");
  const comparisonResult = await compareHierarchyGroups(
    {
      sourceClient,
      targetClient,
      sourceInstanceId: sourceConfig.instanceId,
      targetInstanceId: targetConfig.instanceId,
      filterConfig: sourceConfig.hierarchyGroupFilters
    },
    options.forceHierarchyRecreate,
    options.forceStructureUpdate
  );

  if (comparisonResult.hierarchyStructure.action === 'create') {
    console.log("\n[INFO] Target hierarchy structure is empty - will copy from source");
    if (options.verbose) {
      const s = comparisonResult.hierarchyStructure.sourceStructure;
      console.log("  Structure to apply:");
      if (s.LevelOne) console.log(`    Level 1: ${s.LevelOne.Name}`);
      if (s.LevelTwo) console.log(`    Level 2: ${s.LevelTwo.Name}`);
      if (s.LevelThree) console.log(`    Level 3: ${s.LevelThree.Name}`);
      if (s.LevelFour) console.log(`    Level 4: ${s.LevelFour.Name}`);
      if (s.LevelFive) console.log(`    Level 5: ${s.LevelFive.Name}`);
    }
  } else if (comparisonResult.hierarchyStructure.action === 'update') {
    console.log("\n[INFO] Target hierarchy structure differs - will update");
    if (options.verbose) {
      const s = comparisonResult.hierarchyStructure.sourceStructure;
      console.log("  Structure to apply:");
      if (s.LevelOne) console.log(`    Level 1: ${s.LevelOne.Name}`);
      if (s.LevelTwo) console.log(`    Level 2: ${s.LevelTwo.Name}`);
      if (s.LevelThree) console.log(`    Level 3: ${s.LevelThree.Name}`);
      if (s.LevelFour) console.log(`    Level 4: ${s.LevelFour.Name}`);
      if (s.LevelFive) console.log(`    Level 5: ${s.LevelFive.Name}`);
    }
  } else if (comparisonResult.hierarchyStructure.action === 'skip') {
    console.log("\n[INFO] Hierarchy structures match");
    if (options.verbose) {
      const s = comparisonResult.hierarchyStructure.sourceStructure;
      console.log("  Current structure:");
      if (s.LevelOne) console.log(`    Level 1: ${s.LevelOne.Name}`);
      if (s.LevelTwo) console.log(`    Level 2: ${s.LevelTwo.Name}`);
      if (s.LevelThree) console.log(`    Level 3: ${s.LevelThree.Name}`);
      if (s.LevelFour) console.log(`    Level 4: ${s.LevelFour.Name}`);
      if (s.LevelFive) console.log(`    Level 5: ${s.LevelFive.Name}`);
    }
  }

  displayHierarchyGroupPlan(comparisonResult, options.verbose);

  if (comparisonResult.hierarchyStructure.action === 'abort') {
    console.log("\nCopy aborted");
    return;
  }

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");
  const needsStructureUpdate = comparisonResult.hierarchyStructure.action !== 'skip';

  if (!needsCopy && !needsStructureUpdate) {
    console.log("\nNo actions to perform");
    return;
  }

  const shouldContinue = await CliUtil.promptContinue("Proceed with copying hierarchy groups?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  if (needsStructureUpdate) {
    if (comparisonResult.hierarchyStructure.action === 'create') {
      console.log("\nTarget hierarchy structure is empty - copying from source...");
    } else {
      console.log("\nUpdating target hierarchy structure...");
    }

    await updateUserHierarchyStructure(
      targetClient,
      targetConfig.instanceId,
      comparisonResult.hierarchyStructure.sourceStructure
    );

    if (options.verbose) {
      const s = comparisonResult.hierarchyStructure.sourceStructure;
      console.log("Structure updated:");
      if (s.LevelOne) console.log(`  Level 1: ${s.LevelOne.Name}`);
      if (s.LevelTwo) console.log(`  Level 2: ${s.LevelTwo.Name}`);
      if (s.LevelThree) console.log(`  Level 3: ${s.LevelThree.Name}`);
      if (s.LevelFour) console.log(`  Level 4: ${s.LevelFour.Name}`);
      if (s.LevelFive) console.log(`  Level 5: ${s.LevelFive.Name}`);
    }
  }

  console.log("\nCopying hierarchy groups...");

  await executeHierarchyGroupCopy(
    targetClient,
    targetConfig.instanceId,
    comparisonResult,
    options.verbose
  );
}
