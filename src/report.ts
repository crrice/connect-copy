
import { readFile } from "fs/promises";
import type { ConnectClient, ContactFlow, ContactFlowModule, ContactFlowSummary, ContactFlowModuleSummary } from "@aws-sdk/client-connect";
import { cliFlags } from "./cli-flags.js";
import { createConnectClient } from "./connect/client.js";
import { gatherFlowInventory, describeContactFlow, describeContactFlowModule } from "./connect/flows.js";
import { gatherResourceInventory } from "./connect/resources.js";
import { buildAllResourceMappings } from "./mapping.js";
import { matchesFlowFilters, matchesFlowFiltersWithReason } from "./filters.js";
import { validateFlowDependencies, validateSourceConfig, validateTargetConfig } from "./validation.js";
import { replaceArnsInContent } from "./arn-replacement.js";
import type { SourceConfig, TargetConfig, ValidationResult } from "./validation.js";
import type { InstanceInventory } from "./mapping.js";


export interface ReportOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  resourcesOnly: boolean;
}


export interface FlowComparisonResult {
  valid: boolean;
  flowsToCreateList: ContactFlowSummary[];
  flowsToUpdateList: ContactFlowSummary[];
  flowsToSkipList: ContactFlowSummary[];
  modulesToCreateList: ContactFlowModuleSummary[];
  modulesToUpdateList: ContactFlowModuleSummary[];
  modulesToSkipList: ContactFlowModuleSummary[];
  validationResult: ValidationResult;
}


export interface SetupResult {
  sourceClient: ConnectClient;
  targetClient: ConnectClient;
  sourceConfig: SourceConfig;
  targetConfig: TargetConfig;
  sourceInventory: InstanceInventory;
  targetInventory: InstanceInventory;
}


export async function setupInstanceComparison(sourceConfigPath: string, targetConfigPath: string, sourceProfile: string, targetProfile: string): Promise<SetupResult> {
  const sourceConfigData = await readFile(sourceConfigPath, "utf-8");
  const targetConfigData = await readFile(targetConfigPath, "utf-8");

  const sourceConfig = validateSourceConfig(JSON.parse(sourceConfigData));
  const targetConfig = validateTargetConfig(JSON.parse(targetConfigData));

  console.log("Source: " + sourceConfigPath);
  console.log(`  Instance ID: ${sourceConfig.instanceId}`);
  console.log(`  Region: ${sourceConfig.region}`);
  console.log(`  Profile: ${sourceProfile}`);

  console.log("\nTarget: " + targetConfigPath);
  console.log(`  Instance ID: ${targetConfig.instanceId}`);
  console.log(`  Region: ${targetConfig.region}`);
  console.log(`  Profile: ${targetProfile}`);

  const sourceClient = createConnectClient(sourceConfig.region, sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, targetProfile);

  console.log("\nGathering resource inventories...");

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

  return {
    sourceClient,
    targetClient,
    sourceConfig,
    targetConfig,
    sourceInventory,
    targetInventory
  };
}


function tagsEqual(tags1?: Record<string, string>, tags2?: Record<string, string>): boolean {
  const t1 = tags1 ?? {};
  const t2 = tags2 ?? {};

  const keys1 = Object.keys(t1);
  const keys2 = Object.keys(t2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (t1[key] !== t2[key]) return false;
  }

  return true;
}


function jsonSemanticallyEqual(sourceContent: string, targetContent: string, arnMappings: Map<string, string>): boolean {
  const normalizedSourceContent = replaceArnsInContent(sourceContent, arnMappings);

  const sourceObj = JSON.parse(normalizedSourceContent);
  const targetObj = JSON.parse(targetContent);

  const sourceNormalized = JSON.stringify(sourceObj);
  const targetNormalized = JSON.stringify(targetObj);

  return sourceNormalized === targetNormalized;
}


export async function compareAndValidateFlows(sourceClient: any, targetClient: any, sourceConfig: SourceConfig, targetConfig: TargetConfig, sourceInventory: InstanceInventory, targetInventory: InstanceInventory): Promise<FlowComparisonResult> {
    console.log("\n" + "=".repeat(50));
    console.log("Flow Content Comparison");
    console.log("=".repeat(50) + "\n");

    console.log("Applying filters...");

    if (cliFlags.verbose) {
      if (sourceConfig.flowFilters) {
        console.log("  Flow filters:");
        console.log(`    Include: ${JSON.stringify(sourceConfig.flowFilters.include ?? ["*"])}`);
        console.log(`    Exclude: ${JSON.stringify(sourceConfig.flowFilters.exclude ?? [])}`);
      } else {
        console.log("  Flow filters: none (include all)");
      }

      if (sourceConfig.moduleFilters) {
        console.log("  Module filters:");
        console.log(`    Include: ${JSON.stringify(sourceConfig.moduleFilters.include ?? ["*"])}`);
        console.log(`    Exclude: ${JSON.stringify(sourceConfig.moduleFilters.exclude ?? [])}`);
      } else {
        console.log("  Module filters: none (include all)");
      }
    }

    const sourceFlowsToCopy = sourceInventory.flows.filter(flow =>
      matchesFlowFilters(flow.Name ?? "", sourceConfig.flowFilters)
    );

    const sourceModulesToCopy = sourceInventory.modules.filter(module =>
      matchesFlowFilters(module.Name ?? "", sourceConfig.moduleFilters)
    );

    if (cliFlags.verbose) {
      const excludedFlows = sourceInventory.flows.filter(flow => !matchesFlowFilters(flow.Name ?? "", sourceConfig.flowFilters));

      if (excludedFlows.length > 0) {
        console.log(`\nExcluded flows (${excludedFlows.length}):`);
        for (const flow of excludedFlows) {
          const result = matchesFlowFiltersWithReason(flow.Name ?? "", sourceConfig.flowFilters);
          console.log(`  - ${flow.Name} (${result.reason})`);
        }
      }

      const excludedModules = sourceInventory.modules.filter(module => !matchesFlowFilters(module.Name ?? "", sourceConfig.moduleFilters));

      if (excludedModules.length > 0) {
        console.log(`\nExcluded modules (${excludedModules.length}):`);
        for (const module of excludedModules) {
          const result = matchesFlowFiltersWithReason(module.Name ?? "", sourceConfig.moduleFilters);
          console.log(`  - ${module.Name} (${result.reason})`);
        }
      }

      console.log();
    }

    console.log(`Filtered: ${sourceFlowsToCopy.length} flows (${sourceInventory.flows.length} total), ${sourceModulesToCopy.length} modules (${sourceInventory.modules.length} total)`);

    console.log("Describing flows and modules...");

    const targetFlowsByName = new Map(targetInventory.flows.map(f => [f.Name!, f]));
    const targetModulesByName = new Map(targetInventory.modules.map(m => [m.Name!, m]));

    const sourceFlowDetails = new Map<string, ContactFlow>();
    const sourceModuleDetails = new Map<string, ContactFlowModule>();
    const targetFlowDetails = new Map<string, ContactFlow>();
    const targetModuleDetails = new Map<string, ContactFlowModule>();
    const flowsToValidate: ContactFlowSummary[] = [];
    const modulesToValidate: ContactFlowModuleSummary[] = [];

    const resourceMappings = buildAllResourceMappings(sourceInventory, targetInventory);
    const arnMap = resourceMappings.arnMap;

    const flowsToCreateList: ContactFlowSummary[] = [];
    const flowsToUpdateList: ContactFlowSummary[] = [];
    const flowsToSkipList: ContactFlowSummary[] = [];
    let flowStatusExcluded = 0;

    for (const flowSummary of sourceFlowsToCopy) {
      const flowName = flowSummary.Name!;
      const sourceFlowFull = await describeContactFlow(sourceClient, sourceConfig.instanceId, flowSummary.Id!);

      if (sourceFlowFull.Status !== "PUBLISHED") {
        flowStatusExcluded++;
        if (cliFlags.verbose) {
          console.log(`  ${flowName}: Skip (source Status=${sourceFlowFull.Status}, only PUBLISHED flows are copied)`);
        }
        continue;
      }

      const targetFlow = targetFlowsByName.get(flowName);

      if (!targetFlow) {
        sourceFlowDetails.set(flowSummary.Id!, sourceFlowFull);
        flowsToValidate.push(flowSummary);
        flowsToCreateList.push(flowSummary);
        if (cliFlags.verbose) {
          console.log(`  ${flowName}: Create (does not exist in target)`);
        }
        continue;
      }

      const targetFlowFull = await describeContactFlow(targetClient, targetConfig.instanceId, targetFlow.Id!);

      const contentDiffers = !jsonSemanticallyEqual(sourceFlowFull.Content!, targetFlowFull.Content!, arnMap);
      const descriptionDiffers = sourceFlowFull.Description !== targetFlowFull.Description;
      const tagsDiffer = !tagsEqual(sourceFlowFull.Tags, targetFlowFull.Tags);
      const statusDiffers = sourceFlowFull.Status === "PUBLISHED" && targetFlowFull.Status === "SAVED" && cliFlags.publish;

      if (contentDiffers || descriptionDiffers || tagsDiffer || statusDiffers) {
        sourceFlowDetails.set(flowSummary.Id!, sourceFlowFull);
        targetFlowDetails.set(targetFlow.Id!, targetFlowFull);
        flowsToValidate.push(flowSummary);
        flowsToUpdateList.push(targetFlow);
        if (cliFlags.verbose) {
          const reasons = [];
          if (contentDiffers) reasons.push("content");
          if (descriptionDiffers) reasons.push("description");
          if (tagsDiffer) reasons.push("tags");
          if (statusDiffers) reasons.push("status");
          console.log(`  ${flowName}: Update (${reasons.join(", ")} differs)`);
        }
      } else {
        flowsToSkipList.push(targetFlow);
        if (cliFlags.verbose) {
          console.log(`  ${flowName}: Skip (content matches)`);
        }
      }
    }

    if (flowStatusExcluded > 0) {
      console.log(`\nExcluded ${flowStatusExcluded} flow${flowStatusExcluded === 1 ? '' : 's'} (source Status≠PUBLISHED)`);
    }

    const modulesToCreateList: ContactFlowModuleSummary[] = [];
    const modulesToUpdateList: ContactFlowModuleSummary[] = [];
    const modulesToSkipList: ContactFlowModuleSummary[] = [];

    for (const moduleSummary of sourceModulesToCopy) {
      const moduleName = moduleSummary.Name!;
      const sourceModuleFull = await describeContactFlowModule(sourceClient, sourceConfig.instanceId, moduleSummary.Id!);
      const targetModule = targetModulesByName.get(moduleName);

      if (!targetModule) {
        sourceModuleDetails.set(moduleSummary.Id!, sourceModuleFull);
        modulesToValidate.push(moduleSummary);
        modulesToCreateList.push(moduleSummary);
        if (cliFlags.verbose) {
          console.log(`  ${moduleName}: Create (does not exist in target)`);
        }
        continue;
      }

      const targetModuleFull = await describeContactFlowModule(targetClient, targetConfig.instanceId, targetModule.Id!);

      const contentDiffers = !jsonSemanticallyEqual(sourceModuleFull.Content!, targetModuleFull.Content!, arnMap);
      const descriptionDiffers = sourceModuleFull.Description !== targetModuleFull.Description;
      const tagsDiffer = !tagsEqual(sourceModuleFull.Tags, targetModuleFull.Tags);

      if (contentDiffers || descriptionDiffers || tagsDiffer) {
        sourceModuleDetails.set(moduleSummary.Id!, sourceModuleFull);
        targetModuleDetails.set(targetModule.Id!, targetModuleFull);
        modulesToValidate.push(moduleSummary);
        modulesToUpdateList.push(targetModule);
        if (cliFlags.verbose) {
          const reasons = [];
          if (contentDiffers) reasons.push("content");
          if (descriptionDiffers) reasons.push("description");
          if (tagsDiffer) reasons.push("tags");
          console.log(`  ${moduleName}: Update (${reasons.join(", ")} differs)`);
        }
      } else {
        modulesToSkipList.push(targetModule);
        if (cliFlags.verbose) {
          console.log(`  ${moduleName}: Skip (content matches)`);
        }
      }
    }

    console.log(`\nComparison summary:`);
    console.log(`  Flows: ${flowsToCreateList.length} create, ${flowsToUpdateList.length} update, ${flowsToSkipList.length} skip`);
    console.log(`  Modules: ${modulesToCreateList.length} create, ${modulesToUpdateList.length} update, ${modulesToSkipList.length} skip`);

    console.log("\n" + "=".repeat(50));
    console.log("Flow Dependency Validation");
    console.log("=".repeat(50) + "\n");

    const validationResult = validateFlowDependencies(
      sourceInventory,
      targetInventory,
      flowsToValidate,
      modulesToValidate,
      sourceFlowDetails,
      sourceModuleDetails,
      targetFlowDetails,
      targetModuleDetails,
      cliFlags.verbose
    );

    displayValidationReport(validationResult);

    return {
      valid: validationResult.valid,
      flowsToCreateList,
      flowsToUpdateList,
      flowsToSkipList,
      modulesToCreateList,
      modulesToUpdateList,
      modulesToSkipList,
      validationResult
    };
}


export async function runReport(options: ReportOptions) {
  const { sourceClient, targetClient, sourceConfig, targetConfig, sourceInventory, targetInventory } = await setupInstanceComparison(
    options.sourceConfig,
    options.targetConfig,
    options.sourceProfile,
    options.targetProfile
  );

  reportResourceDifferences(sourceInventory, targetInventory);

  if (!options.resourcesOnly) {
    await compareAndValidateFlows(sourceClient, targetClient, sourceConfig, targetConfig, sourceInventory, targetInventory);
  }
}


export function reportResourceDifferences(sourceInventory: InstanceInventory, targetInventory: InstanceInventory): boolean {
  const mappings = buildAllResourceMappings(sourceInventory, targetInventory);

  if (mappings.missingResources.length === 0) {
    console.log("\n" + "=".repeat(50));
    console.log("Resource Inventory Comparison");
    console.log("=".repeat(50) + "\n");
    console.log("✓ All resources from source exist in target!\n");
    return false;
  }

  console.log("\n" + "=".repeat(50));
  console.log("Resource Inventory Comparison");
  console.log("=".repeat(50) + "\n");

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

  if (hasMissing.length > 0) {
    console.log("❌ Missing Resources:");
    console.log("===================\n");

    for (const type of hasMissing) {
      const names = byType.get(type)!;
      console.log(`${pluralize(type)} (${names.length} missing):`);
      for (const name of names) {
        console.log(`  - ${name}`);
      }
      console.log();
    }
  }

  if (noMissing.length > 0) {
    console.log("✓ Resources Present:");
    console.log("===================\n");

    for (const type of noMissing) {
      console.log(`${pluralize(type)} (0 missing)`);
    }
    console.log();
  }

  console.log(`Total: ${mappings.missingResources.length} resources in source but not in target\n`);
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
    console.log("===========\n");
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

