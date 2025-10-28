# Amazon Connect Flow Copy Tool

A TypeScript CLI tool to safely copy contact flows and flow modules between Amazon Connect instances (e.g., dev → prod). Supports copying between instances in the same or different AWS accounts and regions.

## Terminology

Throughout this tool and codebase, we use specific terminology to distinguish between different types of Amazon Connect objects:

- **Flows** - Contact flows and flow modules (the things being copied)
- **Resources** - Supporting resources like queues, prompts, routing profiles, hours of operation, quick connects, security profiles, user hierarchies, and agent statuses (used for validation)
- **Instance Inventory** - Complete inventory of an Amazon Connect instance, combining both flows and resources

Note: When we say "resources" in this project, we specifically mean the supporting resources listed above, NOT flows or modules.

## Features

- **Safe by Design**: Read-only access to source, writes to target only after explicit confirmation
- **Cross-Account Support**: Copy between different AWS accounts and regions
- **Smart Validation**: Validates all dependencies before making any changes
- **Idempotent**: Safe to re-run after partial failures
- **Detailed Reporting**: Shows exactly what will change before execution
- **Flexible Filtering**: Copy all flows or specific flows matching patterns

## Prerequisites

- Node.js 18 or later
- AWS credentials configured for both source and target accounts
- Appropriate Amazon Connect permissions:
  - **Source**: Read permissions for Connect resources
  - **Target**: Read and write permissions for Connect resources

## Installation

```bash
npm install -g connect-flow-copy
```

Or run directly with npx:

```bash
npx connect-flow-copy [options]
```

## Configuration

Create two configuration files: one for source and one for target instance.

**Configuration Fields:**
- `instanceId` - Amazon Connect instance ID (UUID format, lowercase required)
- `region` - AWS region (e.g., "us-east-1", "us-west-2")
- `flowFilters`, `moduleFilters`, `viewFilters` - Optional filter patterns (source only)

### Source Configuration (`source-config.json`)

```json
{
  "instanceId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "region": "us-east-1",
  "flowFilters": {
    "include": ["*"],
    "exclude": ["Test_*", "Draft_*"]
  },
  "moduleFilters": {
    "include": ["*"],
    "exclude": []
  }
}
```

### Target Configuration (`target-config.json`)

```json
{
  "instanceId": "11111111-2222-3333-4444-555555555555",
  "region": "us-east-1"
}
```

**Important**: Filters (`flowFilters`, `moduleFilters`, `viewFilters`) only apply to the source configuration. They determine which resources to select from the source instance. The target configuration only specifies the destination instance.

### Filter Patterns

- `*` matches all flows
- `Test_*` matches flows starting with "Test_"
- Use `include` to specify which flows to copy
- Use `exclude` to skip specific flows

Example configs are available in the `examples/` directory.

## Usage

### Basic Usage

```bash
connect-flow-copy \
  --source-config ./source-config.json \
  --target-config ./target-config.json \
  --source-profile default \
  --target-profile default
```

### Cross-Account Copy

```bash
connect-flow-copy \
  --source-config ./source-config.json \
  --target-config ./target-config.json \
  --source-profile dev-account \
  --target-profile prod-account
```

### Keep Flows as SAVED (Don't Auto-Publish)

```bash
connect-flow-copy \
  --source-config ./source-config.json \
  --target-config ./target-config.json \
  --source-profile default \
  --target-profile default \
  --no-publish
```

### CLI Options

| Option | Required | Description |
|--------|----------|-------------|
| `--source-config` | Yes | Path to source configuration file |
| `--target-config` | Yes | Path to target configuration file |
| `--source-profile` | Yes | AWS profile for source account |
| `--target-profile` | Yes | AWS profile for target account |
| `--no-publish` | No | Keep all flows as SAVED regardless of source state |
| `--verbose` | No | Enable detailed logging |

## How It Works

The tool operates in three phases:

### Phase 1: Validation

The tool reads from both instances and:
- Reports resource differences (missing queues, prompts, etc.)
- Compares flow/module content to identify what needs copying
- Validates dependencies only for flows/modules that differ
- Checks target instance permissions

**If validation fails, the tool exits without making any changes.**

### Phase 2: User Confirmation

The tool displays a detailed report showing:
- Modules to be created
- Flows to be created
- Flows to be updated (explicitly listing each flow that will be overwritten)
- Any name collisions (resources with same name but different content)

You must confirm before any changes are made.

### Phase 3: Execution

1. **Flow modules** are created/updated first (flows may reference them)
2. **Contact flows** are created as stubs, then updated with actual content
3. Flows are published if source was published (unless `--no-publish` is used)

The tool is idempotent - it skips creating resources that already exist and skips updating flows that already have matching content.

## Resource Matching

### Name-Based Resources

These resources are matched between instances by **name**:
- Queues
- Routing profiles
- Hours of operation
- Prompts
- Contact flows
- Contact flow modules
- Quick connects
- Security profiles
- User hierarchies
- Agent statuses
- Views

### Environment-Specific Resources

These resources **cannot** be automatically matched and must exist in target:
- Lambda functions
- Lex bots
- Customer Profiles domains
- S3 buckets
- Task templates

**Important**: If the tool finds references to target resources that don't exist, it will report an error and exit. You must create these resources in the target instance before running the tool.

## Output Files

The tool generates a mapping file for audit purposes:

```
mapping-2025-10-13T10-30-00Z.json
```

This file contains:
- Timestamp of execution
- Source and target instance details
- Complete mapping of all ARNs (flows, modules, queues, lambdas, etc.)

## Handling Failures

### Pre-Flight Validation Failures

If validation fails (missing dependencies, permission issues, etc.), the tool exits without making any changes.

### Partial Failures During Execution

If the tool fails during execution:
- It reports exactly what succeeded and what failed
- Target instance may have stub flows or partially updated flows
- **Simply re-run the tool** - it's idempotent and will complete the operation
- No automatic cleanup or rollback is performed

## Important Notes

### Name Collisions

If the target has a resource with the same name as source but different content, **the tool will overwrite it**. The confirmation report explicitly lists all resources that will be overwritten. Review this carefully before confirming.

### Circular Dependencies

Contact flows can reference each other (e.g., Flow A transfers to Flow B, which transfers back to Flow A). The tool handles this by creating flows in two passes:
1. Create stub flows to obtain target ARNs
2. Update flows with actual content using mapped ARNs

### State Preservation

The tool preserves:
- Flow descriptions and metadata
- Flow tags
- Flow state (SAVED/PUBLISHED) unless `--no-publish` is used

## Examples

### Copy All Flows Between Same Account

```bash
connect-flow-copy \
  --source-config ./dev-config.json \
  --target-config ./prod-config.json \
  --source-profile default \
  --target-profile default
```

### Copy Specific Flows Between Accounts

Source config with filters:
```json
{
  "instanceId": "...",
  "region": "us-east-1",
  "flowFilters": {
    "include": ["CustomerService_*", "Support_*"],
    "exclude": ["*_Test"]
  }
}
```

```bash
connect-flow-copy \
  --source-config ./source-config.json \
  --target-config ./target-config.json \
  --source-profile dev \
  --target-profile prod \
  --verbose
```

### Copy Without Publishing

```bash
connect-flow-copy \
  --source-config ./source-config.json \
  --target-config ./target-config.json \
  --source-profile default \
  --target-profile default \
  --no-publish
```

## Troubleshooting

### "Missing resource" errors

**Cause**: Target instance is missing queues, prompts, or other resources referenced by flows.

**Solution**: Create the missing resources in target instance before running the tool.

### "Permission denied" errors

**Cause**: AWS credentials lack necessary permissions.

**Solution**: Ensure credentials have:
- Connect read permissions on source
- Connect read/write permissions on target

### Partial completion

**Cause**: Tool failed during execution.

**Solution**: Review the error message, fix any issues, and re-run the tool. It's idempotent and will complete the operation.

## Support

For issues or questions, please open an issue in the GitHub repository.

## License

MIT