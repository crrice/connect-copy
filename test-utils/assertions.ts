
import { UpdateContactFlowContentCommand } from "@aws-sdk/client-connect";
import { getFlowDetails, getFlowStatus } from "./flows.js";
import { getClient } from "./auth.js";
import { getEntryPoint } from "./content.js";

import type { ContactFlowStatus } from "@aws-sdk/client-connect";


export async function assertFlowStatus(instanceId: string, flowId: string, expectedStatus: ContactFlowStatus, label?: string): Promise<void> {
  const actualStatus = await getFlowStatus(instanceId, flowId);

  if (actualStatus !== expectedStatus) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}Expected Status=${expectedStatus}, got Status=${actualStatus}`);
  }

  console.log(`  ✓ Status is ${expectedStatus}${label ? ` (${label})` : ""}`);
}


export async function assertContentMatches(instanceId: string, flowId: string, expectedContent: string, useSavedSuffix: boolean = false, label?: string): Promise<void> {
  const flow = await getFlowDetails(instanceId, flowId, useSavedSuffix);
  const actualContent = flow.Content!;

  const normalizeJson = (json: string) => JSON.stringify(JSON.parse(json));
  const normalizedExpected = normalizeJson(expectedContent);
  const normalizedActual = normalizeJson(actualContent);

  if (normalizedExpected !== normalizedActual) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}Content mismatch`);
  }

  const suffix = useSavedSuffix ? " (draft)" : "";
  console.log(`  ✓ Content matches${suffix}${label ? ` (${label})` : ""}`);
}


export async function assertEntryPoint(instanceId: string, flowId: string, expectedX: number, expectedY: number, useSavedSuffix: boolean = false, label?: string): Promise<void> {
  const flow = await getFlowDetails(instanceId, flowId, useSavedSuffix);
  const entryPoint = getEntryPoint(flow.Content!);

  if (!entryPoint) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}No entryPoint found in content`);
  }

  if (entryPoint.x !== expectedX || entryPoint.y !== expectedY) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}Expected entryPoint ({x:${expectedX}, y:${expectedY}}), got ({x:${entryPoint.x}, y:${entryPoint.y}})`);
  }

  const suffix = useSavedSuffix ? " (draft)" : "";
  console.log(`  ✓ EntryPoint is ({x:${expectedX}, y:${expectedY}})${suffix}${label ? ` (${label})` : ""}`);
}


export async function assertDescriptionEquals(instanceId: string, flowId: string, expectedDescription: string | undefined, label?: string): Promise<void> {
  const flow = await getFlowDetails(instanceId, flowId);
  const actualDescription = flow.Description;

  if (actualDescription !== expectedDescription) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}Expected Description="${expectedDescription}", got "${actualDescription}"`);
  }

  console.log(`  ✓ Description is "${expectedDescription || '(empty)'}"${label ? ` (${label})` : ""}`);
}


export async function assertTagsEqual(instanceId: string, flowId: string, expectedTags: Record<string, string> | undefined, label?: string): Promise<void> {
  const flow = await getFlowDetails(instanceId, flowId);
  const actualTags = flow.Tags || {};
  const expected = expectedTags || {};

  const actualKeys = Object.keys(actualTags).sort();
  const expectedKeys = Object.keys(expected).sort();

  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    const prefix = label ? `${label}: ` : "";
    throw new Error(`${prefix}Tag keys mismatch. Expected: ${JSON.stringify(expectedKeys)}, got: ${JSON.stringify(actualKeys)}`);
  }

  for (const key of expectedKeys) {
    if (actualTags[key] !== expected[key]) {
      const prefix = label ? `${label}: ` : "";
      throw new Error(`${prefix}Tag value mismatch for key "${key}". Expected: "${expected[key]}", got: "${actualTags[key]}"`);
    }
  }

  console.log(`  ✓ Tags match${label ? ` (${label})` : ""}`);
}


export async function assertDraftExists(instanceId: string, flowId: string, shouldExist: boolean = true, label?: string): Promise<void> {
  try {
    await getFlowDetails(instanceId, flowId, true);

    if (!shouldExist) {
      const prefix = label ? `${label}: ` : "";
      throw new Error(`${prefix}Draft version exists but shouldn't`);
    }

    console.log(`  ✓ Draft version exists${label ? ` (${label})` : ""}`);
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      if (shouldExist) {
        const prefix = label ? `${label}: ` : "";
        throw new Error(`${prefix}Draft version doesn't exist but should`);
      }
      console.log(`  ✓ Draft version does not exist${label ? ` (${label})` : ""}`);
    } else {
      throw error;
    }
  }
}


export async function updateFlowContent(instanceId: string, flowId: string, content: string, useSavedSuffix: boolean = false): Promise<void> {
  const client = getClient(instanceId);
  const effectiveFlowId = useSavedSuffix ? flowId + ":$SAVED" : flowId;

  await client.send(new UpdateContactFlowContentCommand({
    InstanceId: instanceId,
    ContactFlowId: effectiveFlowId,
    Content: content
  }));
}
