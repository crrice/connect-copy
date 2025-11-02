
import { DescribeAgentStatusCommand, CreateAgentStatusCommand, UpdateAgentStatusCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, AgentStatus } from "@aws-sdk/client-connect";


export interface CreateAgentStatusConfig {
  Name: string;
  State: "ENABLED" | "DISABLED";
  Description?: string;
  DisplayOrder?: number;
  Tags?: Record<string, string>;
}


export interface UpdateAgentStatusConfig {
  Name?: string;
  State?: "ENABLED" | "DISABLED";
  Description?: string;
  DisplayOrder?: number;
}


export async function describeAgentStatus(client: ConnectClient, instanceId: string, agentStatusId: string): Promise<AgentStatus> {
  const response = await client.send(
    new DescribeAgentStatusCommand({
      InstanceId: instanceId,
      AgentStatusId: agentStatusId
    })
  );

  if (!response.AgentStatus) {
    throw new Error(`Agent status not found: ${agentStatusId}`);
  }

  return response.AgentStatus;
}


export async function createAgentStatus(client: ConnectClient, instanceId: string, config: CreateAgentStatusConfig): Promise<{ id: string; arn: string }> {
  const response = await client.send(
    new CreateAgentStatusCommand({
      InstanceId: instanceId,
      Name: config.Name,
      State: config.State,
      Description: config.Description,
      DisplayOrder: config.DisplayOrder,
      Tags: config.Tags
    })
  );

  return {
    id: response.AgentStatusId!,
    arn: response.AgentStatusARN!
  };
}


export async function updateAgentStatus(client: ConnectClient, instanceId: string, agentStatusId: string, config: UpdateAgentStatusConfig): Promise<void> {
  await client.send(
    new UpdateAgentStatusCommand({
      InstanceId: instanceId,
      AgentStatusId: agentStatusId,
      Name: config.Name,
      State: config.State,
      Description: config.Description,
      DisplayOrder: config.DisplayOrder
    })
  );
}
