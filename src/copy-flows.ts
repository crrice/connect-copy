
import { readFile } from "fs/promises";

import type { ContactFlowSummary, ContactFlowModuleSummary } from "@aws-sdk/client-connect";

import { createConnectClient } from "./connect/client.js";
import { gatherFlowInventory, describeContactFlowModule } from "./connect/flows.js";
import { matchesFlowFilters } from "./filters.js";
import { extractDependencyArnsFromFlow } from "./arn-utils.js";

export interface CopyFlowsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  publish: boolean;
  verbose: boolean;
}

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
}

export interface FilteredFlowInventory {
  sourceFlowsToCopy: ContactFlowSummary[];
  sourceModulesToCopy: ContactFlowModuleSummary[];
  targetFlowsByName: Record<string, ContactFlowSummary>;
  targetModulesByName: Record<string, ContactFlowModuleSummary>;
}


export async function copyFlows(options: CopyFlowsOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig: ConnectConfig = JSON.parse(sourceConfigData);
  const targetConfig: ConnectConfig = JSON.parse(targetConfigData);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("Gathering resource inventories...");

  const sourceFlows = await gatherFlowInventory(sourceClient, sourceConfig.instanceId);
  const targetFlows = await gatherFlowInventory(targetClient, targetConfig.instanceId);

  // TODO: Gather full inventories and build mappings for validation
  // const sourceResources = await gatherResourceInventory(sourceClient, sourceConfig.instanceId);
  // const sourceInventory = buildInstanceInventory(sourceFlows, sourceResources);
  // const targetResources = await gatherResourceInventory(targetClient, targetConfig.instanceId);
  // const targetInventory = buildInstanceInventory(targetFlows, targetResources);
  // const mappings = buildAllResourceMappings(sourceInventory, targetInventory);

  const sourceFlowsToCopy = sourceFlows.flows.filter(flow =>
    matchesFlowFilters(flow.Name ?? "", sourceConfig.flowFilters)
  );

  const sourceModulesToCopy = sourceFlows.modules.filter(module =>
    matchesFlowFilters(module.Name ?? "", sourceConfig.moduleFilters)
  );

  const targetFlowsByName = Object.fromEntries(
    targetFlows.flows.map(flow => [flow.Name!, flow])
  );

  const targetModulesByName = Object.fromEntries(
    targetFlows.modules.map(module => [module.Name!, module])
  );

  console.log(`Source: ${sourceFlowsToCopy.length} flows (${sourceFlows.flows.length} total, ${sourceFlows.flows.length - sourceFlowsToCopy.length} filtered), ${sourceModulesToCopy.length} modules (${sourceFlows.modules.length} total, ${sourceFlows.modules.length - sourceModulesToCopy.length} filtered)`);
  console.log(`Target: ${Object.keys(targetFlowsByName).length} flows, ${Object.keys(targetModulesByName).length} modules`);

  console.log("\nAnalyzing module dependencies...");

  for (const moduleSummary of sourceModulesToCopy) {
    const fullModule = await describeContactFlowModule(
      sourceClient,
      sourceConfig.instanceId,
      moduleSummary.Id!
    );

    const arns = extractDependencyArnsFromFlow(fullModule);

    if (options.verbose) {
      console.log(`Module "${fullModule.Name}": ${arns.length} ARN dependencies`);
      arns.forEach(arn => console.log(`  - ${arn}`));
    }
  }
}

