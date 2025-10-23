
import { readFile } from "fs/promises";

import { createConnectClient } from "./connect/client.js";
import { gatherFlowInventory } from "./connect/flows.js";
import { gatherResourceInventory } from "./connect/resources.js";
import { buildInstanceInventory, buildAllResourceMappings } from "./mapping.js";


export interface ReportOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
}


interface ConnectConfig {
  instanceId: string;
  region: string;
}


export async function reportResourceDifferences(options: ReportOptions) {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig: ConnectConfig = JSON.parse(sourceConfigData);
  const targetConfig: ConnectConfig = JSON.parse(targetConfigData);

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("Gathering resource inventories...\n");

  const sourceFlows = await gatherFlowInventory(sourceClient, sourceConfig.instanceId);
  const sourceResources = await gatherResourceInventory(sourceClient, sourceConfig.instanceId);
  const sourceInventory = buildInstanceInventory(sourceFlows, sourceResources);

  const targetFlows = await gatherFlowInventory(targetClient, targetConfig.instanceId);
  const targetResources = await gatherResourceInventory(targetClient, targetConfig.instanceId);
  const targetInventory = buildInstanceInventory(targetFlows, targetResources);

  const mappings = buildAllResourceMappings(sourceInventory, targetInventory);

  if (mappings.missingResources.length === 0) {
    console.log("✓ All resources from source exist in target!");
    return;
  }

  console.log("Missing Resources in Target Instance:");
  console.log("======================================\n");

  const byType = new Map<string, string[]>();
  for (const missing of mappings.missingResources) {
    const names = byType.get(missing.type) ?? [];
    names.push(missing.name);
    byType.set(missing.type, names);
  }

  for (const [type, names] of byType) {
    console.log(`${type}s (${names.length} missing):`);
    for (const name of names) {
      console.log(`  - ${name}`);
    }
    console.log();
  }

  console.log(`Total: ${mappings.missingResources.length} resources in source but not in target`);
}
