
import {
  ListQueuesCommand,
  ListPromptsCommand,
  ListRoutingProfilesCommand,
  ListHoursOfOperationsCommand,
  ListQuickConnectsCommand,
  ListSecurityProfilesCommand,
  ListUserHierarchyGroupsCommand,
  ListAgentStatusesCommand
} from "@aws-sdk/client-connect";

import type {
  ConnectClient,
  QueueSummary,
  PromptSummary,
  RoutingProfileSummary,
  HoursOfOperationSummary,
  QuickConnectSummary,
  SecurityProfileSummary,
  HierarchyGroupSummary,
  AgentStatusSummary
} from "@aws-sdk/client-connect";

import type { ResourceInventory } from "../mapping.js";


export async function listQueues(client: ConnectClient, instanceId: string): Promise<QueueSummary[]> {
  const queues: QueueSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListQueuesCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.QueueSummaryList) {
      queues.push(...response.QueueSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return queues;
}


export async function listPrompts(client: ConnectClient, instanceId: string): Promise<PromptSummary[]> {
  const prompts: PromptSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListPromptsCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.PromptSummaryList) {
      prompts.push(...response.PromptSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return prompts;
}


export async function listRoutingProfiles(client: ConnectClient, instanceId: string): Promise<RoutingProfileSummary[]> {
  const routingProfiles: RoutingProfileSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListRoutingProfilesCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.RoutingProfileSummaryList) {
      routingProfiles.push(...response.RoutingProfileSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return routingProfiles;
}


export async function listHoursOfOperations(client: ConnectClient, instanceId: string): Promise<HoursOfOperationSummary[]> {
  const hoursOfOperations: HoursOfOperationSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListHoursOfOperationsCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.HoursOfOperationSummaryList) {
      hoursOfOperations.push(...response.HoursOfOperationSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return hoursOfOperations;
}


export async function listQuickConnects(client: ConnectClient, instanceId: string): Promise<QuickConnectSummary[]> {
  const quickConnects: QuickConnectSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListQuickConnectsCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.QuickConnectSummaryList) {
      quickConnects.push(...response.QuickConnectSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return quickConnects;
}


export async function listSecurityProfiles(client: ConnectClient, instanceId: string): Promise<SecurityProfileSummary[]> {
  const securityProfiles: SecurityProfileSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListSecurityProfilesCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.SecurityProfileSummaryList) {
      securityProfiles.push(...response.SecurityProfileSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return securityProfiles;
}


export async function listUserHierarchyGroups(client: ConnectClient, instanceId: string): Promise<HierarchyGroupSummary[]> {
  const hierarchyGroups: HierarchyGroupSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListUserHierarchyGroupsCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.UserHierarchyGroupSummaryList) {
      hierarchyGroups.push(...response.UserHierarchyGroupSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return hierarchyGroups;
}


export async function listAgentStatuses(client: ConnectClient, instanceId: string): Promise<AgentStatusSummary[]> {
  const agentStatuses: AgentStatusSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListAgentStatusesCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.AgentStatusSummaryList) {
      agentStatuses.push(...response.AgentStatusSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return agentStatuses;
}


export async function gatherResourceInventory(client: ConnectClient, instanceId: string): Promise<ResourceInventory> {
  return {
    queues: await listQueues(client, instanceId),
    prompts: await listPrompts(client, instanceId),
    routingProfiles: await listRoutingProfiles(client, instanceId),
    hoursOfOperations: await listHoursOfOperations(client, instanceId),
    quickConnects: await listQuickConnects(client, instanceId),
    securityProfiles: await listSecurityProfiles(client, instanceId),
    hierarchyGroups: await listUserHierarchyGroups(client, instanceId),
    agentStatuses: await listAgentStatuses(client, instanceId)
  };
}
