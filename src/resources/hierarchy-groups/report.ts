
import * as CliUtil from "../../utils/cli-utils.js";

import { listUserHierarchyGroups } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeHierarchyGroup, describeUserHierarchyStructure } from "./operations.js";

import type { HierarchyGroupSummary, HierarchyGroup, HierarchyStructure } from "@aws-sdk/client-connect";


export interface HierarchyGroupAction {
  action: 'create' | 'update_tags' | 'recreate' | 'skip';

  sourceGroup: HierarchyGroup;
  targetGroup?: HierarchyGroup;
}

export interface HierarchyGroupComparisonResult {
  actions: HierarchyGroupAction[];
  groups: HierarchyGroupSummary[];
  groupMapping: Record<string, { targetId: string | undefined; name: string }>;

  hierarchyStructure: HierarchyStructureComparisonResult;
}

// Returns actions sorted by LevelId (parents before children) to ensure correct creation order
export async function compareHierarchyGroups(config: CliUtil.ResourceComparisonConfig, forceRecreate?: boolean, forceStructureUpdate?: boolean): Promise<HierarchyGroupComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const hierarchyStructure = await compareHierarchyStructure(config, forceStructureUpdate);

  if (hierarchyStructure.action === 'abort') {
    return {
      actions: [],
      groups: [],
      groupMapping: {},
      hierarchyStructure
    };
  }

  const sourceGroups = await listUserHierarchyGroups(sourceClient, sourceInstanceId);
  const targetGroups = await listUserHierarchyGroups(targetClient, targetInstanceId);

  const filteredSourceGroups = sourceGroups.filter(group => matchesFlowFilters(group.Name!, filterConfig));

  const filteredSourceGroupData = await Promise.all(filteredSourceGroups.map(group => describeHierarchyGroup(sourceClient, sourceInstanceId, group.Id!)));
  const filteredSourceGroupsById = Object.fromEntries(filteredSourceGroupData.map(data => [data.Id, data]));
  const orphanedSourceGroups = filteredSourceGroupData
    .sort((g1, g2) => +(g1.LevelId ?? 0) - +(g2.LevelId ?? 0))
    .filter(group => group.LevelId !== "1" && !filteredSourceGroupsById[getParentLevel(group)?.Id!]);

  if (orphanedSourceGroups.length > 0) {
    console.log("\n⚠️  Warning: Invalid filter configuration\n");
    console.log("The following groups cannot be copied because their parents are excluded:\n");
    orphanedSourceGroups.forEach(group => console.log(`  - "${group.Name}": parent "${getParentLevel(group)?.Name}" is excluded`));
    console.log("\nPlease adjust your filters to include parent groups.\n");

    return {
      actions: [],
      groups: [],
      groupMapping: {},
      hierarchyStructure
    };
  }

  const targetGroupsByName: Record<string, typeof targetGroups[0]> = Object.fromEntries(targetGroups
    .filter(g => g.Name)
    .map(g => [g.Name, g]));

  const groupMapping = Object.fromEntries(filteredSourceGroups
    .map(group => [group.Id!, {
      name: group.Name!,
      targetId: targetGroupsByName[group.Name!]?.Id
    }]));

  const createActions = filteredSourceGroupData
    .filter(sourceGroup => !targetGroupsByName[sourceGroup.Name!])
    .map(sourceGroup => ({
      action: 'create' as const,
      groupName: sourceGroup.Name!,
      sourceGroup
    }));

  const compareActions = await Promise.all(filteredSourceGroupData
    .filter(sourceGroup => targetGroupsByName[sourceGroup.Name!])
    .map(async (sourceGroup) => {
      const targetGroup = await describeHierarchyGroup(targetClient, targetInstanceId, targetGroupsByName[sourceGroup.Name!]!.Id!);

      const tagsMatch = CliUtil.recordsMatch(sourceGroup.Tags, targetGroup.Tags);
      const parentsMatch = getParentLevel(sourceGroup)?.Name === getParentLevel(targetGroup)?.Name;

      const actionType: 'recreate' | 'update_tags' | 'skip' = (!parentsMatch) ? 'recreate'
        : !tagsMatch ? 'update_tags'
        : 'skip';

      return { action: actionType, groupName: sourceGroup.Name!, sourceGroup, targetGroup };
    }));

  const actions = [...createActions, ...compareActions]
    .sort((a, b) => +(a.sourceGroup.LevelId ?? 0) - +(b.sourceGroup.LevelId ?? 0));

  const comparisonResult = {
    actions,
    groups: filteredSourceGroups,
    groupMapping,
    hierarchyStructure
  };

  const recreateActions = actions.filter(a => a.action === 'recreate') as typeof actions & {action: "recreate"}[];
  if (recreateActions.length > 0 && !forceRecreate) {
    comparisonResult.actions = [];

    console.log("\n[WARNING] Hierarchy group parent mismatches detected\n");
    console.log("The following hierarchy groups have different parent groups in the target instance:\n");

    for (const action of recreateActions) {
      const sourceParent = getParentLevel(action.sourceGroup)?.Name ?? '(none)';
      const targetParent = getParentLevel(action.targetGroup!)?.Name ?? '(none)';
      console.log(`  - "${action.groupName}": source parent "${sourceParent}" → target parent "${targetParent}"`);
    }

    console.log("\nChanging a hierarchy group's parent requires DELETING and RECREATING the group.");
    console.log("This permanently severs the link to existing contacts associated with this group.");
    console.log("See: https://docs.aws.amazon.com/connect/latest/adminguide/agent-hierarchy.html#delete-agent-hierarchy");
    console.log("\nTo proceed with recreation:");
    console.log("  • Add the --force-hierarchy-recreate flag to your command");
    console.log("  • OR exclude these groups using filters in your source config\n");
  }

  return comparisonResult;
}


export interface HierarchyStructureComparisonResult {
  sourceStructure: HierarchyStructure;
  targetStructure: HierarchyStructure;
  action: 'create' | 'update' | 'skip' | 'abort';
}


export async function compareHierarchyStructure(config: CliUtil.ResourceComparisonConfig, forceStructureUpdate?: boolean): Promise<HierarchyStructureComparisonResult> {
  const { sourceClient, targetClient, sourceInstanceId, targetInstanceId } = config;

  const sourceStructure = await describeUserHierarchyStructure(sourceClient, sourceInstanceId);
  const targetStructure = await describeUserHierarchyStructure(targetClient, targetInstanceId);

  const structuresMatch = hierarchyStructuresMatch(sourceStructure, targetStructure);
  const targetIsEmpty = isHierarchyStructureEmpty(targetStructure);

  let action: 'create' | 'update' | 'skip' | 'abort';
  if (targetIsEmpty) {
    action = 'create';
  } else if (!structuresMatch && !forceStructureUpdate) {
    action = 'abort';
    displayStructureMismatchError(sourceStructure, targetStructure);
  } else if (!structuresMatch && forceStructureUpdate) {
    action = 'update';
  } else {
    action = 'skip';
  }

  return {
    sourceStructure,
    targetStructure,
    action
  };
}


function hierarchyStructuresMatch(source: HierarchyStructure, target: HierarchyStructure): boolean {
  return source.LevelOne?.Name === target.LevelOne?.Name &&
         source.LevelTwo?.Name === target.LevelTwo?.Name &&
         source.LevelThree?.Name === target.LevelThree?.Name &&
         source.LevelFour?.Name === target.LevelFour?.Name &&
         source.LevelFive?.Name === target.LevelFive?.Name;
}


function isHierarchyStructureEmpty(structure: HierarchyStructure): boolean {
  return !structure.LevelOne && !structure.LevelTwo && !structure.LevelThree &&
         !structure.LevelFour && !structure.LevelFive;
}


function displayStructureMismatchError(source: HierarchyStructure, target: HierarchyStructure): void {
  console.log("\n⚠️  Warning: Hierarchy structure mismatch detected\n");
  console.log("Source structure levels:");
  if (source.LevelOne) console.log(`  Level 1: ${source.LevelOne.Name}`);
  if (source.LevelTwo) console.log(`  Level 2: ${source.LevelTwo.Name}`);
  if (source.LevelThree) console.log(`  Level 3: ${source.LevelThree.Name}`);
  if (source.LevelFour) console.log(`  Level 4: ${source.LevelFour.Name}`);
  if (source.LevelFive) console.log(`  Level 5: ${source.LevelFive.Name}`);

  console.log("\nTarget structure levels:");
  if (target.LevelOne) console.log(`  Level 1: ${target.LevelOne.Name}`);
  if (target.LevelTwo) console.log(`  Level 2: ${target.LevelTwo.Name}`);
  if (target.LevelThree) console.log(`  Level 3: ${target.LevelThree.Name}`);
  if (target.LevelFour) console.log(`  Level 4: ${target.LevelFour.Name}`);
  if (target.LevelFive) console.log(`  Level 5: ${target.LevelFive.Name}`);

  console.log("\nTo overwrite the target structure:");
  console.log("  • Add the --force-structure-update flag to your command\n");
}


export function displayHierarchyGroupPlan(result: HierarchyGroupComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toRecreate = result.actions.filter(a => a.action === "recreate");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Hierarchy groups to create: ${toCreate.length}`);
  console.log(`  Hierarchy groups to update (tags): ${toUpdateTags.length}`);
  if (toRecreate.length > 0) {
    console.log(`  Hierarchy groups to recreate (parent mismatch): ${toRecreate.length}`);
  }
  console.log(`  Hierarchy groups to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.groups.length}`);

  if (toCreate.length > 0) {
    console.log(`\nHierarchy groups to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.sourceGroup.Name}`);
      if (verbose) {
        const parentName = getParentLevel(action.sourceGroup)?.Name ?? '(none)';
        console.log(`      Parent: ${parentName}`);
        if (action.sourceGroup.Tags && Object.keys(action.sourceGroup.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(action.sourceGroup.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nHierarchy groups to update (tags):`);
    for (const action of toUpdateTags) {
      console.log(`  - ${action.sourceGroup.Name}`);
    }
  }

  if (toRecreate.length > 0) {
    console.log(`\nHierarchy groups requiring RECREATION (parent mismatch):`);
    console.log(`WARNING: Recreation will DELETE and recreate these groups.`);
    console.log(`This may affect user associations and historical reporting data.`);
    for (const action of toRecreate) {
      console.log(`  - ${action.sourceGroup.Name}`);
      if (verbose) {
        const sourceParentName = getParentLevel(action.sourceGroup)?.Name ?? '(none)';
        const targetParentName = getParentLevel(action.targetGroup!)?.Name ?? '(none)';
        console.log(`      Source parent: ${sourceParentName}`);
        console.log(`      Target parent: ${targetParentName}`);
      }
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nHierarchy groups to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.sourceGroup.Name}`);
    }
  }
}


export function getParentLevel(group: HierarchyGroup) {
  const path = group.HierarchyPath;
  if (!path) return undefined;

  const levels = [
    path.LevelOne,
    path.LevelTwo,
    path.LevelThree,
    path.LevelFour,
    path.LevelFive
  ];

  return levels[+group.LevelId! - 2];
}

