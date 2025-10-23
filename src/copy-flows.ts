
import { readFile } from "fs/promises";
import { createInterface } from "readline";
import type { ContactFlow, ContactFlowModule } from "@aws-sdk/client-connect";
import { createConnectClient } from "./connect/client.js";
import { gatherFlowInventory, describeContactFlow, describeContactFlowModule } from "./connect/flows.js";
import { gatherResourceInventory } from "./connect/resources.js";
import { matchesFlowFilters } from "./filters.js";
import { validateFlowDependencies } from "./validation.js";
import { reportResourceDifferences, displayValidationReport } from "./report.js";
import type { ConnectConfig } from "./validation.js";

export interface CopyFlowsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  publish: boolean;
  verbose: boolean;
}


async function promptContinue(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`\n${message} (y/n): `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}


export async function copyFlows(options: CopyFlowsOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig: ConnectConfig = JSON.parse(sourceConfigData);
  const targetConfig: ConnectConfig = JSON.parse(targetConfigData);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("Phase 1: Validating resources...\n");
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

  const hasMissingResources = reportResourceDifferences(sourceInventory, targetInventory);

  if (hasMissingResources) {
    const shouldContinue = await promptContinue("Continue to flow validation?");
    if (!shouldContinue) {
      console.log("Validation cancelled by user");
      process.exit(0);
    }
  }

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

  if (!validationResult.valid) {
    process.exit(1);
  }

  console.log("Validation complete - ready for Phase 2 (user confirmation)");
}

