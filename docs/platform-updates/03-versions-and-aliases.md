# 3. Flow and module versions and aliases

Status: direction decided, not implemented. Several behaviours need a live instance before the design is final.

**Needs a more in-depth look during implementation.** The fingerprint and rename behaviour in particular is expected to need refinement once there is more context on how the system behaves in practice. Treat the decisions below as the starting position, not a finished design.

## Platform change

| | Versions | Aliases |
|---|---|---|
| Flows | Existed before this tool's last update | New |
| Modules | New (November 2025) | New (November 2025) |

- **Version:** an immutable, numbered snapshot of the published content. Numbers are assigned by Connect, start at 1 and only increase. A version is created only on request: the "Create new version" check box when publishing, "Create version" on a published flow, or `CreateContactFlowVersion` / `CreateContactFlowModuleVersion`. A plain publish does not create one. The API snapshots the content that is currently published; a version cannot be created from a draft.
- **Alias:** a pointer to one version, with an alias ID assigned by Connect and an optional name. It can be repointed (`UpdateContactFlowAlias`, `UpdateContactFlowModuleAlias`).
- **References:** `flow-arn-or-id:VersionNumber` for a version and `flow-arn-or-id:AliasId` for an alias. With no qualifier, the latest published content is used. Aliases are referenced by ID, not by name.
- **Where references appear:** in flow content, and in other resources that point at a flow: queues, quick connects, phone numbers, task templates, views, rules, email, outbound campaigns.
- The older every-publish history still exists in the console as "Audit history". It is not numbered and is not reachable through the version APIs.

References: [Flow versioning and aliasing](https://docs.aws.amazon.com/connect/latest/adminguide/flows-versions-aliases.html), [Flow modules: versioning and aliasing](https://docs.aws.amazon.com/connect/latest/adminguide/contact-flow-modules.html), [CreateContactFlowVersion](https://docs.aws.amazon.com/connect/latest/APIReference/API_CreateContactFlowVersion.html), [CreateContactFlowModuleVersion](https://docs.aws.amazon.com/connect/latest/APIReference/API_CreateContactFlowModuleVersion.html).

## Effect on this package

- The tool copies the latest published content of each flow and module. Source versions and aliases are never read, and none are created in the target.
- A qualified reference in content has its base ARN translated and its qualifier left as is. A version number then points at whatever the target happens to have under that number, and an alias ID points at nothing, since alias IDs are per instance. Validation does not notice either case.
- The queue and quick connect copies look flows up by plain ID. A qualified flow reference there would be reported as a missing flow.

## Decisions

The goal is to get as close to one-to-one as possible while staying injective: the target must contain what the source needs, nothing in the target is deleted, and nothing is created in the target that does not come from the source.

1. **Replicate aliases.** A target alias with the same name as a source alias must point at content matching the source's. Alias references are mapped source alias ID → alias name → target alias ID.
2. **Match versions by fingerprint.** Version numbers cannot be matched across instances, so correspondence is by content. The fingerprint is the full content, including designer metadata and block positions, with every ARN replaced by the resource's type and name, in a canonical JSON form, hashed. Including positions keeps one definition of "same content": the existing flow comparison already treats a layout change as a difference, and designer metadata holds more than positions, so carving parts out risks treating different versions as equal.
3. **Resolve names on every run.** Version content is immutable and can be cached; the fingerprint cannot, because it depends on current resource names. Each side's fingerprint is computed from that side's own names, so fingerprints do not depend on copy order and can be computed in `report` mode before anything is copied.
4. **Stamp created versions, for provenance only.** Each version the tool creates in the target records the source version number and fingerprint in its description, so the report can show where a target version came from. The stamp is not used to decide correspondence: the fingerprint is the only test. The stamp format must stay readable by later releases.
5. **Three copy modes, one option.**

   | Mode | Copies |
   |---|---|
   | Live only (default) | Latest content, plus each alias and the version it points at |
   | Since shared | Also every source version after the most recent one with a match in the target |
   | All missing | Every source version with no match in the target |

6. **Mirror the snapshot.** After copying latest content, create a target version only if the source's latest content has one. A later alias move to that version is then just a repoint.
7. **Always finish on latest.** Whatever older content is published along the way, the last step publishes the source's latest.
8. **Do not snapshot target content before overwriting it.** Unversioned target content stays in Connect's audit history. Creating a version for it would put something in the target that did not come from the source.
9. **Correspondence report.** Show which source versions map to which target versions, and which have no counterpart, before or after a copy.
10. **Flows and modules both**, with the same mechanism.

## Renames

There is no rename handling: no rename list in the config and no detection. A name is the identity, as elsewhere in the tool.

- **Renamed on both sides by hand:** the names agree again, so fingerprints match on the next run.
- **Renamed in the source only:** the tool sees a new resource, creates it, and leaves the old one in the target. Source versions that reference it now resolve to the new name while their target counterparts resolve to the old one, so they stop matching. In the default mode such a version is re-pushed only if latest or an alias points at it; the target then gets a new version referencing the new resource.

The rule for maintainers: rename on both sides, or accept that a rename is treated as a new resource.

Stamping target resources with a source ID to detect renames automatically was considered and ruled out. Tags are made to match the source exactly, and nothing goes into the target that does not come from the source.

## Known consequences

- **Brief publication of old content.** Creating a missing version means publishing its content first. For a flow reached without a qualifier, callers get that content until the next step. With decision 6 this should be rare in the default mode: only when an alias points at a version the target has never had.
- **"All missing" does not preserve order.** An old source version copied late gets a high number in the target. The correspondence report still maps it.
- **Old versions may not be publishable.** A version that references a deleted resource cannot be published in the target, and cannot be fingerprinted by name.
- **Versions only in the target are left alone**, like any other extra resource. They show in the correspondence report as having no source counterpart.
- **Pinned version numbers in references** must be translated through the correspondence, not passed through.

## Related work

- Item 1 (FLOW quick connects) and the queue copy must handle qualified flow references.
- Item 2: a tool module must have "at least one published version" to be usable, which may make a target version mandatory for tool modules.

## Open questions for the implementing session

These need a live instance.

- Do modules use the same reference forms as flows (`:VersionNumber`, `:AliasId`), and can a specific module version be described?
- What do version and alias references look like in real flow content, including the "latest" option on the Invoke module block?
- Does publishing through the API ever create a version implicitly?
- What does Connect do with a reference to a version or alias that does not exist: reject at publish, or fail at runtime?
- Does content round-trip unchanged through describe and update, so fingerprints of copied versions match? The tool's existing idempotent re-runs suggest yes.
- Are there quotas on versions or aliases per flow or module?
- `CreateContactFlowVersion` accepts an optional `ContactFlowVersion` number. Is it usable by callers, or only for replication?
- How many API calls does fingerprinting cost on a realistic instance, and does it need rate limiting?
