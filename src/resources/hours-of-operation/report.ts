
import type { ConnectClient, HoursOfOperationSummary, HoursOfOperation, HoursOfOperationConfig, HoursOfOperationDays } from "@aws-sdk/client-connect";
import { listHoursOfOperations } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeHoursOfOperation } from "./operations.js";

import type { SourceConfig } from "../../validation.js";


export interface HoursOfOperationAction {
  hoursName: string;
  action: 'create' | 'update' | 'skip';
  sourceHours: HoursOfOperation;
  targetHours?: HoursOfOperation;
  targetHoursId?: string;
  targetHoursArn?: string;
  tagsNeedUpdate?: boolean;
}


export interface HoursOfOperationComparisonResult {
  actions: HoursOfOperationAction[];
  hoursToProcess: HoursOfOperationSummary[];
}


const DAY_ORDER: HoursOfOperationDays[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];


function sortConfigByDay(config: HoursOfOperationConfig[]): HoursOfOperationConfig[] {
  return [...config].sort((a, b) => {
    const indexA = DAY_ORDER.indexOf(a.Day!);
    const indexB = DAY_ORDER.indexOf(b.Day!);
    return indexA - indexB;
  });
}


function configMatches(sourceConfig: HoursOfOperationConfig[], targetConfig: HoursOfOperationConfig[]): boolean {
  if (sourceConfig.length !== targetConfig.length) return false;

  const sortedSource = sortConfigByDay(sourceConfig);
  const sortedTarget = sortConfigByDay(targetConfig);

  for (let i = 0; i < sortedSource.length; i++) {
    const s = sortedSource[i]!;
    const t = sortedTarget[i]!;

    if (s.Day !== t.Day) return false;
    if (s.StartTime!.Hours !== t.StartTime!.Hours) return false;
    if (s.StartTime!.Minutes !== t.StartTime!.Minutes) return false;
    if (s.EndTime!.Hours !== t.EndTime!.Hours) return false;
    if (s.EndTime!.Minutes !== t.EndTime!.Minutes) return false;
  }

  return true;
}


function hoursOfOperationContentMatches(source: HoursOfOperation, target: HoursOfOperation): boolean {
  if (source.Name !== target.Name) return false;
  if (source.Description !== target.Description) return false;
  if (source.TimeZone !== target.TimeZone) return false;

  const sourceConfig = source.Config ?? [];
  const targetConfig = target.Config ?? [];

  return configMatches(sourceConfig, targetConfig);
}


function hoursOfOperationTagsMatch(source: HoursOfOperation, target: HoursOfOperation): boolean {
  const sourceTags = source.Tags ?? {};
  const targetTags = target.Tags ?? {};

  const sourceKeys = Object.keys(sourceTags).sort();
  const targetKeys = Object.keys(targetTags).sort();

  if (sourceKeys.length !== targetKeys.length) return false;

  for (const key of sourceKeys) {
    if (sourceTags[key] !== targetTags[key]) return false;
  }

  return true;
}


function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}


function formatConfigEntry(config: HoursOfOperationConfig): string {
  const start = formatTime(config.StartTime!.Hours!, config.StartTime!.Minutes!);
  const end = formatTime(config.EndTime!.Hours!, config.EndTime!.Minutes!);
  return `${config.Day}: ${start}-${end}`;
}


export function getHoursOfOperationDiff(source: HoursOfOperation, target: HoursOfOperation): string[] {
  const diffs: string[] = [];

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? '(none)'} → ${source.Description ?? '(none)'}`);
  }

  if (source.TimeZone !== target.TimeZone) {
    diffs.push(`TimeZone: ${target.TimeZone} → ${source.TimeZone}`);
  }

  const sourceConfig = source.Config ?? [];
  const targetConfig = target.Config ?? [];

  if (!configMatches(sourceConfig, targetConfig)) {
    const sortedSource = sortConfigByDay(sourceConfig);
    const sortedTarget = sortConfigByDay(targetConfig);

    const sourceByDay = new Map(sortedSource.map(c => [c.Day as HoursOfOperationDays, c]));
    const targetByDay = new Map(sortedTarget.map(c => [c.Day as HoursOfOperationDays, c]));

    const allDays = new Set([...sourceByDay.keys(), ...targetByDay.keys()]);

    for (const day of DAY_ORDER) {
      if (!allDays.has(day)) continue;

      const sourceEntry = sourceByDay.get(day);
      const targetEntry = targetByDay.get(day);

      if (!sourceEntry && targetEntry) {
        diffs.push(`${day}: ${formatConfigEntry(targetEntry)} → (removed)`);
      } else if (sourceEntry && !targetEntry) {
        diffs.push(`${day}: (not configured) → ${formatConfigEntry(sourceEntry)}`);
      } else if (sourceEntry && targetEntry) {
        const sourceStr = formatConfigEntry(sourceEntry);
        const targetStr = formatConfigEntry(targetEntry);
        if (sourceStr !== targetStr) {
          diffs.push(`${day}: ${targetStr.split(': ')[1]} → ${sourceStr.split(': ')[1]}`);
        }
      }
    }
  }

  return diffs;
}


export function getHoursOfOperationTagDiff(source: HoursOfOperation, target: HoursOfOperation): { toAdd: string[]; toRemove: string[] } {
  const sourceTags = source.Tags ?? {};
  const targetTags = target.Tags ?? {};

  const toAdd: string[] = [];
  const toRemove: string[] = [];

  for (const [key, value] of Object.entries(sourceTags)) {
    if (targetTags[key] !== value) {
      toAdd.push(`${key}=${value}`);
    }
  }

  for (const key of Object.keys(targetTags)) {
    if (!(key in sourceTags)) {
      toRemove.push(key);
    }
  }

  return { toAdd, toRemove };
}


export async function compareHoursOfOperations(sourceClient: ConnectClient, targetClient: ConnectClient, sourceInstanceId: string, targetInstanceId: string, sourceConfig: SourceConfig): Promise<HoursOfOperationComparisonResult> {
  const sourceHours = await listHoursOfOperations(sourceClient, sourceInstanceId);
  const targetHours = await listHoursOfOperations(targetClient, targetInstanceId);

  let hoursToCopy = sourceHours;

  if (sourceConfig.hoursFilters) {
    hoursToCopy = hoursToCopy.filter(hours =>
      matchesFlowFilters(hours.Name ?? "", sourceConfig.hoursFilters)
    );
  }

  const targetHoursByName = new Map(
    targetHours.map(h => [h.Name!, h])
  );

  const actions: HoursOfOperationAction[] = [];

  for (const hoursSummary of hoursToCopy) {
    const hoursName = hoursSummary.Name!;
    const targetHoursSummary = targetHoursByName.get(hoursName);

    const sourceHoursFull = await describeHoursOfOperation(
      sourceClient,
      sourceInstanceId,
      hoursSummary.Id!
    );

    if (!targetHoursSummary) {
      actions.push({
        hoursName,
        action: 'create',
        sourceHours: sourceHoursFull
      });
      continue;
    }

    const targetHoursFull = await describeHoursOfOperation(
      targetClient,
      targetInstanceId,
      targetHoursSummary.Id!
    );

    const contentMatches = hoursOfOperationContentMatches(sourceHoursFull, targetHoursFull);
    const tagsMatch = hoursOfOperationTagsMatch(sourceHoursFull, targetHoursFull);

    if (contentMatches && tagsMatch) {
      actions.push({
        hoursName,
        action: 'skip',
        sourceHours: sourceHoursFull,
        targetHours: targetHoursFull,
        targetHoursId: targetHoursSummary.Id!,
        targetHoursArn: targetHoursSummary.Arn!
      });
    } else if (contentMatches && !tagsMatch) {
      actions.push({
        hoursName,
        action: 'skip',
        sourceHours: sourceHoursFull,
        targetHours: targetHoursFull,
        targetHoursId: targetHoursSummary.Id!,
        targetHoursArn: targetHoursSummary.Arn!,
        tagsNeedUpdate: true
      });
    } else {
      actions.push({
        hoursName,
        action: 'update',
        sourceHours: sourceHoursFull,
        targetHours: targetHoursFull,
        targetHoursId: targetHoursSummary.Id!,
        targetHoursArn: targetHoursSummary.Arn!,
        tagsNeedUpdate: !tagsMatch
      });
    }
  }

  return {
    actions,
    hoursToProcess: hoursToCopy
  };
}
