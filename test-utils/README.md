# Test Utilities

**Purpose**: Shared utilities for testing the Amazon Connect Flow Copy Tool

**Created**: 2025-01-26
**Version**: 1.0

---

## Motivation

When writing tests for SPEC.md conformance, we need to:

1. **Authenticate** to AWS Connect instances repeatedly
2. **Create/delete** test flows in source and target instances
3. **Verify** flow state (Status, content, metadata, tags)
4. **Manipulate** flow content for test scenarios
5. **Clean up** test resources after execution

Without shared utilities, every test script would duplicate:
- AWS client creation and credential loading
- Instance ID constants
- Common flow operations (create, delete, describe)
- Assertion patterns for verification

This leads to:
- ❌ Code duplication across 20+ test scripts
- ❌ Inconsistent error handling
- ❌ Difficult maintenance (change profile → update 20 files)
- ❌ Verbose test code obscuring test intent

**Solution**: Centralize infrastructure in `test-utils/` and import where needed.

---

## Architecture

```
test-utils/
├── auth.ts          # AWS client creation and instance constants
├── flows.ts         # Flow lifecycle operations (create, delete, describe)
├── content.ts       # Flow content generation and manipulation
├── assertions.ts    # Verification helpers and test assertions
└── README.md        # This file
```

### Importing from Production Code

These utilities **leverage existing production code** where applicable:
- `createContactFlow()` from `src/connect/operations.ts`
- `describeContactFlow()` from `src/connect/flows.ts`

This ensures:
- ✓ Test infrastructure uses same APIs as production
- ✓ No reimplementation of AWS SDK calls
- ✓ Changes to production operations automatically propagate to tests

---

## Module Reference

### auth.ts - Authentication & Client Management

**Constants**:
```typescript
export const SOURCE_INSTANCE_ID = "4b5d91f9-c7f7-4e83-90c2-e4591769d7c6"; // vm
export const TARGET_INSTANCE_ID = "fca80682-f113-4e70-827d-a05bf62445fc"; // sb
export const REGION = "us-east-1";
export const PROFILE = "personal";
```

**Functions**:
```typescript
// Get singleton client for source instance
getSourceClient(): ConnectClient

// Get singleton client for target instance
getTargetClient(): ConnectClient

// Get client for any instance ID (auto-selects source/target)
getClient(instanceId: string): ConnectClient
```

**Usage Pattern**:
```typescript
import { getSourceClient, SOURCE_INSTANCE_ID } from "./test-utils/auth.js";

const client = getSourceClient();
// Use client...
```

**Why Singletons?**
- Reuses connections across operations in same test
- Avoids credential loading overhead
- Consistent with production `createConnectClient()` pattern

---

### flows.ts - Flow Lifecycle Operations

**Primary Functions**:
```typescript
// Create a test flow with stub content
createTestFlow(
  instanceId: string,
  name: string,
  status: ContactFlowStatus = "SAVED",
  type: ContactFlowType = "CONTACT_FLOW",
  description?: string
): Promise<{ id: string; arn: string }>

// Delete a test flow
deleteTestFlow(
  instanceId: string,
  flowId: string
): Promise<void>

// Get full flow details (with optional :$SAVED suffix)
getFlowDetails(
  instanceId: string,
  flowId: string,
  useSavedSuffix: boolean = false
): Promise<ContactFlow>

// Get just the Status field
getFlowStatus(
  instanceId: string,
  flowId: string
): Promise<ContactFlowStatus>

// Check if flow exists by name
flowExists(
  instanceId: string,
  flowName: string
): Promise<boolean>
```

**Cleanup Registry**:
```typescript
// Register flow for automatic cleanup
registerForCleanup(
  instanceId: string,
  flowId: string,
  flowName: string
): void

// Delete all registered flows (call at end of test)
cleanupAllFlows(): Promise<void>
```

**Usage Pattern**:
```typescript
import { createTestFlow, deleteTestFlow, registerForCleanup, cleanupAllFlows, SOURCE_INSTANCE_ID } from "./test-utils/flows.js";

// Create test flow
const { id, arn } = await createTestFlow(
  SOURCE_INSTANCE_ID,
  "TestFlow",
  "SAVED"
);

// Register for cleanup
registerForCleanup(SOURCE_INSTANCE_ID, id, "TestFlow");

// ... run test ...

// Cleanup at end
await cleanupAllFlows();
```

**Why Cleanup Registry?**
- Ensures test flows are deleted even if test fails
- Single cleanup call at end of test script
- Prevents orphaned flows accumulating in instances

---

### content.ts - Flow Content Helpers

**Functions**:
```typescript
// Generate minimal stub content (single DisconnectParticipant)
generateStubContent(): string

// Generate flow with specific entryPoint
generateFlowContent(
  entryPoint: { x: number; y: number }
): string

// Modify entryPoint in existing content
modifyEntryPoint(
  content: string,
  newX: number,
  newY: number
): string

// Extract entryPoint from content
getEntryPoint(
  content: string
): { x: number; y: number } | null
```

**Usage Pattern**:
```typescript
import { generateFlowContent, modifyEntryPoint } from "./test-utils/content.js";

// Create flow with specific entryPoint
const content = generateFlowContent({ x: 20, y: 20 });

// Modify existing content
const modified = modifyEntryPoint(content, 50, 50);
```

**Why Content Helpers?**
- Flow JSON is verbose and error-prone to write manually
- Tests need to create valid flows quickly
- Modification helpers avoid parsing/stringifying repeatedly

---

### assertions.ts - Verification Helpers

**Status Assertions**:
```typescript
// Assert flow has specific Status
assertFlowStatus(
  instanceId: string,
  flowId: string,
  expectedStatus: ContactFlowStatus,
  label?: string
): Promise<void>
```

**Content Assertions**:
```typescript
// Assert content matches (JSON-normalized comparison)
assertContentMatches(
  instanceId: string,
  flowId: string,
  expectedContent: string,
  useSavedSuffix: boolean = false,
  label?: string
): Promise<void>

// Assert entryPoint coordinates
assertEntryPoint(
  instanceId: string,
  flowId: string,
  expectedX: number,
  expectedY: number,
  useSavedSuffix: boolean = false,
  label?: string
): Promise<void>
```

**Metadata Assertions**:
```typescript
// Assert description matches
assertDescriptionEquals(
  instanceId: string,
  flowId: string,
  expectedDescription: string | undefined,
  label?: string
): Promise<void>

// Assert tags match
assertTagsEqual(
  instanceId: string,
  flowId: string,
  expectedTags: Record<string, string> | undefined,
  label?: string
): Promise<void>
```

**Draft Assertions**:
```typescript
// Assert draft version exists/doesn't exist
assertDraftExists(
  instanceId: string,
  flowId: string,
  shouldExist: boolean = true,
  label?: string
): Promise<void>
```

**Update Helper**:
```typescript
// Update flow content (useful for test setup)
updateFlowContent(
  instanceId: string,
  flowId: string,
  content: string,
  useSavedSuffix: boolean = false
): Promise<void>
```

**Usage Pattern**:
```typescript
import { assertFlowStatus, assertEntryPoint } from "./test-utils/assertions.js";
import { TARGET_INSTANCE_ID } from "./test-utils/auth.js";

// Verify flow state
await assertFlowStatus(TARGET_INSTANCE_ID, flowId, "PUBLISHED", "After copy");
await assertEntryPoint(TARGET_INSTANCE_ID, flowId, 20, 20, false, "Published version");
await assertEntryPoint(TARGET_INSTANCE_ID, flowId, 99, 99, true, "Draft version");
```

**Why Assertions Throw?**
- Standard Node.js test pattern (throw = failure)
- Clear error messages on mismatch
- Optional labels for context in multi-step tests

**Why Optional Labels?**
- Tests often verify same property multiple times
- Labels clarify which verification failed
- Example: `assertFlowStatus(..., "SAVED", "Before publish")` vs `assertFlowStatus(..., "PUBLISHED", "After publish")`

---

## Usage Patterns

### Minimal Test Structure

```typescript
import { getSourceClient, SOURCE_INSTANCE_ID, TARGET_INSTANCE_ID } from "./test-utils/auth.js";
import { createTestFlow, cleanupAllFlows, registerForCleanup } from "./test-utils/flows.js";
import { assertFlowStatus } from "./test-utils/assertions.js";

console.log("=== Test: Flow Creation ===\n");

try {
  // Setup
  console.log("1. Creating test flow...");
  const { id } = await createTestFlow(SOURCE_INSTANCE_ID, "TestFlow", "SAVED");
  registerForCleanup(SOURCE_INSTANCE_ID, id, "TestFlow");

  // Verify
  console.log("2. Verifying...");
  await assertFlowStatus(SOURCE_INSTANCE_ID, id, "SAVED");

  console.log("\n✓ Test PASSED");
} catch (error) {
  console.error("\n✗ Test FAILED:", error.message);
  process.exit(1);
} finally {
  // Cleanup
  await cleanupAllFlows();
}
```

### Multi-Step Test with Labels

```typescript
// Test: SAVED → PUBLISHED transition
const { id } = await createTestFlow(TARGET_INSTANCE_ID, "TransitionTest", "SAVED");
registerForCleanup(TARGET_INSTANCE_ID, id, "TransitionTest");

await assertFlowStatus(TARGET_INSTANCE_ID, id, "SAVED", "Initial state");

// ... run copy command ...

await assertFlowStatus(TARGET_INSTANCE_ID, id, "PUBLISHED", "After copy");
```

### Draft Version Testing

```typescript
// Create flow with both published and draft versions
const { id } = await createTestFlow(TARGET_INSTANCE_ID, "DraftTest", "PUBLISHED");
await updateFlowContent(TARGET_INSTANCE_ID, id, draftContent, true); // Update draft

// Verify both versions
await assertEntryPoint(TARGET_INSTANCE_ID, id, 20, 20, false, "Published");
await assertEntryPoint(TARGET_INSTANCE_ID, id, 99, 99, true, "Draft");
```

---

## Design Principles

### 1. **Composability**
Each utility does one thing well. Combine them for complex scenarios.

### 2. **Reuse Production Code**
Import from `src/` where applicable. Don't reimplement.

### 3. **Explicit Over Implicit**
- Function names clearly state what they do
- Required parameters come first, optional last
- No magic defaults (except common ones like `status="SAVED"`)

### 4. **Fail Fast**
- Assertions throw immediately on mismatch
- Clear error messages with context
- Tests terminate on first failure

### 5. **Clean State**
- Cleanup registry ensures no orphaned flows
- Tests are independent (no shared state)
- Can run tests in any order

---

## Future Enhancements

**Potential additions** (add when needed):

- **Module utilities**: Similar to flow utilities but for modules
- **View utilities**: For view testing (SPEC Section 9)
- **Backup utilities**: Helpers for backup verification
- **Report parsing**: Parse tool output for assertions
- **Performance helpers**: Timing and profiling utilities

**When to add new utilities**:
- Pattern appears in 3+ test scripts
- Complex operation needs standardization
- Production code doesn't provide needed functionality

---

## Maintenance

### Updating Constants

If instance IDs or profiles change, update **only** `auth.ts`:

```typescript
export const SOURCE_INSTANCE_ID = "new-source-id";
export const TARGET_INSTANCE_ID = "new-target-id";
export const PROFILE = "new-profile";
```

All tests automatically pick up the change.

### Adding New Assertions

Follow existing patterns:
1. Accept `instanceId` and `flowId` as first parameters
2. Accept expected value(s) next
3. Accept optional `label` last
4. Throw descriptive error on mismatch
5. Log success with checkmark: `console.log("  ✓ ...")`

### Deprecating Utilities

If a utility is no longer needed:
1. Mark as `@deprecated` in JSDoc
2. Keep implementation for backward compatibility
3. Remove after all tests migrated
4. Update this README

---

## Testing the Utilities

The utilities themselves should be simple enough to not require tests. However:

**If a utility has complex logic** (e.g., content manipulation):
- Add a sanity check script in `test-utils/sanity-check.ts`
- Run before committing changes

**If a utility breaks**:
- Fix in `test-utils/`
- All tests automatically pick up the fix
- This is a key benefit of centralization

---

## Questions?

See:
- **SPEC.md** - What the tool should do
- **TEST_PLAN.md** - How we test conformance
- **SPEC_COVERAGE_MATRIX.md** - Mapping of SPEC rules to tests

For test execution patterns, see completed tests in TEST_RESULTS_V2.md (when it exists).
