
import { DescribeSecurityProfileCommand, ListSecurityProfilePermissionsCommand, CreateSecurityProfileCommand, UpdateSecurityProfileCommand } from "@aws-sdk/client-connect";

import type { ConnectClient, SecurityProfile } from "@aws-sdk/client-connect";


function removeUndefined<T extends Record<string, any>>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(obj)
    .filter(([_, v]) => v !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}


export interface CreateSecurityProfileConfig {
  SecurityProfileName: string;
  Description?: string;
  Permissions?: string[];
  Tags?: Record<string, string>;
  AllowedAccessControlTags?: Record<string, string>;
  TagRestrictedResources?: string[];
  HierarchyRestrictedResources?: string[];
  AllowedAccessControlHierarchyGroupId?: string;
}


export interface UpdateSecurityProfileConfig {
  Description?: string;
  Permissions?: string[];
  AllowedAccessControlTags?: Record<string, string>;
  TagRestrictedResources?: string[];
  HierarchyRestrictedResources?: string[];
  AllowedAccessControlHierarchyGroupId?: string;
}


export async function describeSecurityProfile(client: ConnectClient, instanceId: string, securityProfileId: string) {
  const response = await client.send(
    new DescribeSecurityProfileCommand({
      InstanceId: instanceId,
      SecurityProfileId: securityProfileId
    })
  );

  if (!response.SecurityProfile?.SecurityProfileName) {
    throw new Error(`Security profile not found: ${securityProfileId}`);
  }

  return removeUndefined(response.SecurityProfile) as NoUndefinedVals<SecurityProfile> & { SecurityProfileName: string };
}


export async function listSecurityProfilePermissions(client: ConnectClient, instanceId: string, securityProfileId: string): Promise<string[]> {
  const items: string[] = [];
  let nextToken: string | undefined;

  do {
    const response = await client.send(
      new ListSecurityProfilePermissionsCommand({
        InstanceId: instanceId,
        SecurityProfileId: securityProfileId,
        MaxResults: 1000,
        NextToken: nextToken
      })
    );

    if (response.Permissions) {
      items.push(...response.Permissions);
    }

    nextToken = response.NextToken;
  } while (nextToken);

  return items;
}


export async function createSecurityProfile(client: ConnectClient, instanceId: string, config: CreateSecurityProfileConfig): Promise<{ id: string; arn: string }> {
  const commandInput: { InstanceId: string; SecurityProfileName: string; Description?: string | undefined; Permissions?: string[] | undefined; Tags?: Record<string, string> | undefined; AllowedAccessControlTags?: Record<string, string> | undefined; TagRestrictedResources?: string[] | undefined; HierarchyRestrictedResources?: string[] | undefined; AllowedAccessControlHierarchyGroupId?: string | undefined } = {
    InstanceId: instanceId,
    SecurityProfileName: config.SecurityProfileName,
    Description: config.Description,
    Permissions: config.Permissions,
    Tags: config.Tags,
    AllowedAccessControlTags: config.AllowedAccessControlTags,
    TagRestrictedResources: config.TagRestrictedResources,
    HierarchyRestrictedResources: config.HierarchyRestrictedResources,
    AllowedAccessControlHierarchyGroupId: config.AllowedAccessControlHierarchyGroupId
  };

  const response = await client.send(
    new CreateSecurityProfileCommand(commandInput)
  );

  return {
    id: response.SecurityProfileId!,
    arn: response.SecurityProfileArn!
  };
}


export async function updateSecurityProfile(client: ConnectClient, instanceId: string, securityProfileId: string, config: UpdateSecurityProfileConfig): Promise<void> {
  const commandInput: { InstanceId: string; SecurityProfileId: string; Description?: string | undefined; Permissions?: string[] | undefined; AllowedAccessControlTags?: Record<string, string> | undefined; TagRestrictedResources?: string[] | undefined; HierarchyRestrictedResources?: string[] | undefined; AllowedAccessControlHierarchyGroupId?: string | undefined } = {
    InstanceId: instanceId,
    SecurityProfileId: securityProfileId,
    Description: config.Description,
    Permissions: config.Permissions,
    AllowedAccessControlTags: config.AllowedAccessControlTags,
    TagRestrictedResources: config.TagRestrictedResources,
    HierarchyRestrictedResources: config.HierarchyRestrictedResources,
    AllowedAccessControlHierarchyGroupId: config.AllowedAccessControlHierarchyGroupId
  };

  await client.send(
    new UpdateSecurityProfileCommand(commandInput)
  );
}
