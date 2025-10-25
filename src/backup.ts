
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { describeContactFlow, describeContactFlowModule } from "./connect/flows.js";

import type { ConnectClient, ContactFlowSummary, ContactFlowModuleSummary } from "@aws-sdk/client-connect";


interface BackupMetadata {
  timestamp: string;
  targetInstance: {
    instanceId: string;
    region: string;
  };
  flowsBackedUp: number;
  modulesBackedUp: number;
  flows: Array<{ name: string; id: string; arn: string; file: string }>;
  modules: Array<{ name: string; id: string; arn: string; file: string }>;
}


function sanitizeFileName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}


export async function createBackup(client: ConnectClient, instanceId: string, region: string, flowsToUpdate: ContactFlowSummary[], modulesToUpdate: ContactFlowModuleSummary[]): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5) + 'Z';
  const backupDir = join('backups', `backup-${timestamp}`);
  const flowsDir = join(backupDir, 'flows');
  const modulesDir = join(backupDir, 'modules');

  await mkdir(backupDir, { recursive: true });
  await mkdir(flowsDir, { recursive: true });
  await mkdir(modulesDir, { recursive: true });

  const metadata: BackupMetadata = {
    timestamp,
    targetInstance: {
      instanceId,
      region
    },
    flowsBackedUp: flowsToUpdate.length,
    modulesBackedUp: modulesToUpdate.length,
    flows: [],
    modules: []
  };

  console.log(`Creating backup of ${flowsToUpdate.length} flows and ${modulesToUpdate.length} modules...`);

  for (const moduleSummary of modulesToUpdate) {
    const fullModule = await describeContactFlowModule(client, instanceId, moduleSummary.Id!);
    const fileName = sanitizeFileName(moduleSummary.Name!) + '.json';
    const filePath = join(modulesDir, fileName);

    const moduleData = {
      InstanceId: instanceId,
      Name: fullModule.Name,
      Description: fullModule.Description,
      Content: fullModule.Content,
      Tags: fullModule.Tags
    };

    await writeFile(filePath, JSON.stringify(moduleData, null, 2));

    metadata.modules.push({
      name: moduleSummary.Name!,
      id: moduleSummary.Id!,
      arn: moduleSummary.Arn!,
      file: `modules/${fileName}`
    });

    console.log(`  Backed up module: ${moduleSummary.Name}`);
  }

  for (const flowSummary of flowsToUpdate) {
    const fullFlow = await describeContactFlow(client, instanceId, flowSummary.Id!);
    const fileName = sanitizeFileName(flowSummary.Name!) + '.json';
    const filePath = join(flowsDir, fileName);

    const flowData = {
      InstanceId: instanceId,
      Name: fullFlow.Name,
      Type: fullFlow.Type,
      Description: fullFlow.Description,
      Content: fullFlow.Content,
      Tags: fullFlow.Tags
    };

    await writeFile(filePath, JSON.stringify(flowData, null, 2));

    metadata.flows.push({
      name: flowSummary.Name!,
      id: flowSummary.Id!,
      arn: flowSummary.Arn!,
      file: `flows/${fileName}`
    });

    console.log(`  Backed up flow: ${flowSummary.Name}`);
  }

  await writeFile(join(backupDir, 'manifest.json'), JSON.stringify(metadata, null, 2));

  const restoreScript = generateRestoreScript(metadata, region);
  await writeFile(join(backupDir, 'restore.sh'), restoreScript);

  console.log(`Backup created: ${backupDir}\n`);
  return backupDir;
}


function generateRestoreScript(metadata: BackupMetadata, region: string): string {
  const lines: string[] = [];

  lines.push('#!/bin/bash');
  lines.push(`# Restore backup created: ${metadata.timestamp}`);
  lines.push(`# Target: ${metadata.targetInstance.instanceId} (${region})`);
  lines.push('');

  if (metadata.modules.length > 0) {
    lines.push('# Modules');
    for (const module of metadata.modules) {
      lines.push(`aws connect create-contact-flow-module --cli-input-json file://${module.file} --region ${region}`);
    }
    lines.push('');
  }

  if (metadata.flows.length > 0) {
    lines.push('# Flows');
    for (const flow of metadata.flows) {
      lines.push(`aws connect create-contact-flow --cli-input-json file://${flow.file} --region ${region}`);
    }
  }

  return lines.join('\n') + '\n';
}
