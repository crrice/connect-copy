
import { createInterface } from "readline";
import { readFile } from "fs/promises";
import { reportResourceDifferences, compareAndValidateFlows, setupInstanceComparison } from "./report.js";
import { createBackup } from "./backup.js";
import { createContactFlow, createContactFlowModule, updateContactFlowModuleContent } from "./connect/operations.js";
import { replaceArnsInContent } from "./arn-replacement.js";

import type { ConnectClient, ContactFlowType, ContactFlowSummary, ContactFlowModuleSummary, ContactFlow, ContactFlowModule } from "@aws-sdk/client-connect";
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


// CAMPAIGN flow type is not supported - requires Outbound Campaigns feature
// which needs KMS setup, dedicated queues, and special phone numbers.
// Template: templates/flows/default-campaign-content.json (does not exist)
// TODO: Add CAMPAIGN support when Outbound Campaigns are enabled in test instance
// @ts-expect-error - CAMPAIGN type intentionally omitted until needed
const FLOW_TYPE_TO_TEMPLATE: Record<ContactFlowType, string> = {
  'CONTACT_FLOW': 'templates/flows/default-inbound-content.json',
  'CUSTOMER_QUEUE': 'templates/flows/default-customer-queue-content.json',
  'CUSTOMER_HOLD': 'templates/flows/default-customer-hold-content.json',
  'CUSTOMER_WHISPER': 'templates/flows/default-customer-whisper-content.json',
  'AGENT_HOLD': 'templates/flows/default-agent-hold-content.json',
  'AGENT_WHISPER': 'templates/flows/default-agent-whisper-content.json',
  'OUTBOUND_WHISPER': 'templates/flows/default-outbound-content.json',
  'AGENT_TRANSFER': 'templates/flows/default-agent-transfer-content.json',
  'QUEUE_TRANSFER': 'templates/flows/default-queue-transfer-content.json'
};


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


async function generateModuleStubContent(): Promise<string> {
  const templateContent = await readFile('templates/modules/default-module-content.json', 'utf-8');
  return templateContent;
}


async function generateFlowStubContent(flowType: ContactFlowType): Promise<string> {
  const templatePath = FLOW_TYPE_TO_TEMPLATE[flowType];

  if (!templatePath) {
    throw new Error(`Unsupported flow type: ${flowType}`);
  }

  const templateContent = await readFile(templatePath, 'utf-8');
  return templateContent;
}


async function createStubResources(targetClient: ConnectClient, targetInstanceId: string, modulesToCreate: ContactFlowModuleSummary[], flowsToCreate: ContactFlowSummary[], sourceModuleDetails: Map<string, ContactFlowModule>, sourceFlowDetails: Map<string, ContactFlow>): Promise<Map<string, string>> {
  const arnMapping = new Map<string, string>();

  console.log("\nPass 1: Creating stub resources...");

  for (const moduleSummary of modulesToCreate) {
    const sourceModule = sourceModuleDetails.get(moduleSummary.Id!);
    if (!sourceModule) continue;

    const stubContent = await generateModuleStubContent();

    const result = await createContactFlowModule(
      targetClient,
      targetInstanceId,
      sourceModule.Name!,
      stubContent,
      sourceModule.Description,
      sourceModule.Tags
    );

    arnMapping.set(sourceModule.Arn!, result.arn);
    console.log(`  Created stub module: ${sourceModule.Name}`);
  }

  for (const flowSummary of flowsToCreate) {
    const sourceFlow = sourceFlowDetails.get(flowSummary.Id!);
    if (!sourceFlow) continue;

    const stubContent = await generateFlowStubContent(sourceFlow.Type!);

    const result = await createContactFlow(
      targetClient,
      targetInstanceId,
      sourceFlow.Name!,
      stubContent,
      sourceFlow.Type!,
      sourceFlow.Description,
      sourceFlow.Tags,
      "SAVED"
    );

    arnMapping.set(sourceFlow.Arn!, result.arn);
    console.log(`  Created stub flow: ${sourceFlow.Name}`);
  }

  console.log(`\nCreated ${modulesToCreate.length} modules and ${flowsToCreate.length} flows`);

  return arnMapping;
}


async function updateModuleContents(targetClient: ConnectClient, targetInstanceId: string, modulesToCreate: ContactFlowModuleSummary[], modulesToUpdate: ContactFlowModuleSummary[], sourceModuleDetails: Map<string, ContactFlowModule>, targetModuleSummaries: ContactFlowModuleSummary[], createdArnMappings: Map<string, string>, completeMappings: Map<string, string>) {
  console.log("\nPass 2: Updating module content...");

  for (const moduleSummary of modulesToCreate) {
    const sourceModule = sourceModuleDetails.get(moduleSummary.Id!);
    if (!sourceModule) continue;

    const updatedContent = replaceArnsInContent(sourceModule.Content!, completeMappings);
    const targetArn = createdArnMappings.get(sourceModule.Arn!);
    if (!targetArn) continue;

    const targetModuleId = targetArn.split('/').pop()!;

    await updateContactFlowModuleContent(
      targetClient,
      targetInstanceId,
      targetModuleId,
      updatedContent
    );

    console.log(`  Updated content for created module: ${sourceModule.Name}`);
  }

  for (const moduleSummary of modulesToUpdate) {
    const sourceModule = sourceModuleDetails.get(moduleSummary.Id!);
    if (!sourceModule) continue;

    const updatedContent = replaceArnsInContent(sourceModule.Content!, completeMappings);

    const targetModule = targetModuleSummaries.find(m => m.Name === sourceModule.Name);
    if (!targetModule) continue;

    await updateContactFlowModuleContent(
      targetClient,
      targetInstanceId,
      targetModule.Id!,
      updatedContent
    );

    console.log(`  Updated content for existing module: ${sourceModule.Name}`);
  }

  console.log(`\nUpdated ${modulesToCreate.length + modulesToUpdate.length} modules`);
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

  console.log("\nPhase 3: Creating backup...");
  await createBackup(
    targetClient,
    targetConfig.instanceId,
    targetConfig.region,
    comparisonResult.flowsToUpdateList,
    comparisonResult.modulesToUpdateList
  );

  const createdArnMappings = await createStubResources(
    targetClient,
    targetConfig.instanceId,
    comparisonResult.modulesToCreateList,
    comparisonResult.flowsToCreateList,
    comparisonResult.validationResult.sourceModuleDetails,
    comparisonResult.validationResult.sourceFlowDetails
  );

  const completeMappings = new Map([
    ...comparisonResult.validationResult.resourceMappings.arnMap,
    ...createdArnMappings
  ]);

  console.log(`\nComplete ARN mappings: ${completeMappings.size} total (${comparisonResult.validationResult.resourceMappings.arnMap.size} existing + ${createdArnMappings.size} created)`);

  await updateModuleContents(
    targetClient,
    targetConfig.instanceId,
    comparisonResult.modulesToCreateList,
    comparisonResult.modulesToUpdateList,
    comparisonResult.validationResult.sourceModuleDetails,
    targetInventory.modules,
    createdArnMappings,
    completeMappings
  );

  console.log("\nTODO: Implement Pass 2 for flows and Pass 3 (metadata/publishing)");
}

