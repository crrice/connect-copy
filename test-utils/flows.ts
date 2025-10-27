
import { DeleteContactFlowCommand, ListContactFlowsCommand } from "@aws-sdk/client-connect";
import { createContactFlow } from "../src/connect/operations.js";
import { describeContactFlow } from "../src/connect/flows.js";
import { getClient } from "./auth.js";

import type { ContactFlowType, ContactFlowStatus, ContactFlow } from "@aws-sdk/client-connect";


export async function createTestFlow(instanceId: string, name: string, status: ContactFlowStatus = "SAVED", type: ContactFlowType = "CONTACT_FLOW", description?: string): Promise<{ id: string; arn: string }> {
  const client = getClient(instanceId);

  const stubContent = JSON.stringify({
    "Version": "2019-10-30",
    "StartAction": "disconnect-1",
    "Metadata": {},
    "Actions": [{
      "Identifier": "disconnect-1",
      "Type": "DisconnectParticipant",
      "Parameters": {},
      "Transitions": {}
    }]
  });

  return await createContactFlow(
    client,
    instanceId,
    name,
    stubContent,
    type,
    description,
    undefined,
    status
  );
}


export async function deleteTestFlow(instanceId: string, flowId: string): Promise<void> {
  const client = getClient(instanceId);

  await client.send(new DeleteContactFlowCommand({
    InstanceId: instanceId,
    ContactFlowId: flowId
  }));
}


export async function getFlowDetails(instanceId: string, flowId: string, useSavedSuffix: boolean = false): Promise<ContactFlow> {
  const client = getClient(instanceId);
  const effectiveFlowId = useSavedSuffix ? flowId + ":$SAVED" : flowId;

  return await describeContactFlow(client, instanceId, effectiveFlowId);
}


export async function getFlowStatus(instanceId: string, flowId: string): Promise<ContactFlowStatus> {
  const flow = await getFlowDetails(instanceId, flowId);
  return flow.Status!;
}


export async function flowExists(instanceId: string, flowName: string): Promise<boolean> {
  const client = getClient(instanceId);

  try {
    const response = await client.send(new ListContactFlowsCommand({
      InstanceId: instanceId
    }));
    return (response.ContactFlowSummaryList || []).some(f => f.Name === flowName);
  } catch (error: any) {
    throw error;
  }
}


export interface FlowCleanup {
  instanceId: string;
  flowId: string;
  flowName: string;
}

const cleanupRegistry: FlowCleanup[] = [];


export function registerForCleanup(instanceId: string, flowId: string, flowName: string): void {
  cleanupRegistry.push({ instanceId, flowId, flowName });
}


export async function cleanupAllFlows(): Promise<void> {
  console.log(`\nCleaning up ${cleanupRegistry.length} test flows...`);

  for (const flow of cleanupRegistry) {
    try {
      await deleteTestFlow(flow.instanceId, flow.flowId);
      console.log(`  ✓ Deleted: ${flow.flowName}`);
    } catch (error: any) {
      console.log(`  ✗ Failed to delete ${flow.flowName}: ${error.message}`);
    }
  }

  cleanupRegistry.length = 0;
  console.log("Cleanup complete\n");
}
