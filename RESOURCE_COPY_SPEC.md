
# Resource Copy Architecture Specification

This document describes the standard architecture for resource copy scripts, as established during the security-profiles refactoring (2025-01).

## Philosophy

**Core Principle:** Trust through composition and layered responsibility.

- **Validation guarantees execution correctness** - if validation passes, execution should not need defensive checks
- **Compose dependencies** - if another module solves your problem, use their result; don't rebuild their infrastructure
- **Separate concerns by purpose** - group code by what it does, not who calls it
- **Count the data, don't track counts** - derive metrics from filtered data rather than manual counters
- **Remove redundancy** - at all levels: code, data, and types

---

## File Structure

Each resource has three files:

### `operations.ts` - AWS API Layer
**Responsibility:** Direct AWS SDK wrappers with minimal logic.

**Contains:**
- `describe{Resource}()` - Fetch full resource details
- `create{Resource}()` - Create new resource
- `update{Resource}()` - Update existing resource
- Helper functions for AWS API quirks (if needed)

**Does NOT contain:**
- Business logic
- Comparison logic
- Filtering or validation
- Logging (except maybe verbose API call logs)

**Example:**
```typescript
export async function describeSecurityProfile(client: ConnectClient, instanceId: string, securityProfileId: string) {
  const response = await client.send(
    new DescribeSecurityProfileCommand({
      InstanceId: instanceId,
      SecurityProfileId: securityProfileId
    })
  );

  if (!response.SecurityProfile?.SecurityProfileName) {
    throw new Error(`Security profile not found: ${securityProfileId}`);
  }

  return removeUndefined(response.SecurityProfile) as NoUndefinedVals<SecurityProfile> & { SecurityProfileName: string };
}
```

**Key patterns:**
- Runtime checks that enable type assertions (make guarantees visible to type system)
- Return clean types (use `removeUndefined()` to strip `| undefined` from AWS types)
- Throw on missing required data
- Use type assertions when runtime checks guarantee type safety

---

### `report.ts` - Analysis & Presentation Layer
**Responsibility:** Compare resources, compute differences, display plans.

**Contains:**
- Type definitions (`{Resource}Action`, `{Resource}ComparisonResult`, `{Resource}WithExtensions`)
- `compare{Resources}(config: ResourceComparisonConfig)` - Main comparison function
- `display{Resource}Plan(result, verbose)` - Show what will happen
- `get{Resource}Diff()` - Compute field-level differences
- Helper functions for comparison logic

**Does NOT contain:**
- AWS API calls (use operations.ts)
- Execution logic (use copy.ts)
- Manual resource updates

**Example types:**
```typescript
export interface SecurityProfileAction {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";

  profileName: string;
  sourceProfile: SecurityProfileWithPermissions;
  targetProfile?: SecurityProfileWithPermissions;
}

export interface SecurityProfileComparisonResult {
  actions: SecurityProfileAction[];
  profiles: SecurityProfileSummary[];

  // Dependencies from other resources (if needed):
  hierarchyGroups: HierarchyGroupComparisonResult;
}
```

**Key patterns:**
- Action types are explicit and complete (no "generic + flag" patterns)
- Action field comes first in interface (visual emphasis on "what we're doing")
- Comparison result includes dependency results (composition over duplication)
- Display function uses the diff utilities for consistent output
- Filter by resource-specific filters (via `matchesFlowFilters`)

**Comparison function structure:**
```typescript
export async function compareSecurityProfiles(config: CliUtil.ResourceComparisonConfig): Promise<SecurityProfileComparisonResult> {
  const {
    sourceClient,
    targetClient,
    sourceInstanceId,
    targetInstanceId,
    filterConfig
  } = config;

  // 1. List resources from both instances
  const sourceResources = await listResources(sourceClient, sourceInstanceId);
  const targetResources = await listResources(targetClient, targetInstanceId);

  // 2. Filter source resources
  const filteredSourceResources = filterConfig
    ? sourceResources.filter(r => matchesFlowFilters(r.Name!, filterConfig))
    : sourceResources;

  // 3. Compose dependencies (if needed)
  const hierarchyGroups = await compareHierarchyGroups({ sourceClient, targetClient, sourceInstanceId, targetInstanceId });

  // 4. Build target lookup map
  const targetResourcesByName: Record<string, typeof targetResources[0]> =
    Object.fromEntries(targetResources.map(r => [r.Name, r]));

  // 5. Compare each source resource
  const actions: ResourceAction[] = [];

  for (const sourceSummary of filteredSourceResources) {
    const sourceResource = await describeResource(sourceClient, sourceInstanceId, sourceSummary.Id!);
    const targetSummary = targetResourcesByName[sourceSummary.Name!];

    if (!targetSummary) {
      actions.push({ action: "create", resourceName: sourceSummary.Name!, sourceResource });
      continue;
    }

    const targetResource = await describeResource(targetClient, targetInstanceId, targetSummary.Id!);

    const contentMatches = resourceContentMatches(sourceResource, targetResource, dependencies);
    const tagsMatch = CliUtil.recordsMatch(sourceResource.Tags, targetResource.Tags);

    const actionType = (!contentMatches && !tagsMatch) ? "update_all"
      : !contentMatches ? "update_data"
      : !tagsMatch ? "update_tags"
      : "skip";

    actions.push({
      action: actionType,
      resourceName: sourceSummary.Name!,
      sourceResource,
      targetResource
    });
  }

  return {
    actions,
    resources: filteredSourceResources,
    // Include dependencies:
    hierarchyGroups
  };
}
```

**Display function structure:**
```typescript
export function displayResourcePlan(comparisonResult: ResourceComparisonResult, verbose: boolean) {
  // 1. Pre-filter actions by type
  const toCreate = comparisonResult.actions.filter(a => a.action === "create");
  const toUpdateAll = comparisonResult.actions.filter(a => a.action === "update_all");
  const toUpdateData = comparisonResult.actions.filter(a => a.action === "update_data");
  const toUpdateTags = comparisonResult.actions.filter(a => a.action === "update_tags");
  const toSkip = comparisonResult.actions.filter(a => a.action === "skip");

  // 2. Show summary counts
  console.log(`\nSummary:`);
  console.log(`  Resources to create: ${toCreate.length}`);
  console.log(`  Resources to update (all): ${toUpdateAll.length}`);
  console.log(`  Resources to update (data only): ${toUpdateData.length}`);
  console.log(`  Resources to update (tags only): ${toUpdateTags.length}`);
  console.log(`  Resources to skip (identical): ${toSkip.length}`);
  console.log(`  Total processed: ${comparisonResult.resources.length}`);

  // 3. Show details for each category (if non-empty)
  if (toCreate.length > 0) {
    console.log(`\nResources to create:`);
    for (const op of toCreate) {
      console.log(`  - ${op.resourceName}`);
      if (verbose) {
        // Show relevant fields
      }
    }
  }

  // Similar for other categories...

  if (toSkip.length > 0 && verbose) {
    console.log(`\nResources to skip (identical):`);
    for (const op of toSkip) {
      console.log(`  - ${op.resourceName}`);
    }
  }
}
```

---

### `copy.ts` - Execution Layer
**Responsibility:** Orchestrate the copy operation.

**Contains:**
- `copy{Resources}(options)` - Main entry point
- `execute{Resource}Copy()` - Perform the actual copy operations
- Logging functions (`logResourceCreate`, `logResourceUpdate`, `logTagsUpdate`)
- Resource-specific warnings (if needed)

**Does NOT contain:**
- Comparison logic (use report.ts)
- Display logic (use report.ts)
- Direct AWS SDK calls (use operations.ts)

**Example:**
```typescript
export async function copySecurityProfiles(options: CopySecurityProfilesOptions) {
  const config = await CliUtil.loadConfigs(options);

  const sourceClient = createConnectClient(config.source.region, options.sourceProfile);
  const targetClient = createConnectClient(config.target.region, options.targetProfile);

  // 1. Compare
  console.log("\nAnalyzing security profile differences...");
  const comparisonResult = await compareSecurityProfiles({
    sourceClient,
    targetClient,
    sourceInstanceId: config.source.instanceId,
    targetInstanceId: config.target.instanceId,
    filterConfig: config.source.securityProfileFilters
  });

  // 2. Display plan
  displaySecurityProfilePlan(comparisonResult, options.verbose);

  // 3. Check if copy needed
  const needsCopy = comparisonResult.actions.some(a => a.action !== "skip");

  if (!needsCopy) {
    console.log("\nNo security profiles need to be copied - all profiles match");
    return;
  }

  // 4. Confirm with user
  const shouldContinue = await CliUtil.promptContinue("Proceed with copying security profiles?");
  if (!shouldContinue) {
    console.log("Copy cancelled by user");
    return;
  }

  // 5. Execute
  console.log("\nCopying security profiles...");
  await executeSecurityProfileCopy(targetClient, config.target.instanceId, comparisonResult, options.verbose);
}
```

**Execute function structure:**
```typescript
async function executeResourceCopy(targetClient: ConnectClient, targetInstanceId: string, comparisonResult: ResourceComparisonResult, verbose: boolean) {

  // 1. Pre-filter actions by type
  const toSkip = comparisonResult.actions.filter(op => op.action === "skip");
  const toCreate = comparisonResult.actions.filter(op => op.action === "create");
  const toUpdate = comparisonResult.actions.filter(op => ["update_data", "update_all"].includes(op.action));
  const toTag = comparisonResult.actions.filter(op => ["update_tags", "update_all"].includes(op.action));

  // 2. Create phase
  for (const createOp of toCreate) {
    logResourceCreate(createOp, verbose);

    const config = { ...createOp.sourceResource };

    // Remap any cross-instance IDs (hierarchy groups, etc.)
    if (createOp.sourceResource.SomeCrossInstanceId) {
      config.SomeCrossInstanceId = comparisonResult.dependency.mapping[createOp.sourceResource.SomeCrossInstanceId]!.targetId;
    }

    await createResource(targetClient, targetInstanceId, config);
  }

  // 3. Update phase
  for (const updateOp of toUpdate) {
    logResourceUpdate(updateOp, comparisonResult.dependencies, verbose);

    const config = { ...updateOp.sourceResource };

    // Remap any cross-instance IDs
    if (updateOp.sourceResource.SomeCrossInstanceId) {
      config.SomeCrossInstanceId = comparisonResult.dependency.mapping[updateOp.sourceResource.SomeCrossInstanceId]!.targetId;
    }

    await updateResource(targetClient, targetInstanceId, updateOp.targetResource?.Id!, config);
  }

  // 4. Tag phase
  for (const tagOp of toTag) {
    logTagsUpdate(tagOp, verbose);

    const { toAdd, toRemove } = CliUtil.getRecordDiff(tagOp.sourceResource.Tags, tagOp.targetResource?.Tags);
    await AwsUtil.updateResourceTags(targetClient, tagOp.targetResource?.Arn!, toAdd, toRemove, verbose);
  }

  // 5. Summary
  console.log(`\nCopy complete: ${toCreate.length} created, ${toUpdate.length} data updated, ${toTag.length} tags updated, ${toSkip.length} skipped`);

  // 6. Any resource-specific warnings
  if (needsManualConfigWarning) {
    logManualConfigurationWarning();
  }
}
```

**Key patterns:**
- Pre-filter actions by type before processing
- Three separate phases: create → update → tag
- No manual counter tracking (use array lengths)
- Cross-instance IDs remapped using dependency results
- Logging extracted to separate functions
- Summary shows counts derived from filtered arrays

---

## Standard Interfaces

### ResourceComparisonConfig
Defined in `utils/cli-utils.ts`:

```typescript
export interface ResourceComparisonConfig {
  sourceClient: ConnectClient;
  targetClient: ConnectClient;

  sourceInstanceId: string;
  targetInstanceId: string;

  filterConfig: FilterConfig | undefined;
}
```

**Usage:** All `compare{Resources}` functions should accept this config object.

---

## Key Architectural Decisions

### 1. Validation Guarantees Execution

**Principle:** If validation passes, execution should not need defensive checks.

**Example:**
```typescript
// In report.ts (validation):
const missingGroups: string[] = [];
for (const groupName of sourceHierarchyGroupMaps.idToName.values()) {
  if (!targetHierarchyGroupMaps.nameToId.has(groupName)) {
    missingGroups.push(groupName);
  }
}

if (missingGroups.length > 0) {
  throw new Error(`The following hierarchy groups exist in source but not in target: ${missingGroups.join(", ")}`);
}

// In copy.ts (execution):
// No need to check if mapping exists - validation guaranteed it
config.AllowedAccessControlHierarchyGroupId =
  comparisonResult.hierarchyGroups.groupMapping[sourceId]!.targetId;
```

**Anti-pattern to avoid:**
```typescript
// DON'T do this in execute:
if (hierarchyGroupName) {
  const targetId = mapping.get(hierarchyGroupName);
  if (targetId) {
    config.field = targetId;
  } else {
    console.log("Warning: not found"); // This should never happen if validation worked
  }
}
```

### 2. Composition Over Duplication

**Principle:** If another module has already solved your problem, use their result.

**Example:**
Security profiles needs hierarchy group mappings. Instead of:
```typescript
// DON'T do this:
const sourceGroups = await listUserHierarchyGroups(sourceClient, sourceInstanceId);
const targetGroups = await listUserHierarchyGroups(targetClient, targetInstanceId);
const sourceMap = buildMap(sourceGroups);
const targetMap = buildMap(targetGroups);
```

Do this:
```typescript
// DO this:
const hierarchyGroups = await compareHierarchyGroups({ sourceClient, targetClient, sourceInstanceId, targetInstanceId });
// Now use hierarchyGroups.groupMapping
```

**Benefits:**
- Single API call instead of duplicated calls
- Validation happens once
- If hierarchy groups logic changes, all consumers benefit
- Clear dependency in the code

### 3. Pre-filter Actions, Don't Mix Filtering with Execution

**Principle:** Separate data by category upfront, then process each category independently.

**Anti-pattern to avoid:**
```typescript
// DON'T do this:
let created = 0;
let updated = 0;

for (const action of actions) {
  if (action.action === "skip") continue;

  if (action.action === "create") {
    // create logic
    created++;
  }

  if (action.action === "update") {
    // update logic
    updated++;
  }
}
```

**Correct pattern:**
```typescript
// DO this:
const toCreate = actions.filter(a => a.action === "create");
const toUpdate = actions.filter(a => a.action === "update");

for (const createOp of toCreate) {
  // create logic
}

for (const updateOp of toUpdate) {
  // update logic
}

console.log(`${toCreate.length} created, ${toUpdate.length} updated`);
```

**Benefits:**
- No manual counter tracking (impossible to have counter bugs)
- Each loop is single-purpose and easier to reason about
- Visual clarity - you see the execution phases clearly
- Counts derived from data itself

### 4. Explicit Action Types, No Flags

**Principle:** Action types should be complete and explicit.

**Anti-pattern to avoid:**
```typescript
// DON'T do this:
interface Action {
  action: "create" | "update" | "skip";
  tagsNeedUpdate?: boolean;
}

if (action.action === "update" && action.tagsNeedUpdate) {
  // update tags
}
```

**Correct pattern:**
```typescript
// DO this:
interface Action {
  action: "create" | "update_all" | "update_tags" | "update_data" | "skip";
}

if (["update_tags", "update_all"].includes(action.action)) {
  // update tags
}
```

**Benefits:**
- Action type fully describes what will happen
- No need to check multiple flags
- Easier to filter and count
- Self-documenting

### 5. Group Code by Purpose, Not Caller

**Principle:** Module boundaries should follow conceptual purpose.

The display function analyzes and presents the comparison result. That's reporting, not copying. Even though only copy.ts calls it, it belongs in report.ts with the other analysis code.

**Module purposes:**
- **operations.ts** - AWS API interactions
- **report.ts** - Analysis and presentation
- **copy.ts** - Execution orchestration

### 6. Remove Data Redundancy

**Principle:** Don't store the same data in multiple places.

**Anti-pattern to avoid:**
```typescript
// DON'T do this:
interface Action {
  targetProfile: SecurityProfile;
  targetProfileId: string;  // Redundant - already in targetProfile.Id
  targetProfileArn: string; // Redundant - already in targetProfile.Arn
}
```

**Correct pattern:**
```typescript
// DO this:
interface Action {
  targetProfile: SecurityProfile;
}

// Access as needed:
updateSecurityProfile(client, instanceId, action.targetProfile?.Id!, config);
updateResourceTags(client, action.targetProfile?.Arn!, tags);
```

**Trade-off:** Slightly more typing (`?.Id!` vs `!`) for guaranteed consistency.

---

## Common Patterns

### Cross-Instance ID Remapping

When a resource references another resource by ID (e.g., security profile → hierarchy group), the ID is instance-specific and must be remapped.

**Pattern:**
```typescript
// 1. In report.ts, compose the dependency comparison:
const hierarchyGroups = await compareHierarchyGroups({ sourceClient, targetClient, sourceInstanceId, targetInstanceId });

// 2. Include it in the result:
return {
  actions,
  resources: filteredResources,
  hierarchyGroups  // Dependency result
};

// 3. In copy.ts, use the mapping:
if (createOp.sourceResource.HierarchyGroupId) {
  config.HierarchyGroupId = comparisonResult.hierarchyGroups.groupMapping[createOp.sourceResource.HierarchyGroupId]!.targetId;
}
```

**Trust assumption:** Validation in the dependency comparison (hierarchy groups) already checked that all referenced groups exist in target.

### Tag Handling

Tags are special in AWS Connect:
- Create operations accept tags directly
- Update operations do NOT accept tags - must use separate TagResource/UntagResource API

**Pattern:**
```typescript
// Create includes tags:
await createResource(client, instanceId, {
  ...sourceResource  // Includes Tags field
});

// Update does NOT include tags - separate operation:
const config = { ...sourceResource };
delete config.Tags;  // Or just don't spread Tags
await updateResource(client, instanceId, targetId, config);

// Then update tags separately:
if (["update_tags", "update_all"].includes(action.action)) {
  const { toAdd, toRemove } = CliUtil.getRecordDiff(source.Tags, target?.Tags);
  await AwsUtil.updateResourceTags(client, targetArn, toAdd, toRemove, verbose);
}
```

### Logging Functions

Extract logging to keep execute function focused on business logic.

**Pattern:**
```typescript
function logResourceCreate(action: ResourceAction, verbose: boolean) {
  console.log(`Creating resource: ${action.resourceName}`);
  if (!verbose) return;

  const resource = action.sourceResource;

  // Show important fields
  if (resource.Description) console.log(`  Description: ${resource.Description}`);
  console.log(`  SomeField: ${resource.SomeField ?? "(none)"}`);
  console.log(`  Tags: ${!resource.Tags ? "(none)" : Object.entries(resource.Tags).map(([k, v]) => `    ${k}=${v}`).join("\n")}`);
}

function logResourceUpdate(action: ResourceAction, dependencies: DependencyResult, verbose: boolean) {
  console.log(`Updating resource: ${action.resourceName}`);
  if (!verbose || !action.targetResource) return;

  const diffs = getResourceDiff(action.sourceResource, action.targetResource, dependencies);
  console.log(`  Diffs: ${diffs.join("\n    ")}`);
}

function logTagsUpdate(action: ResourceAction, verbose: boolean) {
  console.log(`Updating tags for resource: ${action.resourceName}`);
  if (!verbose) return;

  console.log(`  Tags: ${!action.sourceResource.Tags ? "(none)" : Object.entries(action.sourceResource.Tags).map(([k, v]) => `    ${k}=${v}`).join("\n")}`);
}
```

**Key patterns:**
- Show "(none)" for undefined/missing values (demonstrates field was checked)
- Use one-line console.log with join for arrays/objects (visual uniformity)
- Pass dependencies to update logging (for meaningful diff context)

---

## Type System Patterns

### Making Runtime Checks Visible to TypeScript

When you have a runtime check that guarantees a value exists, use type assertions:

```typescript
export async function describeResource(client: ConnectClient, instanceId: string, resourceId: string) {
  const response = await client.send(new DescribeResourceCommand({ ... }));

  // Runtime check:
  if (!response.Resource?.Name) {
    throw new Error(`Resource not found: ${resourceId}`);
  }

  // Type assertion based on runtime guarantee:
  return removeUndefined(response.Resource) as NoUndefinedVals<Resource> & { Name: string };
}
```

Now callers receive a type where `Name: string` (not `Name?: string | undefined`).

### Destructuring in Function Bodies

**Prefer:** Destructure config in function body, not parameters.

```typescript
// DO this:
export async function compareResources(config: ResourceComparisonConfig): Promise<Result> {
  const { sourceClient, targetClient, sourceInstanceId, targetInstanceId, filterConfig } = config;
  // ...
}

// NOT this:
export async function compareResources({
  sourceClient,
  targetClient,
  sourceInstanceId,
  targetInstanceId,
  filterConfig
}: ResourceComparisonConfig): Promise<Result> {
  // ...
}
```

**Reason:**
- Signature stays readable and shows conceptual input
- Config object available if needed to pass to other functions
- Can destructure only frequently-used properties

### Explicit Union vs Optional Properties

With `exactOptionalPropertyTypes: true`, distinguish:

```typescript
// Property may not exist:
interface Config {
  filterConfig?: FilterConfig;
}

// Property exists, value may be undefined:
interface Config {
  filterConfig: FilterConfig | undefined;
}
```

**Prefer explicit union** when the property should always be present on the object, even if the value is undefined.

---

## Testing the Architecture

When reviewing a resource implementation, check:

1. **File responsibilities:**
   - [ ] operations.ts has only AWS SDK wrappers
   - [ ] report.ts has comparison, diff, and display
   - [ ] copy.ts has orchestration and execution

2. **Validation guarantees:**
   - [ ] Dependencies validated in report.ts comparison
   - [ ] Execution trusts validation (uses `!` assertions confidently)
   - [ ] No "this should never happen" warnings in execute

3. **Composition:**
   - [ ] Dependencies called via their comparison functions
   - [ ] Full results included in comparison result
   - [ ] No rebuilding of maps/infrastructure

4. **Action handling:**
   - [ ] Explicit action types (no flags)
   - [ ] Pre-filtered before execution
   - [ ] No manual counter tracking

5. **Data structure:**
   - [ ] No redundant fields in action interfaces
   - [ ] Types reflect runtime guarantees
   - [ ] Destructuring used appropriately

6. **Logging:**
   - [ ] Extracted to separate functions
   - [ ] Shows "(none)" for missing values
   - [ ] One-line logs with join for collections

---

## Migration Checklist

To update an existing resource to this architecture:

1. **Review current structure:**
   - Identify which code belongs in which file
   - Find manual counter patterns
   - Look for defensive checks in execute
   - Check for local helpers that should be shared

2. **Update report.ts:**
   - [ ] Change comparison signature to take `ResourceComparisonConfig`
   - [ ] Add destructuring in function body
   - [ ] Update action types to be explicit (remove flags)
   - [ ] Compose dependencies instead of rebuilding
   - [ ] Add validation for cross-instance references
   - [ ] Move display function from copy.ts

3. **Update copy.ts:**
   - [ ] Update call to comparison to pass config object
   - [ ] Pre-filter actions by type
   - [ ] Remove manual counters
   - [ ] Remove defensive checks (trust validation)
   - [ ] Extract logging functions
   - [ ] Use dependency mappings for ID remapping
   - [ ] Update summary to use array lengths

4. **Update operations.ts:**
   - [ ] Add runtime checks for required fields
   - [ ] Use type assertions based on runtime checks
   - [ ] Use `removeUndefined()` for clean types

5. **Update action interface:**
   - [ ] Remove redundant fields
   - [ ] Use explicit action types
   - [ ] Put action field first

6. **Verify:**
   - [ ] TypeScript compiles
   - [ ] Validation catches missing dependencies
   - [ ] Execution doesn't have defensive warnings
   - [ ] Summary counts match actual operations

---

## Anti-Patterns Summary

**DON'T:**
- Mix filtering with execution (separate concerns)
- Track counts manually (derive from data)
- Rebuild infrastructure (compose dependencies)
- Add defensive checks in execute (trust validation)
- Store data redundantly (access from source)
- Use flags with actions (make types explicit)
- Put business logic in operations.ts (keep it in report.ts)
- Put display logic in copy.ts (belongs in report.ts)
- Check for conditions that validation should guarantee (trust the layers)

**DO:**
- Pre-filter actions by type
- Compose dependency results
- Validate in report.ts, trust in copy.ts
- Extract logging functions
- Use explicit action types
- Group code by purpose
- Use type assertions with runtime checks
- Destructure config in function body
- Show "(none)" for missing values in logs

---

## Example: Complete Flow

```typescript
// 1. User runs copy command
copySecurityProfiles(options);

// 2. Copy.ts loads config and creates clients
const config = await loadConfigs(options);
const sourceClient = createConnectClient(...);
const targetClient = createConnectClient(...);

// 3. Copy.ts calls report.ts comparison
const comparisonResult = await compareSecurityProfiles({
  sourceClient,
  targetClient,
  sourceInstanceId: config.source.instanceId,
  targetInstanceId: config.target.instanceId,
  filterConfig: config.source.securityProfileFilters
});

// 4. Report.ts performs comparison:
//    - Lists resources from both instances (via operations.ts)
//    - Filters source resources
//    - Composes dependencies (e.g., hierarchy groups)
//    - Validates cross-instance references exist
//    - Compares each resource
//    - Returns actions + dependencies

// 5. Report.ts displays the plan
displaySecurityProfilePlan(comparisonResult, verbose);

// 6. Copy.ts checks if copy needed and confirms with user
if (needsCopy && userConfirms) {

  // 7. Copy.ts executes:
  //    - Pre-filters actions by type
  //    - Creates new resources (via operations.ts)
  //    - Updates existing resources (via operations.ts)
  //    - Updates tags (via aws-utils)
  //    - Shows summary with counts from arrays
  executeSecurityProfileCopy(...);
}
```

---

## Conclusion

This architecture emerged from asking "why does this line feel clumsy?" and tracing the answer to architectural decisions. The patterns here represent trust built into structure:

- Validation trusts its checks
- Execution trusts validation
- Each module trusts others to do their job
- Types trust runtime guarantees

When you find yourself writing defensive code, nested conditionals, or duplicated infrastructure, ask: "Which layer should own this responsibility?" The answer usually simplifies the code significantly.

