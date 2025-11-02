
import { readFile } from "fs/promises";
import { createInterface } from "readline";
import { TagResourceCommand, UntagResourceCommand } from "@aws-sdk/client-connect";

import type { ConnectClient } from "@aws-sdk/client-connect";

import { createConnectClient } from "../../connect/client.js";
import { validateSourceConfig, validateTargetConfig } from "../../validation.js";
import { compareAgentStatuses, getAgentStatusDiff, getAgentStatusTagDiff } from "./report.js";
import { createAgentStatus, updateAgentStatus } from "./operations.js";

import type { AgentStatusComparisonResult } from "./report.js";
import type { CreateAgentStatusConfig, UpdateAgentStatusConfig } from "./operations.js";


export interface CopyAgentStatusesOptions {
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


function displayAgentStatusPlan(result: AgentStatusComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === 'create');
  const toUpdate = result.actions.filter(a => a.action === 'update');
  const toUpdateTagsOnly = result.actions.filter(a => a.action === 'skip' && a.tagsNeedUpdate);
  const toSkip = result.actions.filter(a => a.action === 'skip' && !a.tagsNeedUpdate);

  console.log(`\nSummary:`);
  console.log(`  Agent statuses to create: ${toCreate.length}`);
  console.log(`  Agent statuses to update: ${toUpdate.length}`);
  if (toUpdateTagsOnly.length > 0) {
    console.log(`  Agent statuses to update tags only: ${toUpdateTagsOnly.length}`);
  }
  console.log(`  Agent statuses to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.statusesToProcess.length}`);

  if (toCreate.length > 0) {
    console.log(`\nAgent statuses to create:`);
    for (const action of toCreate) {
      console.log(`  - ${action.statusName}`);
      if (verbose) {
        const status = action.sourceStatus;
        console.log(`      State: ${status.State}`);
        if (status.Description) console.log(`      Description: ${status.Description}`);
        if (status.State === 'ENABLED' && status.DisplayOrder !== undefined) {
          console.log(`      DisplayOrder: ${status.DisplayOrder}`);
        }
        if (status.Tags && Object.keys(status.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(status.Tags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      }
    }
  }

  if (toUpdate.length > 0) {
    console.log(`\nAgent statuses to update:`);
    for (const action of toUpdate) {
      console.log(`  - ${action.statusName}`);
      if (verbose && action.targetStatus) {
        const diffs = getAgentStatusDiff(action.sourceStatus, action.targetStatus);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
        if (action.tagsNeedUpdate) {
          const tagDiff = getAgentStatusTagDiff(action.sourceStatus, action.targetStatus);
          if (tagDiff.toAdd.length > 0) console.log(`      Tags to add: ${tagDiff.toAdd.join(', ')}`);
          if (tagDiff.toRemove.length > 0) console.log(`      Tags to remove: ${tagDiff.toRemove.join(', ')}`);
        }
      }
    }
  }

  if (toUpdateTagsOnly.length > 0 && verbose) {
    console.log(`\nAgent statuses with tag updates only:`);
    for (const action of toUpdateTagsOnly) {
      console.log(`  - ${action.statusName}`);
      if (action.targetStatus) {
        const tagDiff = getAgentStatusTagDiff(action.sourceStatus, action.targetStatus);
        if (tagDiff.toAdd.length > 0) console.log(`      Tags to add: ${tagDiff.toAdd.join(', ')}`);
        if (tagDiff.toRemove.length > 0) console.log(`      Tags to remove: ${tagDiff.toRemove.join(', ')}`);
      }
    }
  }

  if (toSkip.length > 0 && verbose) {
    console.log(`\nAgent statuses to skip (identical):`);
    for (const action of toSkip) {
      console.log(`  - ${action.statusName}`);
    }
  }
}


async function executeAgentStatusCopy(targetClient: ConnectClient, targetInstanceId: string, result: AgentStatusComparisonResult, verbose: boolean) {
  let created = 0;
  let updated = 0;
  let tagsUpdated = 0;

  for (const action of result.actions) {
    if (action.action === 'skip' && !action.tagsNeedUpdate) continue;

    if (action.action === 'create') {
      console.log(`Creating agent status: ${action.statusName}`);
      if (verbose) {
        const status = action.sourceStatus;
        console.log(`  State: ${status.State}`);
        if (status.Description) console.log(`  Description: ${status.Description}`);
        if (status.State === 'ENABLED' && status.DisplayOrder !== undefined) {
          console.log(`  DisplayOrder: ${status.DisplayOrder}`);
        }
        if (status.Tags && Object.keys(status.Tags).length > 0) {
          console.log(`  Tags: ${Object.entries(status.Tags).map(([k, v]) => `${k}=${v}`).join(', ')}`);
        }
      }
      await createAgentStatus(targetClient, targetInstanceId, {
        Name: action.sourceStatus.Name,
        State: action.sourceStatus.State,
        Description: action.sourceStatus.Description,
        DisplayOrder: action.sourceStatus.DisplayOrder,
        Tags: action.sourceStatus.Tags
      } as CreateAgentStatusConfig);
      created++;
    }

    if (action.action === 'update') {
      console.log(`Updating agent status: ${action.statusName}`);
      if (verbose && action.targetStatus) {
        const diffs = getAgentStatusDiff(action.sourceStatus, action.targetStatus);
        for (const diff of diffs) {
          console.log(`  ${diff}`);
        }
      }

      // AWS clears DisplayOrder when disabling and rejects setting it on DISABLED statuses
      await updateAgentStatus(targetClient, targetInstanceId, action.targetStatusId!, {
        Name: action.sourceStatus.Name,
        State: action.sourceStatus.State,
        Description: action.sourceStatus.Description,
        ...(action.sourceStatus.State === 'ENABLED' && { DisplayOrder: action.sourceStatus.DisplayOrder })
      } as UpdateAgentStatusConfig);
      updated++;
    }

    if (action.tagsNeedUpdate) {
      console.log(`Updating tags for agent status: ${action.statusName}`);

      const sourceTags = action.sourceStatus.Tags ?? {};
      const targetTags = action.targetStatus?.Tags ?? {};

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
            resourceArn: action.targetStatusArn!,
            tags: tagsToAdd
          })
        );
      }

      if (tagsToRemove.length > 0) {
        await targetClient.send(
          new UntagResourceCommand({
            resourceArn: action.targetStatusArn!,
            tagKeys: tagsToRemove
          })
        );
      }

      tagsUpdated++;
    }
  }

  console.log(`\nCopy complete: ${created} created, ${updated} updated, ${tagsUpdated} tags updated`);
}


export async function copyAgentStatuses(options: CopyAgentStatusesOptions) {
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

  console.log("\nAnalyzing agent status differences...");
  const comparisonResult = await compareAgentStatuses(
    sourceClient,
    targetClient,
    sourceConfig.instanceId,
    targetConfig.instanceId,
    sourceConfig
  );

  displayAgentStatusPlan(comparisonResult, options.verbose);

  const needsCopy = comparisonResult.actions.some(a =>
    a.action !== 'skip' || a.tagsNeedUpdate
  );

  if (!needsCopy) {
    console.log("\nNo agent statuses need to be copied - all statuses match");
    return;
  }

  const shouldContinue = await promptContinue("Proceed with copying agent statuses?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  console.log("\nCopying agent statuses...");
  await executeAgentStatusCopy(targetClient, targetConfig.instanceId, comparisonResult, options.verbose);
}
