
import type { ContactFlowSummary, ContactFlowModuleSummary, ContactFlow, ContactFlowModule } from "@aws-sdk/client-connect";
import { extractDependencyArnsFromFlow, categorizeArn } from "./arn-utils.js";
import { buildAllResourceMappings, validateDependencies } from "./mapping.js";
import type { InstanceInventory, ResourceMappings } from "./mapping.js";


export interface ConnectConfig {
  instanceId: string;
  region: string;
  flowFilters?: {
    include?: string[];
    exclude?: string[];
  };
  moduleFilters?: {
    include?: string[];
    exclude?: string[];
  };
  viewFilters?: {
    include?: string[];
    exclude?: string[];
  };
}


export interface ValidationError {
  severity: 'error';
  category: 'missing_resource' | 'invalid_reference' | 'permission_denied';
  resourceType: string;
  resourceName?: string;
  referencedBy: string;
  sourceArn: string;
  message: string;
}


export interface ValidationWarning {
  severity: 'warning';
  category: 'environment_specific' | 'unknown_reference';
  message: string;
  details?: string;
}


export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  sourceFlowsToCopy: ContactFlowSummary[];
  sourceModulesToCopy: ContactFlowModuleSummary[];
  sourceInventory: InstanceInventory;
  targetInventory: InstanceInventory;
  resourceMappings: ResourceMappings;
  sourceFlowDetails: Map<string, ContactFlow>;
  sourceModuleDetails: Map<string, ContactFlowModule>;
}


function getResourceNameFromArn(arn: string, inventory: InstanceInventory): string | undefined {
  const allResources = [
    ...inventory.flows,
    ...inventory.modules,
    ...inventory.queues,
    ...inventory.prompts,
    ...inventory.routingProfiles,
    ...inventory.hoursOfOperations,
    ...inventory.quickConnects,
    ...inventory.securityProfiles,
    ...inventory.hierarchyGroups,
    ...inventory.agentStatuses,
    ...inventory.views
  ];

  const resource = allResources.find(r => r.Arn === arn);
  return resource?.Name;
}


function formatArnCategoryName(category: string): string {
  const categoryMap: Record<string, string> = {
    'flow': 'Flow',
    'module': 'Module',
    'queue': 'Queue',
    'prompt': 'Prompt',
    'lambda': 'Lambda',
    'lex': 'Lex Bot',
    's3': 'S3 Bucket',
    'view': 'View',
    'routing-profile': 'Routing Profile',
    'hours-of-operation': 'Hours of Operation',
    'quick-connect': 'Quick Connect',
    'security-profile': 'Security Profile',
    'hierarchy-group': 'Hierarchy Group',
    'agent-status': 'Agent Status',
    'unknown': 'Unknown'
  };

  return categoryMap[category] || category;
}


export function validateFlowDependencies(sourceInventory: InstanceInventory, targetInventory: InstanceInventory, sourceFlowsToCopy: ContactFlowSummary[], sourceModulesToCopy: ContactFlowModuleSummary[], sourceFlowDetails: Map<string, ContactFlow>, sourceModuleDetails: Map<string, ContactFlowModule>, verbose: boolean): ValidationResult {
  console.log("Validating dependencies...");

  const resourceMappings = buildAllResourceMappings(sourceInventory, targetInventory);
  const targetFlowsByArn = new Map(targetInventory.flows.map(f => [f.Arn!, f]));
  const targetModulesByArn = new Map(targetInventory.modules.map(m => [m.Arn!, m]));

  const targetFlowsByName = new Map(targetInventory.flows.map(f => [f.Name!, f]));
  const targetModulesByName = new Map(targetInventory.modules.map(m => [m.Name!, m]));

  const flowsWillCreate = new Set(
    sourceFlowsToCopy
      .filter(f => !targetFlowsByName.has(f.Name!))
      .map(f => f.Arn!)
  );

  const modulesWillCreate = new Set(
    sourceModulesToCopy
      .filter(m => !targetModulesByName.has(m.Name!))
      .map(m => m.Arn!)
  );

  console.log(`Will create: ${flowsWillCreate.size} flows, ${modulesWillCreate.size} modules`);

  const allErrors: ValidationError[] = [];
  const allWarnings: ValidationWarning[] = [];

  for (const flowSummary of sourceFlowsToCopy) {
    const fullFlow = sourceFlowDetails.get(flowSummary.Id!);
    if (!fullFlow) continue;

    const arns = extractDependencyArnsFromFlow(fullFlow);

    if (verbose) {
      console.log(`Flow "${fullFlow.Name}": ${arns.length} dependencies`);
      for (const arn of arns) {
        const category = categorizeArn(arn);
        const resourceName = getResourceNameFromArn(arn, sourceInventory);
        const displayName = resourceName ? `"${resourceName}"` : arn;
        console.log(`  - ${formatArnCategoryName(category)}: ${displayName}`);
      }
    }

    const validation = validateDependencies(arns, resourceMappings, flowsWillCreate, modulesWillCreate, targetFlowsByArn, targetModulesByArn, fullFlow.Name!);
    allErrors.push(...validation.errors);
    allWarnings.push(...validation.warnings);
  }

  for (const moduleSummary of sourceModulesToCopy) {
    const fullModule = sourceModuleDetails.get(moduleSummary.Id!);
    if (!fullModule) continue;

    const arns = extractDependencyArnsFromFlow(fullModule);

    if (verbose) {
      console.log(`Module "${fullModule.Name}": ${arns.length} dependencies`);
      for (const arn of arns) {
        const category = categorizeArn(arn);
        const resourceName = getResourceNameFromArn(arn, sourceInventory);
        const displayName = resourceName ? `"${resourceName}"` : arn;
        console.log(`  - ${formatArnCategoryName(category)}: ${displayName}`);
      }
    }

    const validation = validateDependencies(arns, resourceMappings, flowsWillCreate, modulesWillCreate, targetFlowsByArn, targetModulesByArn, fullModule.Name!);
    allErrors.push(...validation.errors);
    allWarnings.push(...validation.warnings);
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings,
    sourceFlowsToCopy,
    sourceModulesToCopy,
    sourceInventory,
    targetInventory,
    resourceMappings,
    sourceFlowDetails,
    sourceModuleDetails
  };
}
