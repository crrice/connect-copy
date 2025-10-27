# SPEC.md Coverage Matrix

**Purpose**: Map every testable rule in SPEC.md to test requirements

**Legend**:
- ✓ = Directly testable via black-box testing
- ⊕ = Testable via observable side effects
- ○ = Implementation detail (not externally testable)
- — = Definition/non-testable

---

## Section 2: Invariants

| Rule | Description | Testable | Test Method |
|------|-------------|----------|-------------|
| 2.1 | SAVED flow has exactly one version | ✓ | Describe with/without :$SAVED, verify identical |
| 2.2 | PUBLISHED flow has ≥1 version | ✓ | Describe PUBLISHED flow, verify accessible |
| 2.3 | Tool ignores source draft versions | ✓ | Create source draft, verify not copied |
| 2.4 | Modifications preceded by backup | ⊕ | Verify backup created before updates |
| 2.5 | Source unchanged after execution | ✓ | Compare source state before/after |

---

## Section 3: Source Flow Selection

| Rule | Description | Testable | Test Method |
|------|-------------|----------|-------------|
| 3.1 | Retrieve all flows from source | ○ | Implementation detail |
| 3.2 | Apply name filters | ✓ | Use include/exclude filters, verify results |
| 3.3 | Apply status filter (Status=PUBLISHED only) | ✓ | Create SAVED flow in source, verify excluded |
| 3.4 | Eligible flows = name filter AND status filter | ✓ | Combined test with 3.2, 3.3 |
| 3.5 | Retrieve published version of eligible flows | ○ | Implementation detail |
| 3.6 | Never query :$SAVED in source | ⊕ | Create source draft different from published, verify published version copied |

---

## Section 4: Target Flow Processing

| Rule | Description | Testable | Test Method |
|------|-------------|----------|-------------|
| 4.1 | Check if flow exists in target by name | ⊕ | Observable via create/update classification |
| 4.2 | Classify as to-create if absent | ✓ | Delete target flow, verify classified as create |
| 4.3 | Retrieve target published version | ○ | Implementation detail |
| 4.4 | Compare content, description, tags, status | ✓ | Modify each attribute separately, verify detection |
| 4.5 | Classify as to-update if differs | ✓ | Modify target, verify classified as update |
| 4.6 | Classify as to-skip if identical | ✓ | Ensure identical, verify skipped |
| 4.7 | Validate dependencies for create/update | ✓ | Create dependency gap, verify error |

---

## Section 5: Publishing Rules

| Rule | Description | Testable | Test Method |
|------|-------------|----------|-------------|
| 5.1 | publish_flag default=true, --no-publish sets false | ✓ | Test with/without flag |
| 5.2 | PUBLISH(F) = (Status=PUBLISHED) AND (flag=true) | ✓ | Test all 4 combinations |
| 5.3 | Evaluate independently per flow | ○ | Implied by 5.2 |

---

## Section 6: Execution Phases

| Rule | Description | Testable | Test Method |
|------|-------------|----------|-------------|
| 6.1 | Phase 1: Validation (no modifications) | ✓ | Run report command, verify no changes |
| 6.2 | Phase 2: User confirmation required | ○ | CLI behavior (skip with --yes flag) |
| 6.3 | Phase 3: Backup before updates | ✓ | Verify backup exists before modification |
| 6.4.1 | Pass 1: Create with Status=SAVED | ✓ | Delete target, verify created as SAVED |
| 6.4.2 | Stub content is minimal valid flow | ✓ | Check stub has single DisconnectParticipant |
| 6.4.3 | Record ARN of created flows | ○ | Implementation detail |
| 6.5.1 | Pass 2 (create): Update with/without :$SAVED per publish flag | ✓ | Test both flag states |
| 6.5.2 | Pass 2 (update): Update with/without :$SAVED per publish flag | ✓ | Test both flag states |
| 6.5.3 | Update description after content if differs | ✓ | Change description only, verify updated |
| 6.5.4 | Update tags after content if differs | ✓ | Change tags only, verify updated |

---

## Section 7: State Transition Matrix

Each row is independently testable:

| Row | Source Status | Target Status | publish_flag | Expected Action | Expected Result | Testable |
|-----|---------------|---------------|--------------|-----------------|-----------------|----------|
| 1 | SAVED | * | * | SKIP | - | ✓ |
| 2 | PUBLISHED | ABSENT | true | CREATE+PUB | PUBLISHED | ✓ |
| 3 | PUBLISHED | ABSENT | false | CREATE | SAVED | ✓ |
| 4 | PUBLISHED | SAVED | true | UPDATE+PUB | PUBLISHED | ✓ |
| 5 | PUBLISHED | SAVED | false | UPDATE | SAVED | ✓ |
| 6 | PUBLISHED | PUBLISHED | true | UPDATE | PUBLISHED | ✓ |
| 7 | PUBLISHED | PUBLISHED | false | UPDATE | PUBLISHED* | ✓ |

Row 7*: Published unchanged, draft created/updated

---

## Section 8: Failure Modes

| Rule | Description | Testable | Test Method |
|------|-------------|----------|-------------|
| 8.1 | Dependency validation failure terminates | ✓ | Create missing dependency, verify error |
| 8.2 | API errors may cause partial state | ⊕ | Document only (destructive to test) |
| 8.3 | Backup failure terminates execution | ⊕ | Document only (hard to reproduce) |

---

## Coverage Summary

### Directly Testable Rules: 31
- Section 2: 5 rules
- Section 3: 4 rules
- Section 4: 5 rules
- Section 5: 2 rules
- Section 6: 8 rules
- Section 7: 7 rows
- Section 8: 1 rule (8.1)

### Implementation Details (not testable): 7
- Rules that are internal mechanics

### Total Rules in SPEC: 38

### Coverage Target: 31/31 testable rules (100%)

---

## Minimal Test Set Design

### Test Grouping Strategy:

**Group 1: Source Selection & Filtering (Rules 3.x)**
- Test A: Name filtering (3.2, 3.4)
- Test B: Status filtering (3.3, 3.4, 2.3)
- Test C: Source draft ignored (3.6, 2.3)

**Group 2: Content Comparison (Rules 4.x)**
- Test D: Content difference detection (4.4, 4.5)
- Test E: Description difference detection (4.4, 4.5, 6.5.3)
- Test F: Tag difference detection (4.4, 4.5, 6.5.4)
- Test G: Skip when identical (4.6)

**Group 3: State Transitions (Section 7)**
- Test H1: Row 1 - SAVED source skipped (combined with Test B)
- Test H2: Row 2 - Create and publish (6.4.1, 6.4.2, 6.5.1)
- Test H3: Row 3 - Create without publish (6.4.1, 6.4.2, 6.5.1)
- Test H4: Row 4 - SAVED→PUBLISHED transition (6.5.2)
- Test H5: Row 5 - Update SAVED, stay SAVED (6.5.2)
- Test H6: Row 6 - Update PUBLISHED (6.5.2)
- Test H7: Row 7 - Update to draft only (6.5.2)

**Group 4: Execution Phases (Rules 6.x)**
- Test I: Stub creation (6.4.1, 6.4.2) - combined with H2
- Test J: Backup creation (6.3, 2.4)
- Test K: Validation-only mode (6.1)

**Group 5: Failure & Edge Cases (Rules 8.x, 2.x)**
- Test L: Dependency validation failure (4.7, 8.1)
- Test M: Source unchanged (2.5)
- Test N: Idempotency (re-run with no changes)

### Optimization via Combination:

Many tests can validate multiple rules simultaneously:
- **Test H2** validates: Rules 6.4.1, 6.4.2, 6.5.1, Section 7 Row 2
- **Test E** validates: Rules 4.4, 4.5, 6.5.3
- **Test B** validates: Rules 3.3, 3.4, Section 7 Row 1, 2.3

**Estimated minimal test count: 12-15 tests** (vs 19 in original plan)

---

## Rules Covered by Existing Tests

From TEST_RESULTS.md (Tests 1.1-1.4, 2.1-2.2):

| Existing Test | Rules Covered | Keep? |
|---------------|---------------|-------|
| Test 1.1: Delete & Recreate | Section 7 Row 2 (partial), 6.4.x | ❌ Broken (uses SAVED flow) |
| Test 1.2: Modify Content | 4.4, 4.5 | ✓ Rename to "Content Detection" |
| Test 1.3: Description-Only | 4.4, 4.5, 6.5.3 | ✓ Keep as Test E |
| Test 1.4: Tag-Only | 4.4, 4.5, 6.5.4 | ✓ Keep as Test F |
| Test 2.1: Status Update | Section 7 Row 6 | ✓ Rename to clarify |
| Test 2.2: --no-publish | Section 7 Row 7 | ✓ Keep as Test H7 |

**Preservation**: 5 tests can be kept with renaming/minor fixes
**New tests needed**: 7-10 additional tests
