# Amazon Connect Flow Copy Tool

A CLI tool to copy contact flows and supporting resources between Amazon Connect instances. Supports cross-account and cross-region copying.

## Features

- **Safe**: Validates dependencies before changes, requires confirmation, creates backups
- **Injective**: Copies source to target without deleting extras in target
- **Idempotent**: Safe to re-run after partial failures

## Prerequisites

- Node.js 18+
- AWS credentials for both accounts
- Connect read permissions on source, read/write on target

## Installation

```bash
npm install -g @crrice/connect-copy
```

## Configuration

Create source and target config files. See `examples/` directory for samples.

```json
{
  "instanceId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  "region": "us-east-1",
  "flowFilters": {
    "include": ["*"],
    "exclude": ["Test_*"]
  }
}
```

Filters (`flowFilters`, `moduleFilters`, etc.) only apply to source config. Target config only needs `instanceId` and `region`.

## Usage

```bash
# Copy all resources
connect-copy copy \
  --source-config ./source.json \
  --target-config ./target.json \
  --source-profile dev \
  --target-profile prod

# Copy everything except flows (sync supporting resources first, flows later)
connect-copy copy --skip flows \
  --source-config ./source.json \
  --target-config ./target.json \
  --source-profile dev \
  --target-profile prod
```

### Options for `copy` command

| Option | Description |
|--------|-------------|
| `--source-config` | Path to source configuration file (required) |
| `--target-config` | Path to target configuration file (required) |
| `--source-profile` | AWS profile for source account (required) |
| `--target-profile` | AWS profile for target account (required) |
| `--skip <resources>` | Comma-separated resource types to skip |
| `--skip-outbound-flow` | Skip outbound whisper flow configuration for queues |
| `--force-hierarchy-recreate` | Allow deleting and recreating hierarchy groups with parent mismatches |
| `--force-structure-update` | Allow overwriting target hierarchy structure if it differs from source |
| `--no-publish` | Keep flows as SAVED regardless of source state |
| `-y, --yes` | Auto-confirm all prompts |
| `--verbose` | Enable detailed logging |

Valid `--skip` values: `hours-of-operation`, `agent-statuses`, `hierarchy-groups`, `security-profiles`, `queues`, `routing-profiles`, `quick-connects`, `views`, `flows`

Resources are copied in dependency order: hours of operation, agent statuses, hierarchy groups, security profiles, queues, routing profiles, quick connects, views, flows. Each resource displays a comparison plan and prompts for confirmation individually.

## How It Works

1. **Validation** - Reads both instances, reports differences, validates dependencies. Exits if validation fails.
2. **Confirmation** - Shows what will be created/updated. Requires confirmation (unless `-y`).
3. **Execution** - Backs up existing flows, creates stubs, updates content, publishes if source was published.

The tool handles circular flow references via two-pass creation (stubs first, then content).

## Individual Resource Commands

Each resource type can also be copied individually. All commands share the same four required options (`--source-config`, `--target-config`, `--source-profile`, `--target-profile`) plus optional `-y, --yes` and `--verbose` flags.

| Command | Notes |
|---------|-------|
| `copy-hours-of-operation` | |
| `copy-agent-statuses` | System statuses excluded |
| `copy-hierarchy-groups` | `--force-hierarchy-recreate`, `--force-structure-update` |
| `copy-security-profiles` | APPLICATIONS field requires manual config |
| `copy-queues` | `--skip-outbound-flow`; STANDARD queues only |
| `copy-routing-profiles` | |
| `copy-quick-connects` | Syncs queue associations |
| `copy-views` | AWS-managed views: tags only |
| `copy-flows` | `--no-publish`; two-pass flow/module copy with ARN replacement |

### Report Command

Preview the full change set without making changes:

```bash
connect-copy report [options]
```

By default, `report` runs content comparison for all 9 resource types and shows the same create/update/skip plans that `copy` would display. Use `--resources-only` to skip content comparison and only show which resources are missing from target. Use `--skip` to omit specific resource types (same values as `copy`).

Accepts the same resource-specific flags as `copy`: `--skip-outbound-flow`, `--force-hierarchy-recreate`, `--force-structure-update`.

## Resource Matching

Resources are matched by **name** between instances: queues, routing profiles, hours of operation, prompts, flows, modules, quick connects, security profiles, user hierarchies, agent statuses, views.

**Environment-specific resources** (Lambda functions, Lex bots, S3 buckets, Customer Profiles domains, task templates) must pre-exist in target. ARNs can be transformed using config options:

```json
{
  "instanceId": "...",
  "region": "us-east-1",
  "arnMappings": {
    "arn:aws:lambda:us-east-1:111:function:special-fn": "arn:aws:lambda:us-east-1:222:function:different-name"
  },
  "arnPatterns": [
    { "match": "^(function:.*)-dev$", "replace": "$1-prod" },
    { "match": "^(bot:.*)-dev$", "replace": "$1-prod" },
    { "match": "^(s3://.*)-dev/", "replace": "$1-prod/" }
  ]
}
```

`arnMappings` provides explicit full ARN to full ARN replacement.

`arnPatterns` applies regex to the latter portion of the ARN only (e.g., `function:my-fn-dev` or `function:my-fn:$LATEST` for Lambda, `bot:my-bot` for Lex) - the region and account are preserved automatically. Uses standard JavaScript regex with capture group replacement (`$1`, `$2`, etc.).

**Tags** are updated bijectively on modified resources (source tags replace target tags exactly).

**Name collisions**: If target has a resource with the same name but different content, it will be overwritten. Review the confirmation report carefully.

## License

MIT
