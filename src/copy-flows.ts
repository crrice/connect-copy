
import { createInterface } from "readline";
import { reportResourceDifferences, compareAndValidateFlows, setupInstanceComparison } from "./report.js";

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
  console.log("Phase 1: Validating resources...\n");

  const { sourceClient, targetClient, sourceConfig, targetConfig, sourceInventory, targetInventory } = await setupInstanceComparison(
    options.sourceConfig,
    options.targetConfig,
    options.sourceProfile,
    options.targetProfile
  );

  const hasMissingResources = reportResourceDifferences(sourceInventory, targetInventory);

  if (hasMissingResources) {
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

  if (comparisonResult.flowsToCreate === 0 && comparisonResult.flowsToUpdate === 0 && comparisonResult.modulesToCreate === 0 && comparisonResult.modulesToUpdate === 0) {
    console.log("\nNo flows or modules need to be copied - all content matches");
    return;
  }

  console.log("Validation complete - ready for Phase 2 (user confirmation)");
}

