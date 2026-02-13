

import {
  ListQuickConnectsCommand,
  DescribeQuickConnectCommand,
  CreateQuickConnectCommand,
  UpdateQuickConnectNameCommand,
  UpdateQuickConnectConfigCommand,
  ListUsersCommand,
  ListQueuesCommand,
  ListContactFlowsCommand,
  ListQueueQuickConnectsCommand,
  AssociateQueueQuickConnectsCommand,
  DisassociateQueueQuickConnectsCommand
} from "@aws-sdk/client-connect";

import type {
  ConnectClient,
  QuickConnectSummary,
  QuickConnect,
  QuickConnectConfig,
  UserSummary,
  QueueSummary,
  ContactFlowSummary
} from "@aws-sdk/client-connect";


export interface CreateQuickConnectConfig {
  Name: string;
  Description?: string | undefined;
  QuickConnectConfig: QuickConnectConfig;
  Tags?: Record<string, string> | undefined;
}


export interface UpdateQuickConnectNameConfig {
  Name?: string | undefined;
  Description?: string | undefined;
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


export async function describeQuickConnect(client: ConnectClient, instanceId: string, quickConnectId: string): Promise<QuickConnect> {
  const response = await client.send(
    new DescribeQuickConnectCommand({
      InstanceId: instanceId,
      QuickConnectId: quickConnectId
    })
  );

  if (!response.QuickConnect) {
    throw new Error(`Quick connect not found: ${quickConnectId}`);
  }

  return response.QuickConnect;
}


export async function createQuickConnect(client: ConnectClient, instanceId: string, config: CreateQuickConnectConfig): Promise<{ id: string; arn: string }> {
  const response = await client.send(
    new CreateQuickConnectCommand({
      InstanceId: instanceId,
      ...config
    })
  );

  return {
    id: response.QuickConnectId!,
    arn: response.QuickConnectARN!
  };
}


export async function updateQuickConnectName(client: ConnectClient, instanceId: string, quickConnectId: string, config: UpdateQuickConnectNameConfig): Promise<void> {
  await client.send(
    new UpdateQuickConnectNameCommand({
      InstanceId: instanceId,
      QuickConnectId: quickConnectId,
      ...config
    })
  );
}


export async function updateQuickConnectConfig(client: ConnectClient, instanceId: string, quickConnectId: string, quickConnectConfig: QuickConnectConfig): Promise<void> {
  await client.send(
    new UpdateQuickConnectConfigCommand({
      InstanceId: instanceId,
      QuickConnectId: quickConnectId,
      QuickConnectConfig: quickConnectConfig
    })
  );
}


export async function listUsers(client: ConnectClient, instanceId: string): Promise<UserSummary[]> {
  const users: UserSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListUsersCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.UserSummaryList) {
      users.push(...response.UserSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return users;
}


export async function listQueues(client: ConnectClient, instanceId: string): Promise<QueueSummary[]> {
  const queues: QueueSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListQueuesCommand({
        InstanceId: instanceId,
        QueueTypes: ["STANDARD"],
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


export async function listContactFlows(client: ConnectClient, instanceId: string): Promise<ContactFlowSummary[]> {
  const flows: ContactFlowSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListContactFlowsCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.ContactFlowSummaryList) {
      flows.push(...response.ContactFlowSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return flows;
}


export async function listQueueQuickConnects(client: ConnectClient, instanceId: string, queueId: string): Promise<QuickConnectSummary[]> {
  const quickConnects: QuickConnectSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListQueueQuickConnectsCommand({
        InstanceId: instanceId,
        QueueId: queueId,
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


export async function associateQueueQuickConnects(client: ConnectClient, instanceId: string, queueId: string, quickConnectIds: string[]): Promise<void> {
  if (quickConnectIds.length === 0) return;

  for (const batch of chunk(quickConnectIds, 50)) {
    await client.send(
      new AssociateQueueQuickConnectsCommand({
        InstanceId: instanceId,
        QueueId: queueId,
        QuickConnectIds: batch
      })
    );
  }
}


function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}


export async function disassociateQueueQuickConnects(client: ConnectClient, instanceId: string, queueId: string, quickConnectIds: string[]): Promise<void> {
  if (quickConnectIds.length === 0) return;

  for (const batch of chunk(quickConnectIds, 50)) {
    await client.send(
      new DisassociateQueueQuickConnectsCommand({
        InstanceId: instanceId,
        QueueId: queueId,
        QuickConnectIds: batch
      })
    );
  }
}
