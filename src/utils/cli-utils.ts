
import { readFile } from "fs/promises";
import { createInterface } from "readline";

import { validateSourceConfig, validateTargetConfig } from "../validation.js";

import type { SourceConfig, TargetConfig } from "../validation.js";

import type { ConnectClient } from "@aws-sdk/client-connect";
import type { FilterConfig } from "../validation.ts";


export async function promptContinue(message: string): Promise<boolean> {
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


interface EnvOptions {
  sourceConfig: string;
  targetConfig: string;

  sourceProfile: string;
  targetProfile: string;
}

export interface ResourceComparisonConfig {
  sourceClient: ConnectClient;
  targetClient: ConnectClient;

  sourceInstanceId: string;
  targetInstanceId: string;

  filterConfig: FilterConfig | undefined;
}

export async function loadConfigs(options: EnvOptions): Promise<{ source: SourceConfig; target: TargetConfig }> {
  const sourceConfigData = await readFile(options.sourceConfig, "utf-8");
  const targetConfigData = await readFile(options.targetConfig, "utf-8");

  const sourceConfig = validateSourceConfig(JSON.parse(sourceConfigData));
  const targetConfig = validateTargetConfig(JSON.parse(targetConfigData));

  console.log("Source: " + options.sourceConfig);
  console.log(`  Instance ID: ${sourceConfig.instanceId}`);
  console.log(`  Region: ${sourceConfig.region}`);
  console.log(`  Profile: ${options.sourceProfile}`);

  console.log("\nTarget: " + options.targetConfig);
  console.log(`  Instance ID: ${targetConfig.instanceId}`);
  console.log(`  Region: ${targetConfig.region}`);
  console.log(`  Profile: ${options.targetProfile}`);

  return { source: sourceConfig, target: targetConfig };
}


export function recordsMatch(source?: Record<string, string>, target?: Record<string, string>): boolean {
  if (source === undefined && target === undefined) return true;
  if (source === undefined || target === undefined) return false;

  const sourceKeys = Object.keys(source).sort();
  const targetKeys = Object.keys(target).sort();

  if (sourceKeys.length !== targetKeys.length) return false;

  return sourceKeys.every(key => source[key] === target[key]);
}


export function getRecordDiff(source: Record<string, string> = {}, target: Record<string, string> = {}): { toAdd: Record<string, string>; toRemove: string[] } {

  const toAdd = Object.fromEntries(Object.entries(source)
    .filter(([key, value]) => target[key] !== value));

  const toRemove = Object.keys(target)
    .filter(key => !(key in source));

  return { toAdd, toRemove };
}

export function arraysMatch(source: string[] | undefined, target: string[] | undefined): boolean {
  if (source === undefined && target === undefined) return true;
  if (source === undefined || target === undefined) return false;
  if (source.length !== target.length) return false;

  const sourceSorted = [...source].sort();
  const targetSorted = [...target].sort();

  return sourceSorted.every((item, index) => targetSorted[index] === item);
}
