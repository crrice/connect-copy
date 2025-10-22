
import { minimatch } from "minimatch";


export interface FlowFilters {
  include?: string[];
  exclude?: string[];
}


export function matchesFlowFilters(flowName: string, filters?: FlowFilters): boolean {
  if (!filters) {
    return true;
  }

  const include = filters.include ?? ["*"];
  const exclude = filters.exclude ?? [];

  if (exclude.some(pattern => minimatch(flowName, pattern))) {
    return false;
  }

  return include.some(pattern => minimatch(flowName, pattern));
}
