

import type { ContactFlow, ContactFlowModule } from "@aws-sdk/client-connect";
import { getArnFieldsForActionType } from "./arn-field-mapping.js";


const ARN_PATTERN = /arn:aws:connect:[a-z0-9-]+:\d+:instance\/[a-f0-9-]+\/[a-z-]+\/[a-f0-9-]+/g;


/**
 * Extract ARNs from flow content string using regex pattern matching.
 * This is a fallback method for catching ARNs we might have missed.
 */
export function extractArnsFromFlowContent(content: string): string[] {
  const matches = content.match(ARN_PATTERN);
  return matches ?? [];
}


/**
 * Get a value from a nested object using a dot-notation path.
 * Example: getNestedValue({a: {b: "value"}}, "a.b") returns "value"
 */
function getNestedValue(obj: any, path: string): any {
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }

  return current;
}


/**
 * Check if a value looks like an ARN or resource ID that should be tracked.
 * Returns true for:
 * - Strings starting with "arn:aws:"
 * - Strings that look like UUIDs or resource IDs
 * - S3 URIs
 */
function isArnOrResourceId(value: any): boolean {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  // Skip dynamic references like $.Attributes.something
  if (value.startsWith('$.')) {
    return false;
  }

  // Match ARNs
  if (value.startsWith('arn:aws:')) {
    return true;
  }

  // Match S3 URIs
  if (value.startsWith('s3://')) {
    return true;
  }

  // Match UUID-like resource IDs (36 characters with dashes)
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    return true;
  }

  return false;
}


/**
 * Extract all ARNs and resource IDs from a flow or module by traversing its actions
 * and checking known ARN-containing fields.
 */
export function extractDependencyArnsFromFlow(resource: ContactFlow | ContactFlowModule): string[] {
  const content = resource.Content ?? "";

  // Parse the content JSON
  let flowContent: any;
  try {
    flowContent = JSON.parse(content);
  } catch (error) {
    // If parsing fails, fall back to regex extraction
    return extractArnsFromFlowContent(content);
  }

  const arns = new Set<string>();

  // Traverse all actions
  const actions = flowContent.Actions ?? [];

  for (const action of actions) {
    const actionType = action.Type;
    const parameters = action.Parameters ?? {};

    // Get known ARN fields for this action type
    const arnFields = getArnFieldsForActionType(actionType);

    // Extract ARNs from known field paths
    for (const field of arnFields) {
      const value = getNestedValue(parameters, field.path);

      if (isArnOrResourceId(value)) {
        arns.add(value);
      }
    }

    // Fallback: recursively search all parameter values for ARN patterns
    const jsonString = JSON.stringify(parameters);
    const regexMatches = jsonString.match(ARN_PATTERN);

    if (regexMatches) {
      regexMatches.forEach(arn => arns.add(arn));
    }
  }

  return Array.from(arns);
}
