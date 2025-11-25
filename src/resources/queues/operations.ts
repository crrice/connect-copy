
import {
  ListQueuesCommand,
  DescribeQueueCommand,
  CreateQueueCommand,
  UpdateQueueNameCommand,
  UpdateQueueHoursOfOperationCommand,
  UpdateQueueMaxContactsCommand,
  UpdateQueueOutboundCallerConfigCommand,
  UpdateQueueStatusCommand
} from "@aws-sdk/client-connect";

import type { ConnectClient, Queue, QueueSummary } from "@aws-sdk/client-connect";


export async function listStandardQueues(client: ConnectClient, instanceId: string): Promise<QueueSummary[]> {
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


function removeUndefined<T extends Record<string, any>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj)
    .filter(([_, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}


export interface CreateQueueConfig {
  Name: string;
  HoursOfOperationId: string;
  Description?: string | undefined;
  MaxContacts?: number | undefined;
  OutboundCallerConfig?: {
    OutboundCallerIdName?: string | undefined;
    OutboundCallerIdNumberId?: string | undefined;
    OutboundFlowId?: string | undefined;
  } | undefined;
  Tags?: Record<string, string> | undefined;
}


export interface UpdateOutboundCallerConfig {
  OutboundCallerIdName?: string;
  OutboundCallerIdNumberId?: string;
  OutboundFlowId?: string;
}


export async function describeQueue(client: ConnectClient, instanceId: string, queueId: string) {
  const response = await client.send(
    new DescribeQueueCommand({
      InstanceId: instanceId,
      QueueId: queueId
    })
  );

  if (!response.Queue?.Name) {
    throw new Error(`Queue not found: ${queueId}`);
  }

  return removeUndefined(response.Queue) as NoUndefinedVals<Queue> & { Name: string };
}


export async function createQueue(client: ConnectClient, instanceId: string, config: CreateQueueConfig): Promise<{ id: string; arn: string }> {
  const response = await client.send(
    new CreateQueueCommand({
      InstanceId: instanceId,
      Name: config.Name,
      HoursOfOperationId: config.HoursOfOperationId,
      Description: config.Description,
      MaxContacts: config.MaxContacts,
      OutboundCallerConfig: config.OutboundCallerConfig,
      Tags: config.Tags
    })
  );

  return {
    id: response.QueueId!,
    arn: response.QueueArn!
  };
}


export async function updateQueueName(client: ConnectClient, instanceId: string, queueId: string, name: string, description?: string): Promise<void> {
  await client.send(
    new UpdateQueueNameCommand({
      InstanceId: instanceId,
      QueueId: queueId,
      Name: name,
      Description: description
    })
  );
}


export async function updateQueueHoursOfOperation(client: ConnectClient, instanceId: string, queueId: string, hoursOfOperationId: string): Promise<void> {
  await client.send(
    new UpdateQueueHoursOfOperationCommand({
      InstanceId: instanceId,
      QueueId: queueId,
      HoursOfOperationId: hoursOfOperationId
    })
  );
}


export async function updateQueueMaxContacts(client: ConnectClient, instanceId: string, queueId: string, maxContacts: number | undefined): Promise<void> {
  await client.send(
    new UpdateQueueMaxContactsCommand({
      InstanceId: instanceId,
      QueueId: queueId,
      MaxContacts: maxContacts
    })
  );
}


export async function updateQueueOutboundCallerConfig(client: ConnectClient, instanceId: string, queueId: string, config: UpdateOutboundCallerConfig): Promise<void> {
  await client.send(
    new UpdateQueueOutboundCallerConfigCommand({
      InstanceId: instanceId,
      QueueId: queueId,
      OutboundCallerConfig: config
    })
  );
}


export async function updateQueueStatus(client: ConnectClient, instanceId: string, queueId: string, status: "ENABLED" | "DISABLED"): Promise<void> {
  await client.send(
    new UpdateQueueStatusCommand({
      InstanceId: instanceId,
      QueueId: queueId,
      Status: status
    })
  );
}
