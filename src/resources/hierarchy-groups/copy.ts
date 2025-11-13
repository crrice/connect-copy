
import { readFile } from "fs/promises";
import { createInterface } from "readline";
import { TagResourceCommand, UntagResourceCommand, DeleteUserHierarchyGroupCommand } from "@aws-sdk/client-connect";

import type { ConnectClient } from "@aws-sdk/client-connect";

import { createConnectClient } from "../../connect/client.js";
import { validateSourceConfig, validateTargetConfig } from "../../validation.js";
import { compareHierarchyGroups, getHierarchyGroupDiff, getHierarchyGroupTagDiff, getParentName } from "./report.js";
import { createHierarchyGroup, updateHierarchyGroupName } from "./operations.js";

import type { HierarchyGroupAction, HierarchyGroupComparisonResult } from "./report.js";


export interface CopyHierarchyGroupsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
  forceHierarchyRecreate?: boolean;
}


async function promptContinue(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`\n${message} (y/n): `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}


function sortGroupsByDependency(actions: HierarchyGroupAction[], sourceGroupNameToParentName: Map<string, string | undefined>): HierarchyGroupAction[] {
  const actionsByName = new Map<string, HierarchyGroupAction>();
  for (const action of actions) {
    actionsByName.set(action.groupName, action);
  }

  const visited = new Set<string>();
  const sorted: HierarchyGroupAction[] = [];

  function visit(groupName: string) {
    if (visited.has(groupName)) return;
    visited.add(groupName);

    const parentName = sourceGroupNameToParentName.get(groupName);
    if (parentName && actionsByName.has(parentName)) {
      visit(parentName);
    }

    const action = actionsByName.get(groupName);
    if (action) {
      sorted.push(action);
    }
  }

  for (const action of actions) {
    visit(action.groupName);
  }

  return sorted;
}


function displayHierarchyGroupPlan(result: HierarchyGroupComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdate = result.actions.filter(a => a.action === "update");
  const toRecreate = result.actions.filter(a => a.action === "recreate");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Hierarchy groups to create: ${toCreate.length}`);
  console.log(`  Hierarchy groups to update: ${toUpdate.length}`);
  if (toRecreate.length > 0) {
    console.log(`  Hierarchy groups to recreate (parent mismatch): ${toRecreate.length}`);
  }
  console.log(`  Hierarchy groups to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.groupsToProcess.length}`);

  if (toCreate.length > 0) {
    console.log(`\nHierarchy groups to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.groupName}`);
      if (verbose) {
        const parentName = getParentName(action.sourceGroup);
        console.log(`      Parent: ${parentName}`);
        if (action.sourceGroup.Tags && Object.keys(action.sourceGroup.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(action.sourceGroup.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdate.length > 0) {
    console.log(`\nHierarchy groups to update:`);
    for (const action of toUpdate) {
      console.log(`  - ${action.groupName}`);
      if (verbose && action.targetGroup) {
        const diffs = getHierarchyGroupDiff(action.sourceGroup, action.targetGroup);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
        if (action.tagsNeedUpdate) {
          const tagDiff = getHierarchyGroupTagDiff(action.sourceGroup, action.targetGroup);
          if (tagDiff.toAdd.length > 0) console.log(`      Tags to add: ${tagDiff.toAdd.join(", ")}`);
          if (tagDiff.toRemove.length > 0) console.log(`      Tags to remove: ${tagDiff.toRemove.join(", ")}`);
        }
      }
    }
  }

  if (toRecreate.length > 0) {
    console.log(`\nHierarchy groups requiring RECREATION (parent mismatch):`);
    console.log(`WARNING: Recreation will DELETE and recreate these groups.`);
    console.log(`This may affect user associations and historical reporting data.`);
    for (const action of toRecreate) {
      console.log(`  - ${action.groupName}`);
      if (verbose) {
        const sourceParentName = getParentName(action.sourceGroup);
        const targetParentName = getParentName(action.targetGroup!);
        console.log(`      Source parent: ${sourceParentName}`);
        console.log(`      Target parent: ${targetParentName}`);
      }
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nHierarchy groups to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.groupName}`);
    }
  }
}


async function executeHierarchyGroupCopy(targetClient: ConnectClient, targetInstanceId: string, result: HierarchyGroupComparisonResult, sourceGroupNameToParentName: Map<string, string | undefined>, forceRecreate: boolean, verbose: boolean) {
  const hasRecreateActions = result.actions.some(a => a.action === "recreate");

  if (hasRecreateActions && !forceRecreate) {
    console.error("\n❌ ERROR: Parent mismatches detected.");
    console.error("The following groups have different parents in source vs target:");
    console.error("");
    for (const action of result.actions.filter(a => a.action === "recreate")) {
      console.error(`  - ${action.groupName}`);
      console.error(`    Source parent: ${getParentName(action.sourceGroup)}`);
      console.error(`    Target parent: ${getParentName(action.targetGroup!)}`);
    }
    console.error("");
    console.error("⚠️  Fixing this requires deletion, which PERMANENTLY severs historical contact data.");
    console.error("To proceed with recreation, use --force-hierarchy-recreate flag.");
    console.error("");
    throw new Error("Parent mismatches detected. Use --force-hierarchy-recreate to proceed.");
  }

  const sortedActions = sortGroupsByDependency(result.actions.filter(a => a.action !== "skip"), sourceGroupNameToParentName);

  const nameToTargetId = new Map<string, string>();
  for (const action of result.actions) {
    if (action.targetGroupId && action.action !== "recreate") {
      nameToTargetId.set(action.groupName, action.targetGroupId);
    }
  }

  let created = 0;
  let updated = 0;
  let recreated = 0;
  let tagsUpdated = 0;

  for (const action of sortedActions) {
    if (action.action === "create") {
      const sourceParentName = sourceGroupNameToParentName.get(action.groupName);
      const parentGroupId = sourceParentName ? nameToTargetId.get(sourceParentName) : undefined;

      console.log(`Creating hierarchy group: ${action.groupName}`);
      if (verbose) {
        const parentName = sourceParentName ?? "(none)";
        console.log(`  Parent: ${parentName}`);
        if (action.sourceGroup.Tags && Object.keys(action.sourceGroup.Tags).length > 0) {
          console.log(`  Tags: ${Object.entries(action.sourceGroup.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }

      const config: { Name: string; ParentGroupId?: string; Tags?: Record<string, string> } = {
        Name: action.sourceGroup.Name!
      };
      if (parentGroupId !== undefined) config.ParentGroupId = parentGroupId;
      if (action.sourceGroup.Tags !== undefined) config.Tags = action.sourceGroup.Tags;

      const result = await createHierarchyGroup(targetClient, targetInstanceId, config);

      nameToTargetId.set(action.groupName, result.id);
      created++;
      continue;
    }

    if (action.action === "recreate") {
      console.log(`Recreating hierarchy group: ${action.groupName}`);
      if (verbose) {
        console.log(`  Parent changed - deleting and recreating`);
      }

      await targetClient.send(
        new DeleteUserHierarchyGroupCommand({
          InstanceId: targetInstanceId,
          HierarchyGroupId: action.targetGroupId!
        })
      );

      const sourceParentName = sourceGroupNameToParentName.get(action.groupName);
      const parentGroupId = sourceParentName ? nameToTargetId.get(sourceParentName) : undefined;

      const config: { Name: string; ParentGroupId?: string; Tags?: Record<string, string> } = {
        Name: action.sourceGroup.Name!
      };
      if (parentGroupId !== undefined) config.ParentGroupId = parentGroupId;
      if (action.sourceGroup.Tags !== undefined) config.Tags = action.sourceGroup.Tags;

      const result = await createHierarchyGroup(targetClient, targetInstanceId, config);

      nameToTargetId.set(action.groupName, result.id);
      recreated++;
      continue;
    }

    if (action.action === "update") {
      const diffs = getHierarchyGroupDiff(action.sourceGroup, action.targetGroup!);

      if (diffs.length > 0) {
        console.log(`Updating hierarchy group: ${action.groupName}`);
        if (verbose && action.targetGroup) {
          for (const diff of diffs) {
            console.log(`  ${diff}`);
          }
        }

        await updateHierarchyGroupName(targetClient, targetInstanceId, action.targetGroupId!, {
          Name: action.sourceGroup.Name!
        });

        updated++;
      }

      if (action.tagsNeedUpdate) {
        console.log(`Updating tags for hierarchy group: ${action.groupName}`);

        const sourceTags = action.sourceGroup.Tags ?? {};
        const targetTags = action.targetGroup?.Tags ?? {};

        const tagsToAdd: Record<string, string> = {};
        for (const [key, value] of Object.entries(sourceTags)) {
          if (targetTags[key] !== value) {
            tagsToAdd[key] = value;
          }
        }

        const tagsToRemove = Object.keys(targetTags).filter(key => !(key in sourceTags));

        if (verbose) {
          if (Object.keys(tagsToAdd).length > 0) {
            console.log(`  Tags to add: ${Object.entries(tagsToAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
          }
          if (tagsToRemove.length > 0) {
            console.log(`  Tags to remove: ${tagsToRemove.join(", ")}`);
          }
        }

        if (Object.keys(tagsToAdd).length > 0) {
          await targetClient.send(
            new TagResourceCommand({
              resourceArn: action.targetGroupArn!,
              tags: tagsToAdd
            })
          );
        }

        if (tagsToRemove.length > 0) {
          await targetClient.send(
            new UntagResourceCommand({
              resourceArn: action.targetGroupArn!,
              tagKeys: tagsToRemove
            })
          );
        }

        tagsUpdated++;
      }
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updated} updated, ${recreated} recreated, ${tagsUpdated} tags updated`);
}


export async function copyHierarchyGroups(options: CopyHierarchyGroupsOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig = validateSourceConfig(JSON.parse(sourceConfigData));
  const targetConfig = validateTargetConfig(JSON.parse(targetConfigData));

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

  console.log("\nAnalyzing hierarchy group differences...");
  const comparisonResult = await compareHierarchyGroups(
    sourceClient,
    targetClient,
    sourceConfig.instanceId,
    targetConfig.instanceId,
    sourceConfig
  );

  displayHierarchyGroupPlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo hierarchy groups need to be copied - all groups match");
    return;
  }

  const shouldContinue = await promptContinue("Proceed with copying hierarchy groups?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying hierarchy groups...");

  const sourceGroupNameToParentName = new Map<string, string | undefined>();
  for (const action of comparisonResult.actions) {
    const parentName = getParentName(action.sourceGroup);
    sourceGroupNameToParentName.set(action.groupName, parentName === "(none)" ? undefined : parentName);
  }

  await executeHierarchyGroupCopy(
    targetClient,
    targetConfig.instanceId,
    comparisonResult,
    sourceGroupNameToParentName,
    options.forceHierarchyRecreate ?? false,
    options.verbose
  );
}
