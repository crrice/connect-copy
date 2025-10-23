
import { readFile } from "fs/promises";
import type { ContactFlow, ContactFlowModule } from "@aws-sdk/client-connect";
import { createConnectClient } from "./connect/client.js";
import { gatherFlowInventory, describeContactFlow, describeContactFlowModule } from "./connect/flows.js";
import { gatherResourceInventory } from "./connect/resources.js";
import { buildAllResourceMappings } from "./mapping.js";
import { matchesFlowFilters } from "./filters.js";
import { validateFlowDependencies } from "./validation.js";
import type { ConnectConfig, ValidationResult } from "./validation.js";
import type { InstanceInventory } from "./mapping.js";


export interface ReportOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  resourcesOnly: boolean;
  verbose: boolean;
}


export async function runReport(options: ReportOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig: ConnectConfig = JSON.parse(sourceConfigData);
  const targetConfig: ConnectConfig = JSON.parse(targetConfigData);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("Gathering resource inventories...");

  const sourceFlows = await gatherFlowInventory(sourceClient, sourceConfig.instanceId);
  const sourceResources = await gatherResourceInventory(sourceClient, sourceConfig.instanceId);
  const sourceInventory = {
    ...sourceResources,
    flows: sourceFlows.flows,
    modules: sourceFlows.modules
  };

  const targetFlows = await gatherFlowInventory(targetClient, targetConfig.instanceId);
  const targetResources = await gatherResourceInventory(targetClient, targetConfig.instanceId);
  const targetInventory = {
    ...targetResources,
    flows: targetFlows.flows,
    modules: targetFlows.modules
  };

  reportResourceDifferences(sourceInventory, targetInventory);

  if (!options.resourcesOnly) {
    console.log("\nApplying filters...");

    const sourceFlowsToCopy = sourceInventory.flows.filter(flow =>
      matchesFlowFilters(flow.Name ?? "", sourceConfig.flowFilters)
    );

    const sourceModulesToCopy = sourceInventory.modules.filter(module =>
      matchesFlowFilters(module.Name ?? "", sourceConfig.moduleFilters)
    );

    console.log(`Filtered: ${sourceFlowsToCopy.length} flows (${sourceInventory.flows.length} total), ${sourceModulesToCopy.length} modules (${sourceInventory.modules.length} total)`);

    console.log("Describing flows and modules...");

    const sourceFlowDetails = new Map<string, ContactFlow>();
    const sourceModuleDetails = new Map<string, ContactFlowModule>();

    for (const flowSummary of sourceFlowsToCopy) {
      const fullFlow = await describeContactFlow(sourceClient, sourceConfig.instanceId, flowSummary.Id!);
      sourceFlowDetails.set(flowSummary.Id!, fullFlow);
    }

    for (const moduleSummary of sourceModulesToCopy) {
      const fullModule = await describeContactFlowModule(sourceClient, sourceConfig.instanceId, moduleSummary.Id!);
      sourceModuleDetails.set(moduleSummary.Id!, fullModule);
    }

    console.log("\n" + "=".repeat(50));
    console.log("Flow Dependency Validation");
    console.log("=".repeat(50) + "\n");

    const validationResult = validateFlowDependencies(
      sourceInventory,
      targetInventory,
      sourceFlowsToCopy,
      sourceModulesToCopy,
      sourceFlowDetails,
      sourceModuleDetails,
      options.verbose
    );

    displayValidationReport(validationResult);
  }
}


export function reportResourceDifferences(sourceInventory: InstanceInventory, targetInventory: InstanceInventory): boolean {
  const mappings = buildAllResourceMappings(sourceInventory, targetInventory);

  if (mappings.missingResources.length === 0) {
    console.log("✓ All resources from source exist in target!\n");
    return false;
  }

  console.log("\nMissing Resources in Target Instance:");
  console.log("======================================\n");

  const allResourceTypes = [
    "Flow",
    "Module",
    "Queue",
    "Prompt",
    "Routing Profile",
    "Hours of Operation",
    "Quick Connect",
    "Security Profile",
    "Hierarchy Group",
    "Agent Status",
    "View"
  ];

  const byType = new Map<string, string[]>();
  for (const missing of mappings.missingResources) {
    const names = byType.get(missing.type) ?? [];
    names.push(missing.name);
    byType.set(missing.type, names);
  }

  const hasMissing: string[] = [];
  const noMissing: string[] = [];

  for (const type of allResourceTypes) {
    if (byType.has(type)) {
      hasMissing.push(type);
    } else {
      noMissing.push(type);
    }
  }

  const pluralize = (type: string): string => {
    if (type === "Agent Status") return "Agent Statuses";
    if (type === "Hierarchy Group") return "Hierarchy Groups";
    return type + "s";
  };

  for (const type of hasMissing) {
    const names = byType.get(type)!;
    console.log(`${pluralize(type)} (${names.length} missing):`);
    for (const name of names) {
      console.log(`  - ${name}`);
    }
    console.log();
  }

  for (const type of noMissing) {
    console.log(`${pluralize(type)} (0 missing)`);
  }

  console.log(`Total: ${mappings.missingResources.length} resources in source but not in target`);
  return true;
}


export function displayValidationReport(result: ValidationResult) {
  console.log("\nValidation Summary:");
  console.log(`  Flows to copy: ${result.sourceFlowsToCopy.length}`);
  console.log(`  Modules to copy: ${result.sourceModulesToCopy.length}`);
  console.log(`  Validation errors: ${result.errors.length}`);
  console.log(`  Validation warnings: ${result.warnings.length}`);

  if (result.errors.length > 0) {
    console.log("\n❌ Validation Errors:");
    console.log("===================\n");

    const errorsByCategory = new Map<string, typeof result.errors>();
    for (const error of result.errors) {
      const errors = errorsByCategory.get(error.category) ?? [];
      errors.push(error);
      errorsByCategory.set(error.category, errors);
    }

    for (const [category, errors] of errorsByCategory) {
      console.log(`${category} (${errors.length}):`);
      for (const error of errors) {
        console.log(`  - ${error.message}`);
        console.log(`    Referenced by: ${error.referencedBy}`);
      }
      console.log();
    }
  }

  if (result.warnings.length > 0) {
    console.log("\n⚠️  Warnings:");
    console.log("=============\n");
    for (const warning of result.warnings) {
      console.log(`  - ${warning.message}`);
      if (warning.details) {
        console.log(`    ${warning.details}`);
      }
    }
    console.log();
  }

  if (result.errors.length === 0) {
    console.log("\n✓ Flow validation passed - all dependencies satisfied\n");
  } else {
    console.log("\n✗ Flow validation failed - dependencies must be resolved before copying\n");
  }
}

