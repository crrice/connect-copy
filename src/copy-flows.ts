
import { readFile } from "fs/promises";
import type { ContactFlowSummary, ContactFlowModuleSummary } from "@aws-sdk/client-connect";
import { createConnectClient } from "./connect/client.js";
import { listContactFlows, listContactFlowModules, describeContactFlowModule } from "./connect/flows.js";
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

export interface ResourceInventory {
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

  console.log("Gathering resource inventory...");

  const allSourceFlows = await listContactFlows(sourceClient, sourceConfig.instanceId);
  const sourceFlowsToCopy = allSourceFlows.filter(flow =>
    matchesFlowFilters(flow.Name ?? "", sourceConfig.flowFilters)
  );

  const allSourceModules = await listContactFlowModules(sourceClient, sourceConfig.instanceId);
  const sourceModulesToCopy = allSourceModules.filter(module =>
    matchesFlowFilters(module.Name ?? "", sourceConfig.moduleFilters)
  );

  const allTargetFlows = await listContactFlows(targetClient, targetConfig.instanceId);
  const targetFlowsByName = Object.fromEntries(
    allTargetFlows.map(flow => [flow.Name!, flow])
  );

  const allTargetModules = await listContactFlowModules(targetClient, targetConfig.instanceId);
  const targetModulesByName = Object.fromEntries(
    allTargetModules.map(module => [module.Name!, module])
  );

  // const inventory: ResourceInventory = {
  //   sourceFlowsToCopy,
  //   sourceModulesToCopy,
  //   targetFlowsByName,
  //   targetModulesByName
  // };

  console.log(`Source: ${sourceFlowsToCopy.length} flows (${allSourceFlows.length} total, ${allSourceFlows.length - sourceFlowsToCopy.length} filtered), ${sourceModulesToCopy.length} modules (${allSourceModules.length} total, ${allSourceModules.length - sourceModulesToCopy.length} filtered)`);
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

