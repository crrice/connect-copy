
import {
  ListRoutingProfilesCommand,
  ListQueuesCommand,
  DescribeRoutingProfileCommand,
  ListRoutingProfileQueuesCommand,
  CreateRoutingProfileCommand,
  UpdateRoutingProfileNameCommand,
  UpdateRoutingProfileConcurrencyCommand,
  UpdateRoutingProfileDefaultOutboundQueueCommand,
  UpdateRoutingProfileAgentAvailabilityTimerCommand,
  AssociateRoutingProfileQueuesCommand,
  DisassociateRoutingProfileQueuesCommand,
  UpdateRoutingProfileQueuesCommand
} from "@aws-sdk/client-connect";

import type {
  ConnectClient,
  RoutingProfile,
  RoutingProfileSummary,
  RoutingProfileQueueConfigSummary,
  QueueSummary,
  MediaConcurrency,
  RoutingProfileQueueConfig,
  RoutingProfileQueueReference
} from "@aws-sdk/client-connect";


export async function listRoutingProfiles(client: ConnectClient, instanceId: string): Promise<RoutingProfileSummary[]> {
  const profiles: RoutingProfileSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListRoutingProfilesCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.RoutingProfileSummaryList) {
      profiles.push(...response.RoutingProfileSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return profiles;
}


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


export async function describeRoutingProfile(client: ConnectClient, instanceId: string, routingProfileId: string): Promise<RoutingProfile> {
  const response = await client.send(
    new DescribeRoutingProfileCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId
    })
  );

  if (!response.RoutingProfile?.Name) {
    throw new Error(`Routing profile not found: ${routingProfileId}`);
  }

  return response.RoutingProfile;
}


export async function listRoutingProfileQueues(client: ConnectClient, instanceId: string, routingProfileId: string): Promise<RoutingProfileQueueConfigSummary[]> {
  const queues: RoutingProfileQueueConfigSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListRoutingProfileQueuesCommand({
        InstanceId: instanceId,
        RoutingProfileId: routingProfileId,
        NextToken: nextToken
      })
    );

    if (response.RoutingProfileQueueConfigSummaryList) {
      queues.push(...response.RoutingProfileQueueConfigSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return queues;
}


export interface CreateRoutingProfileConfig {
  Name: string;
  Description: string;
  DefaultOutboundQueueId: string;
  MediaConcurrencies: MediaConcurrency[];
  QueueConfigs?: RoutingProfileQueueConfig[] | undefined;
  AgentAvailabilityTimer?: string | undefined;
  Tags?: Record<string, string> | undefined;
}


export async function createRoutingProfile(client: ConnectClient, instanceId: string, config: CreateRoutingProfileConfig): Promise<{ id: string; arn: string }> {
  const response = await client.send(
    new CreateRoutingProfileCommand({
      InstanceId: instanceId,
      Name: config.Name,
      Description: config.Description,
      DefaultOutboundQueueId: config.DefaultOutboundQueueId,
      MediaConcurrencies: config.MediaConcurrencies,
      QueueConfigs: config.QueueConfigs,
      AgentAvailabilityTimer: config.AgentAvailabilityTimer as "TIME_SINCE_LAST_ACTIVITY" | "TIME_SINCE_LAST_INBOUND" | undefined,
      Tags: config.Tags
    })
  );

  return {
    id: response.RoutingProfileId!,
    arn: response.RoutingProfileArn!
  };
}


export async function updateRoutingProfileName(client: ConnectClient, instanceId: string, routingProfileId: string, name: string, description: string): Promise<void> {
  await client.send(
    new UpdateRoutingProfileNameCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      Name: name,
      Description: description
    })
  );
}


export async function updateRoutingProfileConcurrency(client: ConnectClient, instanceId: string, routingProfileId: string, mediaConcurrencies: MediaConcurrency[]): Promise<void> {
  await client.send(
    new UpdateRoutingProfileConcurrencyCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      MediaConcurrencies: mediaConcurrencies
    })
  );
}


export async function updateRoutingProfileDefaultOutboundQueue(client: ConnectClient, instanceId: string, routingProfileId: string, queueId: string): Promise<void> {
  await client.send(
    new UpdateRoutingProfileDefaultOutboundQueueCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      DefaultOutboundQueueId: queueId
    })
  );
}


export async function updateRoutingProfileAgentAvailabilityTimer(client: ConnectClient, instanceId: string, routingProfileId: string, timer: string): Promise<void> {
  await client.send(
    new UpdateRoutingProfileAgentAvailabilityTimerCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      AgentAvailabilityTimer: timer as "TIME_SINCE_LAST_ACTIVITY" | "TIME_SINCE_LAST_INBOUND"
    })
  );
}


export async function associateRoutingProfileQueues(client: ConnectClient, instanceId: string, routingProfileId: string, queueConfigs: RoutingProfileQueueConfig[]): Promise<void> {
  await client.send(
    new AssociateRoutingProfileQueuesCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      QueueConfigs: queueConfigs
    })
  );
}


export async function disassociateRoutingProfileQueues(client: ConnectClient, instanceId: string, routingProfileId: string, queueReferences: RoutingProfileQueueReference[]): Promise<void> {
  await client.send(
    new DisassociateRoutingProfileQueuesCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      QueueReferences: queueReferences
    })
  );
}


export async function updateRoutingProfileQueues(client: ConnectClient, instanceId: string, routingProfileId: string, queueConfigs: RoutingProfileQueueConfig[]): Promise<void> {
  await client.send(
    new UpdateRoutingProfileQueuesCommand({
      InstanceId: instanceId,
      RoutingProfileId: routingProfileId,
      QueueConfigs: queueConfigs
    })
  );
}

