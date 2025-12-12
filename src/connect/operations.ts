
import { CreateContactFlowCommand, CreateContactFlowModuleCommand, UpdateContactFlowContentCommand, UpdateContactFlowModuleContentCommand, UpdateContactFlowMetadataCommand, UpdateContactFlowModuleMetadataCommand, TagResourceCommand, UntagResourceCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, ContactFlowType, ContactFlowStatus, ContactFlowState } from "@aws-sdk/client-connect";


export async function createContactFlowModule(client: ConnectClient, instanceId: string, name: string, content: string, description?: string, tags?: Record<string, string>) {
  const response = await client.send(new CreateContactFlowModuleCommand({
    InstanceId: instanceId,
    Name: name,
    Content: content,
    Description: description,
    Tags: tags
  }));

  return {
    id: response.Id!,
    arn: response.Arn!
  };
}


export async function updateContactFlowModuleContent(client: ConnectClient, instanceId: string, contactFlowModuleId: string, content: string) {
  await client.send(new UpdateContactFlowModuleContentCommand({
    InstanceId: instanceId,
    ContactFlowModuleId: contactFlowModuleId,
    Content: content
  }));
}


export async function createContactFlow(client: ConnectClient, instanceId: string, name: string, content: string, type: ContactFlowType, description?: string, tags?: Record<string, string>, status: ContactFlowStatus = "SAVED") {
  const response = await client.send(new CreateContactFlowCommand({
    InstanceId: instanceId,
    Name: name,
    Content: content,
    Type: type,
    Description: description,
    Tags: tags,
    Status: status
  }));

  return {
    id: response.ContactFlowId!,
    arn: response.ContactFlowArn!
  };
}


export async function updateContactFlowContent(client: ConnectClient, instanceId: string, contactFlowId: string, content: string) {
  await client.send(new UpdateContactFlowContentCommand({
    InstanceId: instanceId,
    ContactFlowId: contactFlowId,
    Content: content
  }));
}


export async function updateContactFlowMetadata(client: ConnectClient, instanceId: string, contactFlowId: string, state?: ContactFlowState, description?: string) {
  await client.send(new UpdateContactFlowMetadataCommand({
    InstanceId: instanceId,
    ContactFlowId: contactFlowId,
    ContactFlowState: state,
    Description: description
  }));
}


export async function updateContactFlowModuleMetadata(client: ConnectClient, instanceId: string, contactFlowModuleId: string, description?: string) {
  await client.send(new UpdateContactFlowModuleMetadataCommand({
    InstanceId: instanceId,
    ContactFlowModuleId: contactFlowModuleId,
    Description: description
  }));
}


export async function updateResourceTags(client: ConnectClient, resourceArn: string, toAdd: Record<string, string>, toRemove: string[]) {
  if (Object.keys(toAdd).length > 0) {
    await client.send(new TagResourceCommand({
      resourceArn: resourceArn,
      tags: toAdd
    }));
  }

  if (toRemove.length > 0) {
    await client.send(new UntagResourceCommand({
      resourceArn: resourceArn,
      tagKeys: toRemove
    }));
  }
}
