
import { DescribeHoursOfOperationCommand, CreateHoursOfOperationCommand, UpdateHoursOfOperationCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, HoursOfOperation, HoursOfOperationConfig } from "@aws-sdk/client-connect";


export interface CreateHoursOfOperationConfig {
  Name: string;
  TimeZone: string;
  Config: HoursOfOperationConfig[];
  Description?: string | undefined;
  Tags?: Record<string, string> | undefined;
}


export interface UpdateHoursOfOperationConfig {
  Name?: string | undefined;
  Description?: string | undefined;
  TimeZone?: string | undefined;
  Config?: HoursOfOperationConfig[] | undefined;
}


export async function describeHoursOfOperation(client: ConnectClient, instanceId: string, hoursOfOperationId: string): Promise<HoursOfOperation> {
  const response = await client.send(
    new DescribeHoursOfOperationCommand({
      InstanceId: instanceId,
      HoursOfOperationId: hoursOfOperationId
    })
  );

  if (!response.HoursOfOperation) {
    throw new Error(`Hours of operation not found: ${hoursOfOperationId}`);
  }

  return response.HoursOfOperation;
}


export async function createHoursOfOperation(client: ConnectClient, instanceId: string, config: CreateHoursOfOperationConfig): Promise<{ id: string; arn: string }> {
  const response = await client.send(
    new CreateHoursOfOperationCommand({
      InstanceId: instanceId,
      ...config
    })
  );

  return {
    id: response.HoursOfOperationId!,
    arn: response.HoursOfOperationArn!
  };
}


export async function updateHoursOfOperation(client: ConnectClient, instanceId: string, hoursOfOperationId: string, config: UpdateHoursOfOperationConfig): Promise<void> {
  await client.send(
    new UpdateHoursOfOperationCommand({
      InstanceId: instanceId,
      HoursOfOperationId: hoursOfOperationId,
      ...config
    })
  );
}
