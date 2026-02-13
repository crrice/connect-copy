
import { minimatch, Minimatch } from "minimatch";


export interface FlowFilters {
  include?: string[];
  exclude?: string[];
}


export function validateFilterPatterns(filters: FlowFilters, filterName: string): string[] {
  const errors: string[] = [];

  for (const pattern of filters.include ?? []) {
    if (new Minimatch(pattern).makeRe() === false) {
      errors.push(`${filterName}.include: invalid pattern "${pattern}"`);
    }
  }

  for (const pattern of filters.exclude ?? []) {
    if (new Minimatch(pattern).makeRe() === false) {
      errors.push(`${filterName}.exclude: invalid pattern "${pattern}"`);
    }
  }

  return errors;
}


export type FilterResult =
  | { matches: true }
  | { matches: false; reason: string };


export function matchesFlowFilters(flowName: string, filters?: FlowFilters): boolean {
  if (!filters) return true;

  const include = filters.include ?? ["*"];
  const exclude = filters.exclude ?? [];

  if (exclude.some(pattern => minimatch(flowName, pattern))) return false;

  return include.some(pattern => minimatch(flowName, pattern));
}


export function matchesFlowFiltersWithReason(flowName: string, filters?: FlowFilters): FilterResult {
  if (!filters) return { matches: true };

  const include = filters.include ?? ["*"];
  const exclude = filters.exclude ?? [];

  for (const pattern of exclude) {
    if (minimatch(flowName, pattern)) {
      return { matches: false, reason: `matched exclude pattern "${pattern}"` };
    }
  }

  for (const pattern of include) {
    if (minimatch(flowName, pattern)) {
      return { matches: true };
    }
  }

  return { matches: false, reason: "didn't match any include patterns" };
}
