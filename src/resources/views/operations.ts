
import {
  ListViewsCommand,
  DescribeViewCommand,
  CreateViewCommand,
  UpdateViewContentCommand
} from "@aws-sdk/client-connect";

import type { ConnectClient, View, ViewSummary, ViewStatus, ViewContent } from "@aws-sdk/client-connect";


export async function listViews(client: ConnectClient, instanceId: string): Promise<ViewSummary[]> {
  const views: ViewSummary[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListViewsCommand({
        InstanceId: instanceId,
        NextToken: nextToken
      })
    );

    if (response.ViewsSummaryList) {
      views.push(...response.ViewsSummaryList);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return views;
}


export async function describeView(client: ConnectClient, instanceId: string, viewId: string): Promise<View> {
  const response = await client.send(
    new DescribeViewCommand({
      InstanceId: instanceId,
      ViewId: viewId
    })
  );

  if (!response.View) {
    throw new Error(`View not found: ${viewId}`);
  }

  return response.View;
}


export interface CreateViewConfig {
  Name: string;
  Description?: string | undefined;
  Status: ViewStatus;
  Content: ViewContent;
  Tags?: Record<string, string> | undefined;
}


export async function createView(client: ConnectClient, instanceId: string, config: CreateViewConfig): Promise<{ id: string; arn: string }> {
  const response = await client.send(
    new CreateViewCommand({
      InstanceId: instanceId,
      Name: config.Name,
      Description: config.Description,
      Status: config.Status,
      Content: config.Content,
      Tags: config.Tags
    })
  );

  return {
    id: response.View?.Id!,
    arn: response.View?.Arn!
  };
}


export async function updateViewContent(client: ConnectClient, instanceId: string, viewId: string, status: ViewStatus, content: ViewContent): Promise<void> {
  await client.send(
    new UpdateViewContentCommand({
      InstanceId: instanceId,
      ViewId: viewId,
      Status: status,
      Content: content
    })
  );
}
