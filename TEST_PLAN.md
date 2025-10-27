# Amazon Connect Flow Copy Tool - Test Plan

**Version:** 2.0 (SPEC-based)
**Date:** 2025-01-26
**Based on:** SPEC.md v1.0

---

## 1. Test Plan Overview

### 1.1 Objectives

This test plan provides **proof of conformance** to SPEC.md. Each test validates specific SPEC rules and is designed for:

- **Completeness**: Cover all 31 testable rules
- **Minimality**: Eliminate redundancy through rule combination
- **Traceability**: Explicit SPEC rule references
- **Reproducibility**: Deterministic setup and verification

### 1.2 Test Environment

- **Source Instance (vm)**: `4b5d91f9-c7f7-4e83-90c2-e4591769d7c6` (us-east-1)
- **Target Instance (sb)**: `fca80682-f113-4e70-827d-a05bf62445fc` (us-east-1)
- **AWS Profile**: `personal`
- **Tool Version**: Post-Rule 3.3 fix

### 1.3 Test Categories

- **Category A**: Source Selection (4 tests)
- **Category B**: Content Comparison (4 tests)
- **Category C**: State Transitions (7 tests)
- **Category D**: Execution Mechanics (3 tests)
- **Category E**: Edge Cases (2 tests)

**Total: 20 tests** covering 31 SPEC rules

---

## 2. Category A: Source Selection

### Test A1: Name Filter - Include Pattern

**Validates**: SPEC Rules 3.2, 3.4

**Setup**:
```bash
# Create config with include filter
cat > config/test-include-filter.json <<EOF
{
  "instanceId": "fca80682-f113-4e70-827d-a05bf62445fc",
  "region": "us-east-1",
  "flowFilters": {
    "include": ["Default*"]
  }
}
EOF
```

**Execute**:
```bash
node dist/index.js report \
  --source-config config/voicemail-config.json \
  --target-config config/test-include-filter.json \
  --source-profile personal \
  --target-profile personal \
  --verbose
```

**Verify**:
- Only flows starting with "Default" are processed
- "RecordVoicemail" is excluded (verbose output shows excluded flows)
- Comparison summary shows correct filtered count

---

### Test A2: Name Filter - Exclude Pattern

**Validates**: SPEC Rules 3.2, 3.4

**Setup**:
```bash
# Create config with exclude filter
cat > config/test-exclude-filter.json <<EOF
{
  "instanceId": "fca80682-f113-4e70-827d-a05bf62445fc",
  "region": "us-east-1",
  "flowFilters": {
    "exclude": ["*whisper*"]
  }
}
EOF
```

**Execute**:
```bash
node dist/index.js report \
  --source-config config/voicemail-config.json \
  --target-config config/test-exclude-filter.json \
  --source-profile personal \
  --target-profile personal \
  --verbose
```

**Verify**:
- All flows with "whisper" in name are excluded
- Verbose output shows excluded flows with pattern match reason
- Other flows processed normally

---

### Test A3: Status Filter - SAVED Flows Excluded

**Validates**: SPEC Rules 3.3, 3.4, 2.3, Section 7 Row 1

**Setup**:
```javascript
// Create SAVED flow in source using test script
const flow = await createContactFlow({
  instanceId: sourceInstanceId,
  name: "TestSavedSourceFlow",
  type: "CONTACT_FLOW",
  content: stubContent,
  status: "SAVED"
});
```

**Execute**:
```bash
node dist/index.js copy \
  --source-config config/voicemail-config.json \
  --target-config config/sandbox-config.json \
  --source-profile personal \
  --target-profile personal \
  --verbose --yes
```

**Verify**:
- Verbose output shows: `TestSavedSourceFlow: Skip (source Status=SAVED, only PUBLISHED flows are copied)`
- Summary shows: `Excluded 1 flow (source Status≠PUBLISHED)`
- Flow NOT created in target
- Comparison counts exclude SAVED flows

---

### Test A4: Source Draft Ignored

**Validates**: SPEC Rules 3.6, 2.3

**Setup**:
```javascript
// Create published flow with different draft in source
// Published: entryPoint {x:20, y:20}
// Draft: entryPoint {x:99, y:99}
await updateContactFlowContent(sourceClient, sourceInstanceId, flowId + ":$SAVED", draftContent);
```

**Execute**:
```bash
node dist/index.js copy \
  --source-config config/voicemail-config.json \
  --target-config config/sandbox-config.json \
  --source-profile personal \
  --target-profile personal \
  --verbose --yes
```

**Verify**:
- Target receives published version (x:20, y:20), NOT draft version (x:99, y:99)
- Confirms tool never queries :$SAVED in source

---

## 3. Category B: Content Comparison

### Test B1: Content Difference Detection

**Validates**: SPEC Rules 4.4, 4.5

**Setup**: Modify flow content in target (change entryPointPosition)

**Execute**: Run copy command

**Verify**:
- Verbose output shows: `FlowName: Update (content differs)`
- Flow classified as to-update
- Content updated to match source

---

### Test B2: Description Difference Detection

**Validates**: SPEC Rules 4.4, 4.5, 6.5.3

**Setup**: Change only description in target

**Execute**: Run copy command

**Verify**:
- Verbose output shows: `FlowName: Update (description differs)`
- Flow classified as to-update
- Description updated after content update (per Rule 6.5.3)
- Content unchanged

---

### Test B3: Tag Difference Detection

**Validates**: SPEC Rules 4.4, 4.5, 6.5.4

**Setup**: Add/remove tags in target

**Execute**: Run copy command

**Verify**:
- Verbose output shows: `FlowName: Update (tags differs)`
- Flow classified as to-update
- Tags synchronized after content update (per Rule 6.5.4)
- Content unchanged

---

### Test B4: Skip When Identical

**Validates**: SPEC Rules 4.6

**Setup**: Ensure source and target have identical flows

**Execute**: Run copy command

**Verify**:
- All flows show: `FlowName: Skip (content matches)`
- No flows classified as to-create or to-update
- Message: "No flows or modules need to be copied"
- No backup created

---

## 4. Category C: State Transitions (Section 7)

### Test C1: Row 2 - Create and Publish

**Validates**: SPEC Section 7 Row 2, Rules 6.4.1, 6.4.2, 6.5.1

**Setup**: Delete flow in target

**Execute**:
```bash
node dist/index.js copy \
  --source-config config/voicemail-config.json \
  --target-config config/sandbox-config.json \
  --source-profile personal \
  --target-profile personal \
  --verbose --yes
```

**Verify**:
- Pass 1: Flow created with Status=SAVED
- Pass 1: Stub has single DisconnectParticipant action
- Pass 2: Flow updated with source content
- Pass 2: Flow published (Status becomes PUBLISHED)
- Final state: Status=PUBLISHED, content matches source

---

### Test C2: Row 3 - Create Without Publish

**Validates**: SPEC Section 7 Row 3, Rules 6.4.1, 6.4.2, 6.5.1

**Setup**: Delete flow in target

**Execute**:
```bash
node dist/index.js copy \
  --source-config config/voicemail-config.json \
  --target-config config/sandbox-config.json \
  --source-profile personal \
  --target-profile personal \
  --no-publish \
  --verbose --yes
```

**Verify**:
- Pass 1: Flow created with Status=SAVED
- Pass 2: Flow updated with :$SAVED suffix (remains SAVED)
- Final state: Status=SAVED, content matches source

---

### Test C3: Row 4 - SAVED to PUBLISHED Transition

**Validates**: SPEC Section 7 Row 4, Rule 6.5.2

**Setup**:
```javascript
// Create flow in target with Status=SAVED
await createContactFlow({
  instanceId: targetInstanceId,
  name: "TestFlowTransition",
  type: "CONTACT_FLOW",
  content: differentContent,
  status: "SAVED"
});
```

**Execute**: Run copy (without --no-publish)

**Verify**:
- Verbose output shows: `Update (content differs)` or `Update (status differs)`
- Flow updated and published
- Final state: Status=PUBLISHED
- **True status transition observed**

---

### Test C4: Row 5 - Update SAVED, Stay SAVED

**Validates**: SPEC Section 7 Row 5, Rule 6.5.2

**Setup**: Same as C3 (target flow with Status=SAVED)

**Execute**: Run copy with --no-publish

**Verify**:
- Flow updated with :$SAVED suffix
- Final state: Status=SAVED
- Content matches source

---

### Test C5: Row 6 - Update Published Version

**Validates**: SPEC Section 7 Row 6, Rule 6.5.2

**Setup**: Modify published flow content in target

**Execute**: Run copy (without --no-publish)

**Verify**:
- Flow updated without :$SAVED suffix
- Final state: Status=PUBLISHED
- Content matches source

---

### Test C6: Row 7 - Update to Draft Only

**Validates**: SPEC Section 7 Row 7, Rule 6.5.2

**Setup**: Modify published flow content in target

**Execute**: Run copy with --no-publish

**Verify**:
- Published version remains unchanged
- Draft version created/updated (accessible via :$SAVED)
- Describe without suffix: old content
- Describe with :$SAVED: new content (matches source)

---

### Test C7: Row 1 - SAVED Source Skipped

**Validates**: SPEC Section 7 Row 1

**Note**: Covered by Test A3 (Status Filter)

---

## 5. Category D: Execution Mechanics

### Test D1: Backup Creation Before Updates

**Validates**: SPEC Rules 6.3, 2.4

**Setup**: Modify flow in target to trigger update

**Execute**: Run copy command

**Verify**:
- Backup directory created with timestamp
- Backup contains target flow JSON (before modification)
- Backup manifest.json shows target instance metadata
- restore.sh has valid syntax and correct parameters
- Flow JSON files have no InstanceId field (per backup fix)

---

### Test D2: Validation-Only Mode

**Validates**: SPEC Rule 6.1

**Execute**:
```bash
node dist/index.js report \
  --source-config config/voicemail-config.json \
  --target-config config/sandbox-config.json \
  --source-profile personal \
  --target-profile personal \
  --verbose
```

**Verify**:
- All validation logic runs (inventory, comparison, dependency checks)
- Comparison summary displayed
- No backup created
- No modifications to target instance
- Source instance unchanged

---

### Test D3: Publishing Decision Logic

**Validates**: SPEC Rules 5.1, 5.2

**Setup**: Create scenarios with different source Status and flag combinations

**Test Matrix**:

| Source Status | Flag | Expected PUBLISH() Result |
|---------------|------|---------------------------|
| PUBLISHED | true (default) | true |
| PUBLISHED | false (--no-publish) | false |
| SAVED | true | N/A (filtered out) |
| SAVED | false | N/A (filtered out) |

**Verify**:
- Flag default is true (publish by default)
- --no-publish sets flag to false
- Decision evaluated per-flow
- SAVED flows excluded before decision (per Rule 3.3)

---

## 6. Category E: Edge Cases

### Test E1: Dependency Validation Failure

**Validates**: SPEC Rules 4.7, 8.1

**Setup**:
```bash
# Delete a prompt that a flow depends on in target
aws connect delete-prompt \
  --instance-id <target-id> \
  --prompt-id <prompt-id>
```

**Execute**: Run copy command

**Verify**:
- Validation phase detects missing prompt
- Error message shows: "Prompt not found in target: <arn>"
- Tool terminates before Phase 3 (no backup created)
- No modifications to target
- Exit code indicates error

---

### Test E2: Source Instance Unchanged

**Validates**: SPEC Rule 2.5, Invariant 2.5

**Setup**: Capture complete source instance state before test

**Execute**: Run full copy operation

**Verify**:
- List all flows before/after, verify identical
- Describe sample flows before/after, verify identical content
- No ARN changes in source
- No Status changes in source
- Invariant 2.5 maintained

---

## 7. Test Execution Order

**Phase 1: Foundation Tests** (validate core mechanics)
1. Test D2 (Validation-only mode)
2. Test B4 (Skip when identical)
3. Test E2 (Source unchanged)

**Phase 2: Source Selection** (validate filtering)
4. Test A3 (Status filter)
5. Test A1 (Include filter)
6. Test A2 (Exclude filter)
7. Test A4 (Draft ignored)

**Phase 3: Content Detection** (validate comparison)
8. Test B1 (Content detection)
9. Test B2 (Description detection)
10. Test B3 (Tag detection)

**Phase 4: State Transitions** (validate Section 7 matrix)
11. Test C1 (Create and publish)
12. Test C2 (Create without publish)
13. Test C3 (SAVED→PUBLISHED)
14. Test C4 (Update SAVED)
15. Test C5 (Update PUBLISHED)
16. Test C6 (Draft only update)

**Phase 5: Execution** (validate phases and mechanics)
17. Test D1 (Backup creation)
18. Test D3 (Publishing logic)

**Phase 6: Failure Cases** (validate error handling)
19. Test E1 (Dependency failure)

**Phase 7: Integration** (end-to-end validation)
20. Full integration test (combine multiple changes)

---

## 8. SPEC Coverage Summary

### Rules Covered: 31/31 (100%)

**Section 2 (Invariants)**: 5/5 rules
- 2.1, 2.2: Implicit in all tests using SAVED/PUBLISHED flows
- 2.3: Tests A3, A4
- 2.4: Test D1
- 2.5: Test E2

**Section 3 (Source Selection)**: 4/4 rules
- 3.2, 3.4: Tests A1, A2
- 3.3: Test A3
- 3.6: Test A4

**Section 4 (Target Processing)**: 5/5 rules
- 4.4, 4.5: Tests B1, B2, B3
- 4.6: Test B4
- 4.7: Test E1

**Section 5 (Publishing)**: 2/2 rules
- 5.1, 5.2: Test D3

**Section 6 (Execution Phases)**: 8/8 rules
- 6.1: Test D2
- 6.3: Test D1
- 6.4.1, 6.4.2: Tests C1, C2
- 6.5.1: Tests C1, C2
- 6.5.2: Tests C3, C4, C5, C6
- 6.5.3: Test B2
- 6.5.4: Test B3

**Section 7 (State Transitions)**: 7/7 rows
- Row 1: Test A3
- Row 2: Test C1
- Row 3: Test C2
- Row 4: Test C3
- Row 5: Test C4
- Row 6: Test C5
- Row 7: Test C6

**Section 8 (Failure Modes)**: 1/1 rule
- 8.1: Test E1

---

## 9. Migration from Existing Tests

### Tests to Preserve (with renaming):

| Old Test | New Test | Changes |
|----------|----------|---------|
| Test 1.2: Modify Content | Test B1 | Rename only |
| Test 1.3: Description-Only | Test B2 | Rename only |
| Test 1.4: Tag-Only | Test B3 | Rename only |
| Test 2.1: Status Update | Test C5 | Rename to "Update PUBLISHED Version" |
| Test 2.2: --no-publish | Test C6 | Rename to "Update to Draft Only" |

### Tests to Replace:

| Old Test | Replacement | Reason |
|----------|-------------|--------|
| Test 1.1: Delete & Recreate | Test C1 | Uses SAVED flow (broken), C1 is clearer |

### New Tests Added:

- All of Category A (Source Selection) - NEW
- Tests C2, C3, C4 (State transitions) - NEW
- All of Category D (Execution Mechanics) - NEW
- All of Category E (Edge Cases) - NEW

**Total**: 5 preserved, 1 replaced, 14 new = 20 tests

---

## 10. Success Criteria

### Individual Test Success:
- All verification points pass
- No unexpected errors or warnings
- Observable behavior matches SPEC requirements

### Overall Test Suite Success:
- All 20 tests pass
- All 31 testable SPEC rules validated
- No conformance gaps identified
- Tool demonstrates correctness as specified in SPEC.md v1.0

---

## 11. Notes

### Test Data Management:
- Use "Default agent hold" for tests requiring PUBLISHED flows (not "Block Defn" - it's SAVED)
- Clean up test flows after each test
- Document flow IDs for debugging

### Test Automation:
- Tests designed for manual execution initially
- Can be automated in future CI/CD pipeline
- Each test is independent and repeatable

### Maintenance:
- When SPEC.md updates, update this test plan accordingly
- SPEC_COVERAGE_MATRIX.md provides mapping for updates
- Version both documents together
