
import {
  ListContactFlowsCommand,
  ListContactFlowModulesCommand,
  DescribeContactFlowCommand,
  DescribeContactFlowModuleCommand
} from "@aws-sdk/client-connect";

import type {
  ConnectClient,
  ContactFlowSummary,
  ContactFlowModuleSummary,
  ContactFlow,
  ContactFlowModule
} from "@aws-sdk/client-connect";


export async function listContactFlows(client: ConnectClient, instanceId: string): Promise<ContactFlowSummary[]> {
  const flows: ContactFlowSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(new ListContactFlowsCommand({
      InstanceId: instanceId,
      NextToken: nextToken
    }));

    flows.push(...response.ContactFlowSummaryList ?? []);
    nextToken = response.NextToken;
  } while (nextToken);

  return flows;
}


export async function listContactFlowModules(client: ConnectClient, instanceId: string): Promise<ContactFlowModuleSummary[]> {
  const modules: ContactFlowModuleSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(new ListContactFlowModulesCommand({
      InstanceId: instanceId,
      NextToken: nextToken
    }));

    modules.push(...response.ContactFlowModulesSummaryList ?? []);
    nextToken = response.NextToken;
  } while (nextToken);

  return modules;
}


export async function describeContactFlow(client: ConnectClient, instanceId: string, contactFlowId: string): Promise<ContactFlow> {
  const response = await client.send(new DescribeContactFlowCommand({
    InstanceId: instanceId,
    ContactFlowId: contactFlowId
  }));

  return response.ContactFlow!;
}


export async function describeContactFlowModule(client: ConnectClient, instanceId: string, contactFlowModuleId: string): Promise<ContactFlowModule> {
  const response = await client.send(new DescribeContactFlowModuleCommand({
    InstanceId: instanceId,
    ContactFlowModuleId: contactFlowModuleId
  }));

  return response.ContactFlowModule!;
}
