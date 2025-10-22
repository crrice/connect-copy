
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
  AgentStatusSummary
} from "@aws-sdk/client-connect";


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


export function buildAllResourceMappings(source: ResourceInventory, target: ResourceInventory): ResourceMappings {
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
    { source: source.agentStatuses, target: target.agentStatuses, type: "Agent Status" }
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
