
import { createInterface } from "readline";
import { reportResourceDifferences, compareAndValidateFlows, setupInstanceComparison } from "./report.js";

import type { FlowComparisonResult } from "./report.js";


export interface CopyFlowsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  publish: boolean;
  yes: boolean;
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


async function promptConfirm(message: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(`\n${message}\nType "confirm" to proceed: `, answer => {
      rl.close();
      resolve(answer.toLowerCase() === 'confirm');
    });
  });
}


function displayCopyPlan(comparisonResult: FlowComparisonResult) {
  console.log("\n" + "=".repeat(50));
  console.log("Copy Plan");
  console.log("=".repeat(50) + "\n");

  if (comparisonResult.modulesToCreateList.length > 0) {
    console.log(`Modules to create (${comparisonResult.modulesToCreateList.length}):`);
    for (const module of comparisonResult.modulesToCreateList) {
      console.log(`  - ${module.Name}`);
    }
    console.log();
  }

  if (comparisonResult.flowsToCreateList.length > 0) {
    console.log(`Flows to create (${comparisonResult.flowsToCreateList.length}):`);
    for (const flow of comparisonResult.flowsToCreateList) {
      console.log(`  - ${flow.Name}`);
    }
    console.log();
  }

  if (comparisonResult.modulesToUpdateList.length > 0) {
    console.log(`Modules to update (${comparisonResult.modulesToUpdateList.length}):`);
    for (const module of comparisonResult.modulesToUpdateList) {
      console.log(`  - ${module.Name}`);
    }
    console.log();
  }

  if (comparisonResult.flowsToUpdateList.length > 0) {
    console.log(`Flows to update (${comparisonResult.flowsToUpdateList.length}):`);
    for (const flow of comparisonResult.flowsToUpdateList) {
      console.log(`  - ${flow.Name}`);
    }
    console.log();
  }

  const totalCreates = comparisonResult.flowsToCreateList.length + comparisonResult.modulesToCreateList.length;
  const totalUpdates = comparisonResult.flowsToUpdateList.length + comparisonResult.modulesToUpdateList.length;

  console.log(`Total changes: ${totalCreates} creates, ${totalUpdates} updates\n`);
}


export async function copyFlows(options: CopyFlowsOptions) {
  console.log("Phase 1: Validating resources...\n");

  const { sourceClient, targetClient, sourceConfig, targetConfig, sourceInventory, targetInventory } = await setupInstanceComparison(
    options.sourceConfig,
    options.targetConfig,
    options.sourceProfile,
    options.targetProfile
  );

  const hasMissingResources = reportResourceDifferences(sourceInventory, targetInventory);

  if (hasMissingResources && !options.yes) {
    const shouldContinue = await promptContinue("Continue to flow validation?");
    if (!shouldContinue) {
      console.log("Validation cancelled by user");
      process.exit(0);
    }
  }

  const comparisonResult = await compareAndValidateFlows(
    sourceClient,
    targetClient,
    sourceConfig,
    targetConfig,
    sourceInventory,
    targetInventory,
    options.verbose
  );

  if (!comparisonResult.valid) {
    process.exit(1);
  }

  if (comparisonResult.flowsToCreateList.length === 0 && comparisonResult.flowsToUpdateList.length === 0 && comparisonResult.modulesToCreateList.length === 0 && comparisonResult.modulesToUpdateList.length === 0) {
    console.log("\nNo flows or modules need to be copied - all content matches");
    return;
  }

  displayCopyPlan(comparisonResult);

  if (!options.yes) {
    const shouldProceed = await promptConfirm("Proceed with copy? This will create/update flows in the target instance.");
    if (!shouldProceed) {
      console.log("Copy cancelled by user");
      process.exit(0);
    }
  } else {
    console.log("Auto-confirming copy (--yes flag set)");
  }

  console.log("\nPhase 2: User confirmed - ready for Phase 3 (execution)");
  console.log("TODO: Implement copy execution");
}

