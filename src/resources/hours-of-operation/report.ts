
import * as CliUtil from "../../utils/cli-utils.js";
import { listHoursOfOperations } from "../../connect/resources.js";
import { matchesFlowFilters } from "../../filters.js";
import { describeHoursOfOperation } from "./operations.js";

import type { HoursOfOperationSummary, HoursOfOperation, HoursOfOperationConfig, HoursOfOperationDays } from "@aws-sdk/client-connect";


export interface HoursOfOperationAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  hoursName: string;
  sourceHours: HoursOfOperation;
  targetHours?: HoursOfOperation;
  targetHoursId?: string;
  targetHoursArn?: string;
}


export interface HoursOfOperationComparisonResult {
  actions: HoursOfOperationAction[];
  hours: HoursOfOperationSummary[];
}


const DAY_ORDER: HoursOfOperationDays[] = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];


export async function compareHoursOfOperations(config: CliUtil.ResourceComparisonConfig): Promise<HoursOfOperationComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  const sourceHours = await listHoursOfOperations(sourceClient, sourceInstanceId);
  const targetHours = await listHoursOfOperations(targetClient, targetInstanceId);

  let filteredSourceHours = sourceHours;

  if (filterConfig) {
    filteredSourceHours = filteredSourceHours.filter(hours =>
      matchesFlowFilters(hours.Name!, filterConfig)
    );
  }

  const targetHoursByName = Object.fromEntries(targetHours.map(h => [h.Name, h]));
  const actions: HoursOfOperationAction[] = [];

  for (const sourceSummary of filteredSourceHours) {
    const sourceHoursFull = await describeHoursOfOperation(sourceClient, sourceInstanceId, sourceSummary.Id!);
    const targetSummary = targetHoursByName[sourceSummary.Name!];

    if (!targetSummary) {
      actions.push({
        hoursName: sourceSummary.Name!,
        action: "create",
        sourceHours: sourceHoursFull
      });
      continue;
    }

    const targetHoursFull = await describeHoursOfOperation(targetClient, targetInstanceId, targetSummary.Id!);

    const contentMatches = hoursOfOperationContentMatches(sourceHoursFull, targetHoursFull);
    const tagsMatch = CliUtil.recordsMatch(sourceHoursFull.Tags, targetHoursFull.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    actions.push({
      hoursName: sourceSummary.Name!,
      action: actionType,
      sourceHours: sourceHoursFull,
      targetHours: targetHoursFull,
      targetHoursId: targetSummary.Id,
      targetHoursArn: targetSummary.Arn
    });
  }

  return { actions, hours: filteredSourceHours };
}


function hoursOfOperationContentMatches(source: HoursOfOperation, target: HoursOfOperation): boolean {
  if (source.Name !== target.Name) return false;
  if (source.Description !== target.Description) return false;
  if (source.TimeZone !== target.TimeZone) return false;

  return configMatches(source.Config ?? [], target.Config ?? []);
}


function configMatches(sourceConfig: HoursOfOperationConfig[], targetConfig: HoursOfOperationConfig[]): boolean {
  if (sourceConfig.length !== targetConfig.length) return false;

  const sortedSource = sortConfigByDay(sourceConfig);
  const sortedTarget = sortConfigByDay(targetConfig);

  for (let i = 0; i < sortedSource.length; i++) {
    const s = sortedSource[i]!;
    const t = sortedTarget[i]!;

    if (s.Day !== t.Day) return false;
    if (s.StartTime?.Hours !== t.StartTime?.Hours) return false;
    if (s.StartTime?.Minutes !== t.StartTime?.Minutes) return false;
    if (s.EndTime?.Hours !== t.EndTime?.Hours) return false;
    if (s.EndTime?.Minutes !== t.EndTime?.Minutes) return false;
  }

  return true;
}


function sortConfigByDay(config: HoursOfOperationConfig[]): HoursOfOperationConfig[] {
  return [...config].sort((a, b) => {
    const indexA = DAY_ORDER.indexOf(a.Day!);
    const indexB = DAY_ORDER.indexOf(b.Day!);
    return indexA - indexB;
  });
}


function formatTime(hours: number, minutes: number): string {
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}


function formatConfigEntry(config: HoursOfOperationConfig): string {
  const start = formatTime(config.StartTime!.Hours!, config.StartTime!.Minutes!);
  const end = formatTime(config.EndTime!.Hours!, config.EndTime!.Minutes!);
  return `${config.Day}: ${start}-${end}`;
}


export function getHoursOfOperationDiff(source: HoursOfOperation, target: HoursOfOperation): string[] {
  const diffs: string[] = [];

  if (source.Description !== target.Description) {
    diffs.push(`Description: ${target.Description ?? "(none)"} → ${source.Description ?? "(none)"}`);
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
          diffs.push(`${day}: ${targetStr.split(": ")[1]} → ${sourceStr.split(": ")[1]}`);
        }
      }
    }
  }

  return diffs;
}


export function displayHoursOfOperationPlan(result: HoursOfOperationComparisonResult, verbose: boolean) {
  const toCreate = result.actions.filter(a => a.action === "create");
  const toUpdateAll = result.actions.filter(a => a.action === "update_all");
  const toUpdateData = result.actions.filter(a => a.action === "update_data");
  const toUpdateTags = result.actions.filter(a => a.action === "update_tags");
  const toSkip = result.actions.filter(a => a.action === "skip");

  console.log(`\nSummary:`);
  console.log(`  Hours of operation to create: ${toCreate.length}`);
  console.log(`  Hours of operation to update (all): ${toUpdateAll.length}`);
  console.log(`  Hours of operation to update (data only): ${toUpdateData.length}`);
  console.log(`  Hours of operation to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Hours of operation to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${result.hours.length}`);

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
          for (const config of sortConfigByDay(hours.Config)) {
            console.log(`        ${formatConfigEntry(config)}`);
          }
        }
        if (hours.Tags && Object.keys(hours.Tags).length > 0) {
          console.log(`      Tags: ${Object.entries(hours.Tags).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        }
      }
    }
  }

  if (toUpdateAll.length > 0) {
    console.log(`\nHours of operation to update (all):`);
    for (const action of toUpdateAll) {
      console.log(`  - ${action.hoursName}`);
      if (verbose && action.targetHours) {
        const diffs = getHoursOfOperationDiff(action.sourceHours, action.targetHours);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
        const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceHours.Tags, action.targetHours.Tags);
        if (Object.keys(toAdd).length) console.log(`      Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (toRemove.length) console.log(`      Tags to remove: ${toRemove.join(", ")}`);
      }
    }
  }

  if (toUpdateData.length > 0) {
    console.log(`\nHours of operation to update (data only):`);
    for (const action of toUpdateData) {
      console.log(`  - ${action.hoursName}`);
      if (verbose && action.targetHours) {
        const diffs = getHoursOfOperationDiff(action.sourceHours, action.targetHours);
        for (const diff of diffs) {
          console.log(`      ${diff}`);
        }
      }
    }
  }

  if (toUpdateTags.length > 0) {
    console.log(`\nHours of operation to update (tags only):`);
    for (const action of toUpdateTags) {
      console.log(`  - ${action.hoursName}`);
      if (verbose && action.targetHours) {
        const { toAdd, toRemove } = CliUtil.getRecordDiff(action.sourceHours.Tags, action.targetHours.Tags);
        if (Object.keys(toAdd).length) console.log(`      Tags to add: ${Object.entries(toAdd).map(([k, v]) => `${k}=${v}`).join(", ")}`);
        if (toRemove.length) console.log(`      Tags to remove: ${toRemove.join(", ")}`);
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
