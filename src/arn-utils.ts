

import type { ContactFlow, ContactFlowModule } from "@aws-sdk/client-connect";
import { getArnFieldsForActionType } from "./arn-field-mapping.js";


const ARN_PATTERN = /arn:aws:connect:[a-z0-9-]+:\d+:instance\/[a-f0-9-]+\/[a-z-]+\/[a-f0-9-]+/g;


export type ArnCategory = 'flow' | 'module' | 'queue' | 'prompt' | 'lambda' |
                          'lex' | 's3' | 'view' | 'routing-profile' | 'hours-of-operation' |
                          'quick-connect' | 'security-profile' | 'hierarchy-group' |
                          'agent-status' | 'unknown';


export function categorizeArn(arn: string): ArnCategory {
  if (arn.includes('/contact-flow/')) return 'flow';
  if (arn.includes('/contact-flow-module/')) return 'module';
  if (arn.includes(':lambda:')) return 'lambda';
  if (arn.includes(':lex:')) return 'lex';
  if (arn.startsWith('s3://')) return 's3';
  if (arn.includes(':view/')) return 'view';
  if (arn.includes('/queue/')) return 'queue';
  if (arn.includes('/prompt/')) return 'prompt';
  if (arn.includes('/routing-profile/')) return 'routing-profile';
  if (arn.includes('/hours-of-operation/')) return 'hours-of-operation';
  if (arn.includes('/quick-connect/')) return 'quick-connect';
  if (arn.includes('/security-profile/')) return 'security-profile';
  if (arn.includes('/hierarchy-group/')) return 'hierarchy-group';
  if (arn.includes('/agent-status/')) return 'agent-status';

  return 'unknown';
}


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
    if (current == null || typeof current !== 'object') return undefined;
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
  if (typeof value !== 'string' || value.length === 0) return false;

  // Skip dynamic references like $.Attributes.something
  if (value.startsWith('$.')) return false;

  // Match ARNs
  if (value.startsWith('arn:aws:')) return true;

  // Match S3 URIs
  if (value.startsWith('s3://')) return true;

  // Match UUID-like resource IDs (36 characters with dashes)
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) return true;

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

    if (regexMatches) regexMatches.forEach(arn => arns.add(arn));
  }

  return Array.from(arns);
}
