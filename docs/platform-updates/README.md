# Platform update notes, November 2026

These notes come from a review of the tool against changes to Amazon Connect since its last update (version 0.4.0, February 2026; AWS SDK pinned at 3.908.0 from October 2025). Each note describes a platform change, how it affects this package, what was decided, and what is left open.

Nothing here is implemented. The review had no access to a live instance, so runtime behaviour is taken from the AWS documentation and the SDK's type definitions. Each note ends with the checks that need a live instance.

## The notes

| Note | Subject | Status | Depends on |
|---|---|---|---|
| [00-dependency-upgrade.md](00-dependency-upgrade.md) | AWS SDK, minimatch, commander, TypeScript 7, Node 22 minimum | Decided | Lands with item 1 |
| [01-flow-quick-connects.md](01-flow-quick-connects.md) | New `FLOW` quick connect type; quick connects move after flows | Decided | 00, ARN classification |
| [02-flow-modules.md](02-flow-modules.md) | Module `Settings` and external invocation (modules as tools) | Partly decided. Tool flag handling and update ordering are open | 00 |
| [03-versions-and-aliases.md](03-versions-and-aliases.md) | Flow and module versions and aliases; matching versions by fingerprint | Direction decided. **Needs a more in-depth look during implementation** | 00 |
| [04-workload-type-concurrency.md](04-workload-type-concurrency.md) | Routing profile concurrency per workload type | Decided | 00, predefined attributes |
| [05-hours-of-operation.md](05-hours-of-operation.md) | Overrides and parent links | Decided | 00 |
| [06-security-profiles.md](06-security-profiles.md) | New fields, AWS-managed profiles; security profiles move after flows | Decided. Copying applications depends on a live test | 00, 02, 07, 08 |
| [07-data-tables.md](07-data-tables.md) | Data tables as a new resource type | Decided | 00, ARN classification |
| [08-new-flow-blocks.md](08-new-flow-blocks.md) | New blocks, users in flow content, wider `arnMappings` | Decided | ARN classification |
| [09-rename-and-discoverability.md](09-rename-and-discoverability.md) | The rename to Amazon Connect Customer | Decided. Very low priority | None |
| [arn-classification.md](arn-classification.md) | Existing defect: ARN keywords that do not match real ARNs | Decided | None |
| [predefined-attributes.md](predefined-attributes.md) | Predefined attributes as a new resource type | Decided, except how values are synced | 00 |

## Copy order after these changes

Three decisions move or add steps: quick connects move after flows (item 1), security profiles move after flows (item 6), and two resource types are added (predefined attributes, data tables). Taken together they give this order. It is derived from the individual notes and should be checked as each lands.

1. Hours of operation, then their overrides and parent links
2. Agent statuses
3. User hierarchy groups
4. Predefined attributes
5. Queues
6. Routing profiles
7. Data tables
8. Views
9. Flows and modules, with their versions and aliases
10. Quick connects
11. Security profiles

The dependency order in the main `README.md` and `CLAUDE.md` needs updating to match.

## Suggested order of work

A suggestion, not a decision.

1. **00 and 01 together.** The upgrade does not compile without the `FLOW` quick connect type.
2. **ARN classification.** Small, and items 1, 7 and 8 rely on it.
3. **08.** The wider `arnMappings` is needed by item 6.
4. **02.** Settle the two open questions against a live instance first.
5. **Predefined attributes, then 04.**
6. **05.**
7. **07.**
8. **06.** It depends on modules, data tables and the ARN mapping change.
9. **03.** The largest item, with the most to confirm against a live instance.
10. **09** with the next release.

## Principles that shaped the decisions

- **Injective.** The target must contain what the source needs. Nothing in the target is deleted: overrides, parent links, data table records, versions and extra resources are all left in place.
- **Nothing is created in the target that does not come from the source.**
- **A name is the identity.** Resources are matched by name. There is no rename handling; a rename on one side is treated as a new resource.
- **Report what cannot be done.** Where the tool cannot apply a change (a missing dependency, a structural conflict, an unsupported conversion), it says so in the preview and skips that part.
- **Tags, and settings on a resource, are made to match the source.**
