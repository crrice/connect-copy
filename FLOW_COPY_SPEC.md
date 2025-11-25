# Amazon Connect Flow Copy Tool - Formal Specification

**Version:** 1.0
**Date:** 2025-01-26
**Authoritative as of:** Post-Phase 2 testing

---

## 1. Definitions

**1.1 Flow Status**
A flow's `Status` field has exactly one of two values: `SAVED` or `PUBLISHED`.

**1.2 Flow State**
The complete state of a flow, comprising its Status, content, metadata, and tags.

**1.3 Published Version**
The flow content returned by AWS Connect API when queried without the `:$SAVED` suffix. This is the version accessible to end users.

**1.4 Draft Version**
The flow content returned by AWS Connect API when queried with the `:$SAVED` suffix. This version exists only when Status=PUBLISHED and unpublished changes have been made.

**1.5 Source Instance**
The Amazon Connect instance from which flows are read. The tool MUST NOT modify the source instance.

**1.6 Target Instance**
The Amazon Connect instance to which flows are written. The tool MAY modify the target instance.

**1.7 Eligible Flow**
A flow in the source instance that satisfies all selection criteria (Definitions 1.8 and 1.9).

**1.8 Name Filter**
A set of glob patterns (include and/or exclude) applied to flow names. A flow matches IFF it matches at least one include pattern (if any exist) AND matches zero exclude patterns.

**1.9 Status Filter**
A requirement that flow Status MUST equal `PUBLISHED` for eligibility.

**1.10 Content Equivalence**
Two flows have equivalent content IFF their published versions produce identical JSON after normalization (whitespace-insensitive comparison).

---

## 2. Invariants

**2.1** A flow with Status=SAVED has exactly one version. Querying with or without `:$SAVED` suffix returns identical content.

**2.2** A flow with Status=PUBLISHED has at least one version (published). It MAY have a second version (draft) accessible via `:$SAVED` suffix.

**2.3** The tool operates on published versions only. Draft versions in the source instance MUST be ignored.

**2.4** All modifications to the target instance MUST be preceded by backup creation (except when no modifications are needed).

**2.5** Source instance state MUST remain unchanged after tool execution.

---

## 3. Source Flow Selection

**3.1** The tool MUST retrieve all flows from the source instance.

**3.2** Each flow MUST be evaluated against name filters (Definition 1.8). Flows not matching the name filter MUST be excluded.

**3.3** Each flow passing name filters MUST be evaluated against the status filter (Definition 1.9). Flows where Status≠PUBLISHED MUST be excluded.

**3.4** The set of flows satisfying Rules 3.2 and 3.3 constitutes the eligible flows (Definition 1.7).

**3.5** For each eligible flow, the tool MUST retrieve its published version (without `:$SAVED` suffix).

**3.6** The tool MUST NOT query or consider draft versions (`:$SAVED` suffix) in the source instance.

---

## 4. Target Flow Processing

**4.1** For each eligible source flow F, the tool MUST determine if a flow with identical name exists in the target instance.

**4.2** If no such flow exists, F is classified as **to-create**.

**4.3** If such a flow exists (call it T), the tool MUST retrieve T's published version.

**4.4** The tool MUST compare F and T for:
- Content equivalence (Definition 1.10)
- Description equality
- Tag set equality
- Status equality

**4.5** If F and T differ in any aspect per Rule 4.4, F is classified as **to-update**.

**4.6** If F and T are identical per Rule 4.4, F is classified as **to-skip**.

**4.7** The tool MUST validate all dependencies for flows classified as to-create or to-update. If validation fails, the tool MUST terminate with error status.

---

## 5. Publishing Rules

**5.1** Let `publish_flag` be a boolean derived from command-line arguments. Default: `true`. When `--no-publish` is specified: `false`.

**5.2** For a source flow F with Status S, the publishing decision is:

```
PUBLISH(F) = (S = PUBLISHED) AND (publish_flag = true)
```

**5.3** The publishing decision MUST be evaluated independently for each flow.

---

## 6. Execution Phases

### 6.1 Phase 1: Validation
The tool MUST perform all operations in Sections 3, 4, and dependency validation. No modifications to target instance occur.

### 6.2 Phase 2: User Confirmation
The tool MUST present the classification results (to-create, to-update, to-skip counts) and await user confirmation unless auto-confirm flag is set.

### 6.3 Phase 3: Backup
The tool MUST create a backup of all target flows classified as to-update.

### 6.4 Phase 4: Pass 1 - Stub Creation
**6.4.1** For each flow classified as to-create, the tool MUST invoke CreateContactFlow with Status=SAVED.

**6.4.2** Stub content MUST be a minimal valid flow (single DisconnectParticipant action).

**6.4.3** The tool MUST record the ARN of each created flow.

### 6.5 Phase 5: Pass 2 - Content Update
**6.5.1** For each flow classified as to-create:
- The tool MUST update content to match source
- IF PUBLISH(F) = true, update MUST occur without `:$SAVED` suffix (publishes)
- IF PUBLISH(F) = false, update MUST occur with `:$SAVED` suffix (remains SAVED)

**6.5.2** For each flow classified as to-update:
- The tool MUST update content to match source
- IF PUBLISH(F) = true, update MUST occur without `:$SAVED` suffix (publishes)
- IF PUBLISH(F) = false, update MUST occur with `:$SAVED` suffix (creates draft)

**6.5.3** After content update, if description differs, the tool MUST update description.

**6.5.4** After content update, if tags differ, the tool MUST synchronize tags.

---

## 7. State Transition Matrix

Given source flow status S ∈ {SAVED, PUBLISHED} and target flow status T ∈ {ABSENT, SAVED, PUBLISHED}, with publishing flag P ∈ {true, false}:

| Source | Target  | Flag P | Action      | Result Status | Notes |
|--------|---------|--------|-------------|---------------|-------|
| SAVED  | *       | *      | SKIP        | -             | Rule 3.3: Source ineligible |
| PUBLISHED | ABSENT | true   | CREATE+PUB  | PUBLISHED     | Pass 1: SAVED, Pass 2: publish |
| PUBLISHED | ABSENT | false  | CREATE      | SAVED         | Pass 1: SAVED, Pass 2: keep SAVED |
| PUBLISHED | SAVED  | true   | UPDATE+PUB  | PUBLISHED     | Status transition occurs |
| PUBLISHED | SAVED  | false  | UPDATE      | SAVED         | Content updated, status unchanged |
| PUBLISHED | PUBLISHED | true   | UPDATE   | PUBLISHED     | Published version updated |
| PUBLISHED | PUBLISHED | false  | UPDATE   | PUBLISHED*    | Draft created/updated, published unchanged |

\* When P=false and T=PUBLISHED, target's published version remains unchanged. A draft version (accessible via `:$SAVED`) is created or updated.

---

## 8. Failure Modes

**8.1** Dependency validation failure MUST terminate execution before Phase 3.

**8.2** AWS API errors during Phase 4 or 5 MAY result in partial state. The tool provides no automatic rollback.

**8.3** Backup creation failure MUST terminate execution before Phase 4.

---

## 9. Out of Scope

This specification does NOT define:

- AWS SDK implementation details
- Network error handling or retry logic
- Performance characteristics or optimization
- CLI argument parsing
- Logging or output formatting
- Backup restore procedures
- Module synchronization (separate specification)
- View synchronization (separate specification)
- Resource mapping algorithms (internal implementation)

---

## 10. Conformance

An implementation conforms to this specification IFF:

**10.1** All operations marked MUST are performed as specified.

**10.2** The state transition matrix (Section 7) is honored for all input combinations.

**10.3** Invariants (Section 2) hold before and after execution.

**10.4** Source instance state is unchanged (Invariant 2.5).
