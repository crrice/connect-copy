# Project Preferences

## Project Overview
Tool to copy contact flows from one Amazon Connect instance to another (e.g., dev → prod), written in TypeScript. Instances may be in the same or different AWS accounts.

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
- User hierarchies
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

### Two-Pass Approach (Circular Dependency Resolution)

**Problem:** Contact flows can reference each other (transfer loops), creating circular dependencies.

**Solution:**

1. **Pass 1 - Create Stub Flows**
   - Create all flows in target with minimal valid content
   - Use `Status=SAVED` to skip validation of ARN references
   - Stub flow structure:
     ```json
     {
       "Version": "2019-10-30",
       "StartAction": "<disconnect-block-id>",
       "Metadata": {},
       "Actions": [{
         "Identifier": "<disconnect-block-id>",
         "Type": "DisconnectParticipant",
         "Parameters": {}
       }]
     }
     ```
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

## Technical Stack
- TypeScript
- AWS SDK v3
- Target: CLI tool

## CLI Usage

### Configuration Files
Tool requires two config files (source and target), each containing:
- `instanceId` - Amazon Connect instance ID
- `region` - AWS region
- `flowFilters` - Optional include/exclude patterns for flow selection
- `moduleFilters` - Optional include/exclude patterns for module selection
- `viewFilters` - Optional include/exclude patterns for view selection

### Commands

**Main Copy Command**
```bash
connect-flow-copy copy \
  --source-config <path> \
  --target-config <path> \
  --source-profile <profile> \
  --target-profile <profile> \
  [--no-publish] \
  [--verbose]
```

Options:
- `--source-config` (required) - Path to source config JSON
- `--target-config` (required) - Path to target config JSON
- `--source-profile` (required) - AWS profile for source account
- `--target-profile` (required) - AWS profile for target account
- `--no-publish` (optional) - Keep all flows as SAVED regardless of source state
- `--verbose` (optional) - Enable detailed logging

**Report Command** - Validate without copying:
```bash
connect-flow-copy report \
  --source-config <path> \
  --target-config <path> \
  --source-profile <profile> \
  --target-profile <profile> \
  [--resources-only] \
  [--verbose]
```

Options:
- `--resources-only` (optional) - Only report resource differences, skip flow validation
- `--verbose` (optional) - Show detailed per-flow comparison results

**Copy Views Command** - Copy views separately:
```bash
connect-flow-copy copy-views \
  --source-config <path> \
  --target-config <path> \
  --source-profile <profile> \
  --target-profile <profile> \
  [--include-aws-managed] \
  [--verbose]
```

Options:
- `--include-aws-managed` (optional) - Include AWS managed views (default: skip)
- `--verbose` (optional) - Show detailed per-view comparison results

## Key Considerations

### Resource Matching & Dependencies
- Resources matched by **name**, not ARN (queues, prompts, flows, modules, etc.)
- Environment-specific resources (Lambdas, Lex bots) must pre-exist in target - tool validates presence
- Flow modules synced before flows (flows may reference modules)
- Flow modules have same circular dependency issues as flows

### Idempotency & Safety
- Tool is **idempotent** - safe to re-run after partial failures
- Read-only access to source instance
- Target writes only after explicit user confirmation
- Skips creating resources that already exist
- Skips updating flows with matching content

### Flow State & Publishing
- Flows can be in SAVED (draft) state before publishing
- Tool preserves flow state (SAVED/PUBLISHED) from source unless `--no-publish` flag used
- Preserves flow descriptions, metadata, and tags
- ARN validation may occur during content update

### Flow Filtering
- Config file supports include/exclude patterns (e.g., `Test_*`, `Draft_*`)
- Enables selective copying of flows matching specific patterns

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

GENERAL CODE STYLE:
- Keep code as simple and short as possible - no unnecessary error handling or unused references
- Remove try/catch blocks, unused imports, and unnecessary helper functions unless explicitly requested
- Match the existing code's naming patterns above all else - consistency with current code trumps style preferences
- Preserve existing variable/function names unless change is explicitly needed
- Use "happy path" coding where possible (assume success cases, minimal error handling)
- Keep business logic visible in main functions - extract technical mechanics (pagination, API details, parsing) to helpers
- No comments unless explicitly requested or genuinely complex logic requires explanation
- Use descriptive variable names that naturally indicate their contents through word choice (e.g., `tableName` vs `tableArn`, `userCount` vs `users`)

JAVASCRIPT/TYPESCRIPT PREFERENCES:
- When using AWS SDK, use the latest version (v3)
- Use all modern JavaScript features - no need for backward compatibility
- Use function declaration style (e.g., `function myFunction()`) instead of arrow functions for named functions
- Avoid default exports - prefer named exports (e.g., `export function myFunction()` instead of `export default myFunction`)
- All hand-written source files should start and end with a newline (blank first and last lines)
- Functions should have two blank lines before them
- Use SCREAMING_SNAKE_CASE for constants that mirror environment variable names (e.g., `const TABLE_NAME = process.env.TABLE_NAME`) when writing new code
- Choose quote style based on fewest escapes needed. When escapes are equal, prefer double quotes, then single quotes, then backticks
- Keep console output inspectable - pass objects directly rather than interpolating them into strings
- Avoid importing non-standard packages unless absolutely needed or explicitly requested
- Separate type imports from runtime imports using `import type`, with a blank line between them when both are multiline:
  ```typescript
  import { SomeCommand, AnotherCommand } from "@aws-sdk/client-connect";

  import type { SomeType, AnotherType } from "@aws-sdk/client-connect";
  ```
  Single-line imports from same source don't need blank line separation.
- Keep function signatures on a single line even if long (name, parameters, return type all together)
- Single-line conditionals for simple control flow - when condition is short and action is a single keyword (return, continue, break), write on one line without braces:
  ```typescript
  if (!name || !sourceArn) continue;
  ```
- Use liberal vertical whitespace - add blank lines before naked keywords or short statements so they stand out, especially control flow keywords after multi-line blocks
- Avoid excessive destructuring in loops or function parameters when reading from a variable is clearer - prefer `resourcePair.source` over destructuring `{ source }` if properties are used multiple times

CODE MODIFICATIONS - CRITICAL:
- NEVER modify existing code unless EXPLICITLY and CLEARLY instructed
- Questions like "Can you modify?", "Could you change?", "What if we changed?", "Would it be better if?", "Is it possible to?" are NOT instructions to modify
- For such questions, ONLY describe the changes in text/chat - do NOT produce modified code or update artifacts
- Only produce modified code when seeing direct commands: "Please modify", "Change the code", "Update the function", "Make this change", "Rewrite this", "Add this feature"
- If I suggest a modification and you reply with "yes", "do it", "go ahead", or similar affirmative responses, treat that as an explicit instruction to make the change
- When extracting code to functions, move ONLY what's explicitly requested - no extra features, improvements, or "while we're at it" changes
- If instructions are unclear, ASK before modifying anything
- Prefer localized changes over distributed modifications - single insertion/replacement when possible
- When showing code for the first time in a conversation, show the complete code. For subsequent modifications, you may show just the modified portions if the code is very long
- Even when I say something "doesn't work" or "has an error", do not modify code unless I explicitly ask for the modification

GIT COMMIT MESSAGE FORMAT:
- Use natural English sentences (not conventional commit types like "feat:", "fix:", etc.)
- Start with a capital letter and end with punctuation (period)
- Format: `<Subject line>.` followed by blank line, then optional body with details
- Subject line should describe what the commit does in imperative mood when possible
- Body should provide context using bullet points or paragraphs
- Use markdown formatting in body when helpful (code blocks, lists, bold/italic)
- Examples:
  ```
  Add flow filtering with pattern matching.

  Implements `matchesFlowFilters()` using minimatch for glob-style include/exclude patterns (e.g., "Test_*", "Draft_*").
  ```

  ```
  Initial commit.
  ```
