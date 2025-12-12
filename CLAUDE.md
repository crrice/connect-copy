
# Project Preferences

## Project Overview

Tool to copy contact flows from one Amazon Connect instance to another (e.g., dev → prod), written in TypeScript. Instances may be in the same or different AWS accounts.

This tool performs injective (not bijective) operations - it copies source resources to target but never deletes extras from target.

## Development Setup

### Test Instances

| Instance | Config File | AWS Profile |
|----------|-------------|-------------|
| Thunderdome (source) | `config/thunderdome-config.json` | `personal` |
| Sandbox (target) | `config/sandbox-config.json` | `personal` |

### Build Commands

```bash
npm run build          # Compile TypeScript
npx tsc --noEmit       # Type check only
node dist/index.js     # Run CLI
```

### Testing a Resource Copy Script

1. Create test resources in source instance with various configurations
2. Run command with `--verbose` to see comparison details
3. Pipe output to file for review: `node dist/index.js copy-<resource> ... > test.txt`
4. Confirm copy, then verify in AWS Console
5. Re-run to confirm idempotency (should show "no changes needed")

## Resource Implementation Status

| Resource | Status | Notes |
|----------|--------|-------|
| Hours of Operation | ✅ Done | Consider refactoring to ResourceComparisonConfig pattern |
| Agent Statuses | ✅ Done | Cannot be deleted once created; consider refactoring to ResourceComparisonConfig pattern |
| User Hierarchy Groups | ✅ Done | Has `--force-hierarchy-recreate` flag |
| Security Profiles | ✅ Done | APPLICATIONS field requires manual config |
| Queues | ✅ Done | Has `--skip-outbound-flow` flag |
| Routing Profiles | ✅ Done | Depends on queues |
| Views | ✅ Done | AWS-managed views: tags only |
| Flows & Modules | ✅ Done | Main copy command, uses two-pass approach |
| Quick Connects | ✅ Done | Syncs queue associations |
| Prompts | 🔮 Future | Audio file handling; most clients manage externally |

### Resource Script Pattern

Each resource has three files in `src/resources/<resource>/`:
- `operations.ts` - AWS SDK wrappers (list, describe, create, update)
- `report.ts` - Comparison logic, builds action list
- `copy.ts` - Orchestration (load configs, compare, confirm, execute)

Newer scripts (hierarchy-groups, security-profiles, queues) use `ResourceComparisonConfig` interface for standardized comparison. Older scripts (agent-statuses, hours-of-operation) could be refactored to this pattern.

## Resource Dependencies

Copy resources in this order to satisfy dependencies:

1. **Hours of Operation** - No dependencies
2. **Agent Statuses** - No dependencies
3. **User Hierarchy Groups** - No dependencies
4. **Security Profiles** - Depends on hierarchy groups (for restrictions)
5. **Queues** - Depends on hours of operation, optionally flows (for outbound whisper)
6. **Routing Profiles** - Depends on queues (for queue associations and default outbound)
7. **Quick Connects** - Depends on users, queues, flows (for USER/QUEUE types)
8. **Views** - No dependencies
9. **Flows & Modules** - Depends on queues, views, routing profiles, and all other resources

## Resources to Copy

### Identifiable by Name (straightforward mapping)
- Queues
- Routing profiles
- Hours of operation
- Prompts (audio recordings)
- Contact flows
- Contact flow modules
- Quick connects
- Agent statuses
- Security profiles
- User hierarchy groups
- Views

### Environment-Specific Resources (must pre-exist in target)
- **Lambda functions** - ARNs differ across accounts/regions, must exist in target
- **Lex bots** - Version/alias names may differ, must exist in target
- **Customer Profiles domains** - Must exist if referenced
- **S3 buckets** - Globally unique names, must exist in target
- **Task templates** - Must exist if referenced
- Tool validates presence during validation phase and errors if missing

### Instance-Specific (do not copy)
- Phone numbers
- Integration associations

## Architecture

### Three-Phase Execution

1. **Phase 1: Validation**
   - Read all resources from source and target
   - Report resource differences
   - Compare flow/module content between instances
   - Validate dependencies only for flows/modules that differ
   - Check permissions
   - Exit without changes if validation fails

2. **Phase 2: User Confirmation**
   - Display detailed report (what will be created/updated/overwritten)
   - Require explicit user confirmation before proceeding

3. **Phase 3: Execution**
   - Sync resources in dependency order (modules before flows)
   - Apply two-pass approach for circular dependencies
   - Generate output mapping file (timestamp-based JSON for audit)

### Tag Handling

Resources are copied injectively (extras in target preserved), but tags are updated bijectively - tags on updated resources match source exactly (added, removed, or changed as needed).

### Two-Pass Approach (Circular Dependency Resolution)

**Problem:** Contact flows can reference each other (transfer loops), creating circular dependencies.

**Solution:**

1. **Pass 1 - Create Stub Flows**
   - Create all flows in target with minimal valid content
   - Use `Status=SAVED` to skip validation of ARN references
   - Obtain ARNs for all target flows
   - Build mapping: `sourceFlowArn → targetFlowArn`

2. **Pass 2 - Update Content**
   - Parse source flow content JSON
   - Replace all ARN references using mappings
   - Update target flow with corrected content using `UpdateContactFlowContent`
   - Publish flows using `PublishContactFlow` (if needed)

### Key API Operations
- `CreateContactFlow` - creates flow, returns ARN
- `UpdateContactFlowContent` - updates flow JSON
- `PublishContactFlow` - activates updated flow
- Similar operations for modules: `CreateContactFlowModule`, `UpdateContactFlowModuleContent`

## CLI Commands

All commands share these required options:
- `--source-config <path>` - Path to source config JSON
- `--target-config <path>` - Path to target config JSON
- `--source-profile <profile>` - AWS profile for source account
- `--target-profile <profile>` - AWS profile for target account
- `--verbose` (optional) - Enable detailed logging

### Configuration Files

**Source config**:
- `instanceId` - Amazon Connect instance ID
- `region` - AWS region
- `*Filters` - Optional include/exclude patterns (flowFilters, moduleFilters, viewFilters, agentStatusFilters, hoursFilters, hierarchyGroupFilters, securityProfileFilters, queueFilters, routingProfileFilters, quickConnectFilters)

**Target config**:
- `instanceId` - Amazon Connect instance ID
- `region` - AWS region

Note: Filters only apply to source config.

### Command Reference

| Command | Extra Options | Notes |
|---------|---------------|-------|
| `copy` | `--no-publish` | Main flow/module copy |
| `report` | `--resources-only` | Validate without copying |
| `copy-hours-of-operation` | | |
| `copy-agent-statuses` | | System statuses excluded |
| `copy-hierarchy-groups` | `--force-hierarchy-recreate` | WARNING: severs historical data |
| `copy-security-profiles` | | APPLICATIONS requires manual config |
| `copy-queues` | `--skip-outbound-flow` | STANDARD only; phone/email manual |
| `copy-routing-profiles` | | Depends on queues |
| `copy-quick-connects` | | Depends on users, queues, flows |
| `copy-views` | | AWS-managed: tags only |

## Known Limitations

### CAMPAIGN Flow Type Not Supported
- CAMPAIGN flow types (used for Amazon Connect Outbound Campaigns) are not currently supported
- Requires Outbound Campaigns feature which needs:
  - KMS key setup (AWS managed or customer managed)
  - Dedicated queues for campaign contacts
  - Special phone numbers that support outbound campaigns
  - Additional AWS costs
- If tool encounters a CAMPAIGN flow, it will fail with error: `Unsupported flow type: CAMPAIGN`
- To add support: Enable Outbound Campaigns in test instance and create template at `templates/flows/default-campaign-content.json`

---

## Code Style Guide

### General Principles
- Keep code as simple and short as possible - no unnecessary error handling or unused references
- Remove try/catch blocks, unused imports, and unnecessary helper functions unless explicitly requested
- Match the existing code's naming patterns above all else - consistency with current code trumps style preferences
- Preserve existing variable/function names unless change is explicitly needed
- Use "happy path" coding where possible (assume success cases, minimal error handling)
- Keep business logic visible in main functions - extract technical mechanics (pagination, API details, parsing) to helpers
- No comments unless explicitly requested or genuinely complex logic requires explanation
- Use descriptive variable names that naturally indicate their contents through word choice (e.g., `tableName` vs `tableArn`, `userCount` vs `users`)

### TypeScript Conventions
- AWS SDK v3, all modern JavaScript features
- Use function declaration style (e.g., `function myFunction()`) instead of arrow functions for named functions
- Named exports only (no default exports)
- All hand-written source files should start and end with a newline (blank first and last lines)
- Functions should have two blank lines before them
- Use SCREAMING_SNAKE_CASE for constants that mirror environment variable names
- Choose quote style based on fewest escapes needed. When escapes are equal, prefer double quotes, then single quotes, then backticks
- Keep console output inspectable - pass objects directly rather than interpolating them into strings
- Avoid importing non-standard packages unless absolutely needed
- NEVER use the `any` type - use `unknown`, proper interfaces, or generic type parameters instead
- Use `type[]` syntax instead of `Array<type>`
- Separate type imports from runtime imports using `import type`
- Keep function signatures on a single line even if long
- Single-line conditionals for simple control flow: `if (!name) continue;`
- Use liberal vertical whitespace
- Avoid excessive destructuring when reading from a variable is clearer
- Prefer type inference when runtime values are the source of truth
- Reuse types via `typeof` where appropriate

### Code Organization
- Story-style ordering - main exports at top, helpers below in order of use
- Export interface immediately above its primary function
- Separation of concerns - API wrappers (`operations.ts`) separate from logic (`report.ts`)
- Minimize definition-to-use distance

### Naming and Data
- Single Name Principle - all things should go by only one name
- Cross-instance clarity - variables must indicate instance (e.g., `sourceGroup`, `targetParentName`)
- Objects > Maps - use `Record<K, V>` unless non-string keys required
- Arrays > Sets - use arrays unless Set operations genuinely needed (e.g., `.has()` for O(1) membership checks)

### Error Handling
- Exceptions are for exceptional circumstances only - never for normal control flow
- Predictable failures return explicit states or empty results
- Show all failures - collect violations, don't fail on first
- Early returns for validation

### Git Commit Messages
- Natural English sentences (not conventional commit types)
- Start with capital letter and end with period
- Format: Subject line, blank line, optional body with details
- Body should provide context using bullet points or paragraphs
- Do not sign commits - use `--no-gpg-sign` flag explicitly

---

## AI Behavior Instructions

### Communication Style
- Avoid unnecessary praise or validation phrases unless genuinely warranted
- Use neutral, professional transitions: "Let's evaluate this", "Let's step through it"
- Be direct and factual in responses
- Reserve positive feedback for genuinely exceptional insights or critical corrections

### Code Modifications - CRITICAL
- NEVER modify existing code unless EXPLICITLY and CLEARLY instructed
- Questions like "Can you modify?", "Could you change?", "What if we changed?" are NOT instructions to modify
- For such questions, ONLY describe the changes in text - do NOT produce modified code
- Only produce modified code when seeing direct commands: "Please modify", "Change the code", "Update the function", "Make this change"
- If I suggest a modification and you reply with "yes", "do it", "go ahead", treat that as an explicit instruction
- When extracting code to functions, move ONLY what's explicitly requested - no extra changes
- If instructions are unclear, ASK before modifying anything
- Prefer localized changes over distributed modifications
- Even when I say something "doesn't work" or "has an error", do not modify code unless I explicitly ask

