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
npm install -g connect-flow-copy
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
connect-flow-copy copy \
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
| `--no-publish` | Keep flows as SAVED regardless of source state |
| `-y, --yes` | Auto-confirm all prompts |
| `--verbose` | Enable detailed logging |

## How It Works

1. **Validation** - Reads both instances, reports differences, validates dependencies. Exits if validation fails.
2. **Confirmation** - Shows what will be created/updated. Requires confirmation (unless `-y`).
3. **Execution** - Backs up existing flows, creates stubs, updates content, publishes if source was published.

The tool handles circular flow references via two-pass creation (stubs first, then content).

## Resource Commands

Copy supporting resources before copying flows. All commands share the same four required options (`--source-config`, `--target-config`, `--source-profile`, `--target-profile`).

### Recommended Order

| Order | Command | Dependencies | Notes |
|-------|---------|--------------|-------|
| 1 | `copy-hours-of-operation` | None | |
| 2 | `copy-agent-statuses` | None | System statuses excluded |
| 3 | `copy-hierarchy-groups` | None | `--force-hierarchy-recreate`, `--force-structure-update` |
| 4 | `copy-security-profiles` | Hierarchy groups | APPLICATIONS field requires manual config |
| 5 | `copy-queues --skip-outbound-flow` | Hours of operation | STANDARD queues only |
| 6 | `copy-routing-profiles` | Queues | |
| 7 | `copy-views` | None | AWS-managed views: tags only |
| 8 | `copy` | All above | Main flow/module copy |
| 9 | `copy-queues` | Flows | Sets outbound whisper flows |
| 10 | `copy-quick-connects` | Users, queues, flows | Syncs queue associations |

### Report Command

Validate without making changes:

```bash
connect-flow-copy report [options] [--resources-only]
```

## Resource Matching

Resources are matched by **name** between instances: queues, routing profiles, hours of operation, prompts, flows, modules, quick connects, security profiles, user hierarchies, agent statuses, views.

**Environment-specific resources** (Lambda functions, Lex bots, S3 buckets, Customer Profiles domains, task templates) must pre-exist in target with matching names.

**Tags** are updated bijectively on modified resources (source tags replace target tags exactly).

**Name collisions**: If target has a resource with the same name but different content, it will be overwritten. Review the confirmation report carefully.

## License

MIT
