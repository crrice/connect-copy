
import { readFile } from "fs/promises";
import { createInterface } from "readline";
import { TagResourceCommand, UntagResourceCommand } from "@aws-sdk/client-connect";

import type { ConnectClient } from "@aws-sdk/client-connect";

import { createConnectClient } from "../../connect/client.js";
import { validateSourceConfig, validateTargetConfig } from "../../validation.js";
import { compareHoursOfOperations, getHoursOfOperationDiff, getHoursOfOperationTagDiff } from "./report.js";
import { createHoursOfOperation, updateHoursOfOperation } from "./operations.js";

import type { HoursOfOperationComparisonResult } from "./report.js";
import type { CreateHoursOfOperationConfig, UpdateHoursOfOperationConfig } from "./operations.js";


export interface CopyHoursOfOperationsOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
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


function displayHoursOfOperationPlan(result: HoursOfOperationComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === 'create');
  const toUpdate = result.actions.filter(a => a.action === 'update');
  const toUpdateTagsOnly = result.actions.filter(a => a.action === 'skip' && a.tagsNeedUpdate);
  const toSkip = result.actions.filter(a => a.action === 'skip' && !a.tagsNeedUpdate);

  console.log(`\nSummary:`);
  console.log(`  Hours of operation to create: ${toCreate.length}`);
  console.log(`  Hours of operation to update: ${toUpdate.length}`);
  if (toUpdateTagsOnly.length > 0) {
    console.log(`  Hours of operation to update tags only: ${toUpdateTagsOnly.length}`);
  }
  console.log(`  Hours of operation to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.hoursToProcess.length}`);

  if (toCreate.length > 0) {
    console.log(`\nHours of operation to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.hoursName}`);
      if (verbose) {
        const hours = action.sourceHours;
        console.log(`      TimeZone: ${hours.TimeZone}`);
        if (hours.Description) console.log(`      Description: ${hours.Description}`);
        if (hours.Config && hours.Config.length > 0) {
          console.log(`      Schedule:`);
          for (const config of hours.Config) {
            const start = `${String(config.StartTime!.Hours).padStart(2, '0')}:${String(config.StartTime!.Minutes).padStart(2, '0')}`;
            const end = `${String(config.EndTime!.Hours).padStart(2, '0')}:${String(config.EndTime!.Minutes).padStart(2, '0')}`;
            console.log(`        ${config.Day}: ${start}-${end}`);
          }
        }
        if (hours.Tags && Object.keys(hours.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(hours.Tags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      }
    }
  }

  if (toUpdate.length > 0) {
    console.log(`\nHours of operation to update:`);
    for (const action of toUpdate) {
      console.log(`  - ${action.hoursName}`);
      if (verbose && action.targetHours) {
        const diffs = getHoursOfOperationDiff(action.sourceHours, action.targetHours);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
        if (action.tagsNeedUpdate) {
          const tagDiff = getHoursOfOperationTagDiff(action.sourceHours, action.targetHours);
          if (tagDiff.toAdd.length > 0) console.log(`      Tags to add: ${tagDiff.toAdd.join(', ')}`);
          if (tagDiff.toRemove.length > 0) console.log(`      Tags to remove: ${tagDiff.toRemove.join(', ')}`);
        }
      }
    }
  }

  if (toUpdateTagsOnly.length > 0 && verbose) {
    console.log(`\nHours of operation with tag updates only:`);
    for (const action of toUpdateTagsOnly) {
      console.log(`  - ${action.hoursName}`);
      if (action.targetHours) {
        const tagDiff = getHoursOfOperationTagDiff(action.sourceHours, action.targetHours);
        if (tagDiff.toAdd.length > 0) console.log(`      Tags to add: ${tagDiff.toAdd.join(', ')}`);
        if (tagDiff.toRemove.length > 0) console.log(`      Tags to remove: ${tagDiff.toRemove.join(', ')}`);
      }
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nHours of operation to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.hoursName}`);
    }
  }
}


async function executeHoursOfOperationCopy(targetClient: ConnectClient, targetInstanceId: string, result: HoursOfOperationComparisonResult, verbose: boolean) {
  let created = 0;
  let updated = 0;
  let tagsUpdated = 0;

  for (const action of result.actions) {
    if (action.action === 'skip' && !action.tagsNeedUpdate) continue;

    if (action.action === 'create') {
      console.log(`Creating hours of operation: ${action.hoursName}`);
      if (verbose) {
        const hours = action.sourceHours;
        console.log(`  TimeZone: ${hours.TimeZone}`);
        if (hours.Description) console.log(`  Description: ${hours.Description}`);
        if (hours.Config && hours.Config.length > 0) {
          console.log(`  Schedule:`);
          for (const config of hours.Config) {
            const start = `${String(config.StartTime!.Hours).padStart(2, '0')}:${String(config.StartTime!.Minutes).padStart(2, '0')}`;
            const end = `${String(config.EndTime!.Hours).padStart(2, '0')}:${String(config.EndTime!.Minutes).padStart(2, '0')}`;
            console.log(`    ${config.Day}: ${start}-${end}`);
          }
        }
        if (hours.Tags && Object.keys(hours.Tags).length > 0) {
          console.log(`  Tags: ${Object.entries(hours.Tags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      }
      await createHoursOfOperation(targetClient, targetInstanceId, {
        Name: action.sourceHours.Name!,
        Description: action.sourceHours.Description,
        TimeZone: action.sourceHours.TimeZone!,
        Config: action.sourceHours.Config!,
        Tags: action.sourceHours.Tags
      } as CreateHoursOfOperationConfig);
      created++;
    }

    if (action.action === 'update') {
      console.log(`Updating hours of operation: ${action.hoursName}`);
      if (verbose && action.targetHours) {
        const diffs = getHoursOfOperationDiff(action.sourceHours, action.targetHours);
        for (const diff of diffs) {
          console.log(`  ${diff}`);
        }
      }

      await updateHoursOfOperation(targetClient, targetInstanceId, action.targetHoursId!, {
        Name: action.sourceHours.Name,
        Description: action.sourceHours.Description,
        TimeZone: action.sourceHours.TimeZone,
        Config: action.sourceHours.Config
      } as UpdateHoursOfOperationConfig);
      updated++;
    }

    if (action.tagsNeedUpdate) {
      console.log(`Updating tags for hours of operation: ${action.hoursName}`);

      const sourceTags = action.sourceHours.Tags ?? {};
      const targetTags = action.targetHours?.Tags ?? {};

      const tagsToAdd: Record<string, string> = {};
      for (const [key, value] of Object.entries(sourceTags)) {
        if (targetTags[key] !== value) {
          tagsToAdd[key] = value;
        }
      }

      const tagsToRemove = Object.keys(targetTags).filter(key => !(key in sourceTags));

      if (verbose) {
        if (Object.keys(tagsToAdd).length > 0) {
          console.log(`  Tags to add: ${Object.entries(tagsToAdd).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
        if (tagsToRemove.length > 0) {
          console.log(`  Tags to remove: ${tagsToRemove.join(', ')}`);
        }
      }

      if (Object.keys(tagsToAdd).length > 0) {
        await targetClient.send(
          new TagResourceCommand({
            resourceArn: action.targetHoursArn!,
            tags: tagsToAdd
          })
        );
      }

      if (tagsToRemove.length > 0) {
        await targetClient.send(
          new UntagResourceCommand({
            resourceArn: action.targetHoursArn!,
            tagKeys: tagsToRemove
          })
        );
      }

      tagsUpdated++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updated} updated, ${tagsUpdated} tags updated`);
}


export async function copyHoursOfOperations(options: CopyHoursOfOperationsOptions) {
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

  const sourceClient = createConnectClient(sourceConfig.region, options.sourceProfile);
  const targetClient = createConnectClient(targetConfig.region, options.targetProfile);

  console.log("\nAnalyzing hours of operation differences...");
  const comparisonResult = await compareHoursOfOperations(
    sourceClient,
    targetClient,
    sourceConfig.instanceId,
    targetConfig.instanceId,
    sourceConfig
  );

  displayHoursOfOperationPlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a =>
    a.action !== 'skip' || a.tagsNeedUpdate
  );

  if (!needsCopy) {
    console.log("\nNo hours of operation need to be copied - all hours match");
    return;
  }

  const shouldContinue = await promptContinue("Proceed with copying hours of operation?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying hours of operation...");
  await executeHoursOfOperationCopy(targetClient, targetConfig.instanceId, comparisonResult, options.verbose);
}
