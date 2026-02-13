
import type {
  ContactFlowSummary,
  ContactFlowModuleSummary,
  QueueSummary,
  PromptSummary,
  RoutingProfileSummary,
  HoursOfOperationSummary,
  QuickConnectSummary,
  SecurityProfileSummary,
  HierarchyGroupSummary,
  AgentStatusSummary,
  ViewSummary
} from "@aws-sdk/client-connect";

import { categorizeArn } from "./arn-utils.js";
import type { ValidationError, ValidationWarning } from "./validation.js";


export interface ResourceMappings {
  arnMap: Map<string, string>;
  missingResources: MissingResource[];
}


export interface MissingResource {
  type: string;
  name: string;
  sourceArn: string;
}


export interface ResourceInventory {
  queues: QueueSummary[];
  prompts: PromptSummary[];
  routingProfiles: RoutingProfileSummary[];
  hoursOfOperations: HoursOfOperationSummary[];
  quickConnects: QuickConnectSummary[];
  securityProfiles: SecurityProfileSummary[];
  hierarchyGroups: HierarchyGroupSummary[];
  agentStatuses: AgentStatusSummary[];
  views: ViewSummary[];
}


export interface FlowInventory {
  flows: ContactFlowSummary[];
  modules: ContactFlowModuleSummary[];
}


export interface InstanceInventory {
  flows: ContactFlowSummary[];
  modules: ContactFlowModuleSummary[];
  queues: QueueSummary[];
  prompts: PromptSummary[];
  routingProfiles: RoutingProfileSummary[];
  hoursOfOperations: HoursOfOperationSummary[];
  quickConnects: QuickConnectSummary[];
  securityProfiles: SecurityProfileSummary[];
  hierarchyGroups: HierarchyGroupSummary[];
  agentStatuses: AgentStatusSummary[];
  views: ViewSummary[];
}


interface ResourceMapResult {
  mappings: Map<string, string>;
  missing: MissingResource[];
}


function buildResourceMap<T extends { Name?: string | undefined; Arn?: string | undefined }>(sourceResources: T[], targetResources: T[], resourceType: string): ResourceMapResult {
  const mappings = new Map<string, string>();
  const missing: MissingResource[] = [];

  const targetByName = new Map<string, T>();
  for (const resource of targetResources) {
    if (!resource.Name || !resource.Arn) continue;
    targetByName.set(resource.Name, resource);
  }

  for (const sourceResource of sourceResources) {
    const name = sourceResource.Name;
    const sourceArn = sourceResource.Arn;

    if (!name || !sourceArn) continue;

    const targetResource = targetByName.get(name);

    if (!targetResource?.Arn) {
      missing.push({
        type: resourceType,
        name,
        sourceArn
      });

      continue;
    }

    mappings.set(sourceArn, targetResource.Arn);
  }

  return { mappings, missing };
}


export function buildAllResourceMappings(source: InstanceInventory, target: InstanceInventory): ResourceMappings {
  const arnMap = new Map<string, string>();
  const missingResources: MissingResource[] = [];

  const resourcePairs = [
    { source: source.flows, target: target.flows, type: "Flow" },
    { source: source.modules, target: target.modules, type: "Module" },
    { source: source.queues, target: target.queues, type: "Queue" },
    { source: source.prompts, target: target.prompts, type: "Prompt" },
    { source: source.routingProfiles, target: target.routingProfiles, type: "Routing Profile" },
    { source: source.hoursOfOperations, target: target.hoursOfOperations, type: "Hours of Operation" },
    { source: source.quickConnects, target: target.quickConnects, type: "Quick Connect" },
    { source: source.securityProfiles, target: target.securityProfiles, type: "Security Profile" },
    { source: source.hierarchyGroups, target: target.hierarchyGroups, type: "Hierarchy Group" },
    { source: source.agentStatuses, target: target.agentStatuses, type: "Agent Status" },
    { source: source.views, target: target.views, type: "View" }
  ];

  for (const resourcePair of resourcePairs) {
    const result = buildResourceMap(resourcePair.source, resourcePair.target, resourcePair.type);

    for (const [sourceArn, targetArn] of result.mappings) {
      arnMap.set(sourceArn, targetArn);
    }

    missingResources.push(...result.missing);
  }

  return { arnMap, missingResources };
}


function normalizeViewArn(arn: string): string {
  if (arn.includes(':view/')) {
    return arn.replace(/:(\d+|\$LATEST|\$SAVED)$/, '');
  }

  return arn;
}


export function validateDependencies(extractedArns: string[], resourceMappings: ResourceMappings, flowsWillCreate: Set<string>, modulesWillCreate: Set<string>, referencedByName: string): { errors: ValidationError[], warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  for (const arn of extractedArns) {
    const category = categorizeArn(arn);
    const normalizedArn = normalizeViewArn(arn);

    if (resourceMappings.arnMap.has(normalizedArn)) continue;

    if (category === 'flow') {
      if (flowsWillCreate.has(arn)) continue;

      errors.push({
        severity: 'error',
        category: 'missing_resource',
        resourceType: 'Flow',
        referencedBy: referencedByName,
        sourceArn: arn,
        message: `Flow not found in target and not being copied: ${arn}`
      });

      continue;
    }

    if (category === 'module') {
      if (modulesWillCreate.has(arn)) continue;

      errors.push({
        severity: 'error',
        category: 'missing_resource',
        resourceType: 'Module',
        referencedBy: referencedByName,
        sourceArn: arn,
        message: `Module not found in target and not being copied: ${arn}`
      });

      continue;
    }

    if (category === 'lambda' || category === 'lex' || category === 's3') {
      warnings.push({
        severity: 'warning',
        category: 'environment_specific',
        message: `Environment-specific resource referenced: ${arn}`,
        details: `Must exist in target instance (referenced by ${referencedByName})`
      });

      continue;
    }

    if (category === 'unknown') {
      warnings.push({
        severity: 'warning',
        category: 'unknown_reference',
        message: `Unknown ARN type: ${arn}`,
        details: `Referenced by ${referencedByName}`
      });

      continue;
    }

    errors.push({
      severity: 'error',
      category: 'missing_resource',
      resourceType: category,
      referencedBy: referencedByName,
      sourceArn: arn,
      message: `${category} not found in target: ${arn}`
    });
  }

  return { errors, warnings };
}
