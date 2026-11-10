# Predefined attributes as a new resource type

Status: agreed in principle, not yet discussed in detail, not implemented. Raised during item 4 (`04-workload-type-concurrency.md`).

## Background

Predefined attributes are named lists of string values held on the instance. They are not new, but this tool has never copied them, and more now depends on them:

- **Workload-type concurrency** (September 2026): routing profiles name values of the system attribute `connect:WorkloadType`.
- **Routing criteria and agent proficiencies:** flows that route on a proficiency depend on the attribute and value existing in the target.

System attributes use the `connect:` prefix (`connect:WorkloadType`, `connect:Language`, `connect:Subtype`). They cannot be created, renamed or deleted, but custom values can be added to some of them. Up to 500 values per attribute.

References: [Predefined attributes](https://docs.aws.amazon.com/connect/latest/adminguide/predefined-attributes.html).

## Effect on this package

No command copies predefined attributes, and validation does not check for them. A routing profile or flow that depends on a value missing from the target is either rejected or left silently broken.

## Direction

Add predefined attributes as a resource type following the existing pattern (`operations.ts`, `report.ts`, `copy.ts`):

- Matched by name.
- Injective: create missing attributes and add missing values; never remove an attribute or a value.
- For system attributes, add missing custom values only.
- Runs before routing profiles in the dependency order.
- Filters in the source config, like the other resource types.

## To settle

- Whether `Purposes` and `AttributeConfiguration` (`EnableValueValidationOnAssociation`, `IsReadOnly`) are compared and copied.
- Which system attributes accept custom values through the API.
- Whether values should ever be removed to match the source, or only added.
- Whether flow validation should check predefined attribute names and values referenced in routing criteria.
