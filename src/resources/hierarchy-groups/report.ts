
import type { ConnectClient, HierarchyGroupSummary, HierarchyGroup } from "@aws-sdk/client-connect";
import { listUserHierarchyGroups } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeHierarchyGroup, getParentGroupIdFromPath } from "./operations.js";

import type { SourceConfig } from "../../validation.js";


export interface HierarchyGroupAction {
  groupName: string;
  action: 'create' | 'update' | 'recreate' | 'skip';
  sourceGroup: HierarchyGroup;
  targetGroup?: HierarchyGroup;
  targetGroupId?: string;
  targetGroupArn?: string;
  tagsNeedUpdate?: boolean;
  parentMismatch?: boolean;
  sourceParentId?: string;
  targetParentId?: string;
}


export interface HierarchyGroupComparisonResult {
  actions: HierarchyGroupAction[];
  groupsToProcess: HierarchyGroupSummary[];
  hasParentMismatches: boolean;
}


function hierarchyGroupContentMatches(source: HierarchyGroup, target: HierarchyGroup): boolean {
  return source.Name === target.Name;
}


function hierarchyGroupTagsMatch(source: HierarchyGroup, target: HierarchyGroup): boolean {
  const sourceTags = source.Tags ?? {};
  const targetTags = target.Tags ?? {};

  const sourceKeys = Object.keys(sourceTags).sort();
  const targetKeys = Object.keys(targetTags).sort();

  if (sourceKeys.length !== targetKeys.length) return false;

  for (const key of sourceKeys) {
    if (sourceTags[key] !== targetTags[key]) return false;
  }

  return true;
}


export function getHierarchyGroupDiff(source: HierarchyGroup, target: HierarchyGroup): string[] {
  const diffs: string[] = [];

  if (source.Name !== target.Name) {
    diffs.push(`Name: ${target.Name} → ${source.Name}`);
  }

  return diffs;
}


export function getHierarchyGroupTagDiff(source: HierarchyGroup, target: HierarchyGroup): { toAdd: string[]; toRemove: string[] } {
  const sourceTags = source.Tags ?? {};
  const targetTags = target.Tags ?? {};

  const sourceKeys = new Set(Object.keys(sourceTags));
  const targetKeys = new Set(Object.keys(targetTags));

  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const key of sourceKeys) {
    if (!targetKeys.has(key) || sourceTags[key] !== targetTags[key]) {
      toAdd.push(`${key}=${sourceTags[key]}`);
    }
  }

  for (const key of targetKeys) {
    if (!sourceKeys.has(key)) {
      toRemove.push(key);
    }
  }

  return { toAdd, toRemove };
}


export function getParentName(group: HierarchyGroup): string {
  const path = group.HierarchyPath;
  if (!path) return '(none)';

  const levels = [
    path.LevelOne,
    path.LevelTwo,
    path.LevelThree,
    path.LevelFour,
    path.LevelFive
  ].filter(level => level !== undefined);

  if (levels.length <= 1) return '(none)';

  return levels[levels.length - 2]!.Name ?? '(unknown)';
}


export async function compareHierarchyGroups(sourceClient: ConnectClient, targetClient: ConnectClient, sourceInstanceId: string, targetInstanceId: string, sourceConfig: SourceConfig): Promise<HierarchyGroupComparisonResult> {
  const sourceGroups = await listUserHierarchyGroups(sourceClient, sourceInstanceId);
  const targetGroups = await listUserHierarchyGroups(targetClient, targetInstanceId);

  const filteredSourceGroups = sourceConfig.hierarchyGroupFilters
    ? sourceGroups.filter(group => matchesFlowFilters(group.Name!, sourceConfig.hierarchyGroupFilters!))
    : sourceGroups;

  const filteredGroupNames = new Set(filteredSourceGroups.map(g => g.Name));
  const allSourceGroupsMap = new Map(sourceGroups.map(g => [g.Id!, g]));

  for (const filteredGroup of filteredSourceGroups) {
    const fullGroup = await describeHierarchyGroup(sourceClient, sourceInstanceId, filteredGroup.Id!);
    const parentId = getParentGroupIdFromPath(fullGroup);

    if (parentId) {
      const parentGroup = allSourceGroupsMap.get(parentId);
      if (parentGroup && !filteredGroupNames.has(parentGroup.Name)) {
        throw new Error(`Hierarchy group "${filteredGroup.Name}" cannot be copied because its parent "${parentGroup.Name}" is excluded by filters. Either include the parent or exclude the child.`);
      }
    }
  }

  const targetGroupsByName = new Map<string, HierarchyGroupSummary>();
  for (const group of targetGroups) {
    if (group.Name) {
      targetGroupsByName.set(group.Name, group);
    }
  }

  const actions: HierarchyGroupAction[] = [];
  let hasParentMismatches = false;

  for (const sourceSummary of filteredSourceGroups) {
    const sourceGroup = await describeHierarchyGroup(sourceClient, sourceInstanceId, sourceSummary.Id!);
    const sourceParentId = getParentGroupIdFromPath(sourceGroup);
    const targetSummary = targetGroupsByName.get(sourceSummary.Name!);

    if (!targetSummary) {
      const action: HierarchyGroupAction = {
        groupName: sourceSummary.Name!,
        action: 'create',
        sourceGroup
      };
      if (sourceParentId !== undefined) {
        action.sourceParentId = sourceParentId;
      }
      actions.push(action);
      continue;
    }

    const targetGroup = await describeHierarchyGroup(targetClient, targetInstanceId, targetSummary.Id!);
    const targetParentId = getParentGroupIdFromPath(targetGroup);

    const contentMatches = hierarchyGroupContentMatches(sourceGroup, targetGroup);
    const tagsMatch = hierarchyGroupTagsMatch(sourceGroup, targetGroup);
    const parentsMatch = sourceParentId === targetParentId;

    if (!parentsMatch) {
      hasParentMismatches = true;
      const action: HierarchyGroupAction = {
        groupName: sourceSummary.Name!,
        action: 'recreate',
        sourceGroup,
        targetGroup,
        parentMismatch: true
      };
      if (targetSummary.Id !== undefined) action.targetGroupId = targetSummary.Id;
      if (targetSummary.Arn !== undefined) action.targetGroupArn = targetSummary.Arn;
      if (sourceParentId !== undefined) action.sourceParentId = sourceParentId;
      if (targetParentId !== undefined) action.targetParentId = targetParentId;
      actions.push(action);
      continue;
    }

    if (!contentMatches || !tagsMatch) {
      const action: HierarchyGroupAction = {
        groupName: sourceSummary.Name!,
        action: 'update',
        sourceGroup,
        targetGroup,
        tagsNeedUpdate: !tagsMatch
      };
      if (targetSummary.Id !== undefined) action.targetGroupId = targetSummary.Id;
      if (targetSummary.Arn !== undefined) action.targetGroupArn = targetSummary.Arn;
      actions.push(action);
      continue;
    }

    const skipAction: HierarchyGroupAction = {
      groupName: sourceSummary.Name!,
      action: 'skip',
      sourceGroup,
      targetGroup
    };
    if (targetSummary.Id !== undefined) skipAction.targetGroupId = targetSummary.Id;
    if (targetSummary.Arn !== undefined) skipAction.targetGroupArn = targetSummary.Arn;
    actions.push(skipAction);
  }

  return {
    actions,
    groupsToProcess: filteredSourceGroups,
    hasParentMismatches
  };
}
