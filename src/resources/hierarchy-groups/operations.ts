
import { DescribeUserHierarchyGroupCommand, CreateUserHierarchyGroupCommand, UpdateUserHierarchyGroupNameCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, HierarchyGroup } from "@aws-sdk/client-connect";


export interface CreateHierarchyGroupConfig {
  Name: string;
  ParentGroupId?: string;
  Tags?: Record<string, string>;
}


export interface UpdateHierarchyGroupConfig {
  Name: string;
}


export async function describeHierarchyGroup(client: ConnectClient, instanceId: string, hierarchyGroupId: string): Promise<HierarchyGroup> {
  const response = await client.send(
    new DescribeUserHierarchyGroupCommand({
      InstanceId: instanceId,
      HierarchyGroupId: hierarchyGroupId
    })
  );

  if (!response.HierarchyGroup) {
    throw new Error(`Hierarchy group not found: ${hierarchyGroupId}`);
  }

  return response.HierarchyGroup;
}


export async function createHierarchyGroup(client: ConnectClient, instanceId: string, config: CreateHierarchyGroupConfig): Promise<{ id: string; arn: string }> {
  const commandInput: { InstanceId: string; Name: string; ParentGroupId?: string | undefined; Tags?: Record<string, string> | undefined } = {
    InstanceId: instanceId,
    Name: config.Name,
    ParentGroupId: config.ParentGroupId,
    Tags: config.Tags
  };

  const response = await client.send(
    new CreateUserHierarchyGroupCommand(commandInput)
  );

  return {
    id: response.HierarchyGroupId!,
    arn: response.HierarchyGroupArn!
  };
}


export async function updateHierarchyGroupName(client: ConnectClient, instanceId: string, hierarchyGroupId: string, config: UpdateHierarchyGroupConfig): Promise<void> {
  await client.send(
    new UpdateUserHierarchyGroupNameCommand({
      InstanceId: instanceId,
      HierarchyGroupId: hierarchyGroupId,
      ...config
    })
  );
}


export function getParentGroupIdFromPath(group: HierarchyGroup): string | undefined {
  const path = group.HierarchyPath;
  if (!path) return undefined;

  const levels = [
    path.LevelOne,
    path.LevelTwo,
    path.LevelThree,
    path.LevelFour,
    path.LevelFive
  ].filter(level => level !== undefined);

  if (levels.length <= 1) return undefined;

  return levels[levels.length - 2]!.Id;
}
