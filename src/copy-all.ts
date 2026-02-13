
import { copyHoursOfOperations } from "./resources/hours-of-operation/copy.js";
import { copyAgentStatuses } from "./resources/agent-statuses/copy.js";
import { copyHierarchyGroups } from "./resources/hierarchy-groups/copy.js";
import { copySecurityProfiles } from "./resources/security-profiles/copy.js";
import { copyQueues } from "./resources/queues/copy.js";
import { copyRoutingProfiles } from "./resources/routing-profiles/copy.js";
import { copyQuickConnects } from "./resources/quick-connects/copy.js";
import { copyViews } from "./resources/views/copy.js";
import { copyFlows } from "./copy-flows.js";


export interface CopyAllOptions {
  sourceConfig: string;
  targetConfig: string;
  sourceProfile: string;
  targetProfile: string;
  verbose: boolean;
  skip: string;
  skipOutboundFlow: boolean;
  forceHierarchyRecreate: boolean;
  forceStructureUpdate: boolean;
  publish: boolean;
  yes: boolean;
}


const RESOURCE_STEPS: { name: string; run: (options: CopyAllOptions) => Promise<void> }[] = [
  {
    name: "hours-of-operation",
    run: (o) => copyHoursOfOperations(o)
  },
  {
    name: "agent-statuses",
    run: (o) => copyAgentStatuses(o)
  },
  {
    name: "hierarchy-groups",
    run: (o) => copyHierarchyGroups(o)
  },
  {
    name: "security-profiles",
    run: (o) => copySecurityProfiles(o)
  },
  {
    name: "queues",
    run: (o) => copyQueues(o)
  },
  {
    name: "routing-profiles",
    run: (o) => copyRoutingProfiles(o)
  },
  {
    name: "quick-connects",
    run: (o) => copyQuickConnects(o)
  },
  {
    name: "views",
    run: (o) => copyViews(o)
  },
  {
    name: "flows",
    run: (o) => copyFlows(o)
  }
];


const VALID_RESOURCE_NAMES = RESOURCE_STEPS.map(s => s.name);


export async function copyAll(options: CopyAllOptions) {
  const skipSet = parseSkipList(options.skip);

  const steps = RESOURCE_STEPS.filter(s => !skipSet.has(s.name));

  console.log(`Copying ${steps.length} resource types: ${steps.map(s => s.name).join(", ")}`);

  if (skipSet.size > 0) {
    console.log(`Skipping: ${[...skipSet].join(", ")}`);
  }

  for (const step of steps) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`  ${step.name}`);
    console.log(`${"=".repeat(60)}`);

    await step.run(options);
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log("  copy complete");
  console.log(`${"=".repeat(60)}`);
}


function parseSkipList(skip: string): Set<string> {
  if (!skip) return new Set();

  const names = skip.split(",").map(s => s.trim()).filter(s => s.length > 0);
  const invalid = names.filter(n => !VALID_RESOURCE_NAMES.includes(n));

  if (invalid.length > 0) {
    console.error(`Unknown resource types in --skip: ${invalid.join(", ")}`);
    console.error(`Valid values: ${VALID_RESOURCE_NAMES.join(", ")}`);
    process.exit(1);
  }

  return new Set(names);
}
