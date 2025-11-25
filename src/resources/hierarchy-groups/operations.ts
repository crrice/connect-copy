
import { DescribeUserHierarchyGroupCommand, CreateUserHierarchyGroupCommand, DescribeUserHierarchyStructureCommand, UpdateUserHierarchyStructureCommand, DeleteUserHierarchyGroupCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, HierarchyGroup, HierarchyStructure } from "@aws-sdk/client-connect";


function removeUndefined<T extends Record<string, any>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj)
    .filter(([_, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}


export interface CreateHierarchyGroupConfig {
  Name: string;
  ParentGroupId?: string | undefined;
  Tags?: Record<string, string> | undefined;
}


export async function describeHierarchyGroup(client: ConnectClient, instanceId: string, hierarchyGroupId: string) {
  const response = await client.send(
    new DescribeUserHierarchyGroupCommand({
      InstanceId: instanceId,
      HierarchyGroupId: hierarchyGroupId
    })
  );

  if (!response.HierarchyGroup?.Name) {
    throw new Error(`Hierarchy group not found: ${hierarchyGroupId}`);
  }

  return removeUndefined(response.HierarchyGroup) as NoUndefinedVals<HierarchyGroup> & { Name: string };
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


export async function deleteHierarchyGroup(client: ConnectClient, instanceId: string, groupId: string): Promise<void> {
  await client.send(new DeleteUserHierarchyGroupCommand({
    InstanceId: instanceId,
    HierarchyGroupId: groupId,
  }));
}


export async function describeUserHierarchyStructure(client: ConnectClient, instanceId: string): Promise<HierarchyStructure> {
  const response = await client.send(
    new DescribeUserHierarchyStructureCommand({
      InstanceId: instanceId
    })
  );

  return response.HierarchyStructure ?? {};
}


export async function updateUserHierarchyStructure(client: ConnectClient, instanceId: string, structure: HierarchyStructure): Promise<void> {
  const structureUpdate = {
    LevelOne: structure.LevelOne?.Name ? { Name: structure.LevelOne.Name } : undefined,
    LevelTwo: structure.LevelTwo?.Name ? { Name: structure.LevelTwo.Name } : undefined,
    LevelThree: structure.LevelThree?.Name ? { Name: structure.LevelThree.Name } : undefined,
    LevelFour: structure.LevelFour?.Name ? { Name: structure.LevelFour.Name } : undefined,
    LevelFive: structure.LevelFive?.Name ? { Name: structure.LevelFive.Name } : undefined
  };

  await client.send(
    new UpdateUserHierarchyStructureCommand({
      InstanceId: instanceId,
      HierarchyStructure: structureUpdate
    })
  );
}
