# Predefined attributes as a new resource type

Status: decided except for how values are synced, not implemented. Raised during item 4 (`04-workload-type-concurrency.md`).

## Background

Predefined attributes are named lists of string values held on the instance. They are not new, but this tool has never copied them, and more now depends on them:

- **Workload-type concurrency** (September 2026): routing profiles name values of the system attribute `connect:WorkloadType`.
- **Routing criteria and agent proficiencies:** flows that route on a proficiency depend on the attribute and value existing in the target.

In the API an attribute has:

- a name, which is also its identifier (there is no rename call),
- a flat list of string values, up to 500,
- a list of `Purposes`, which is how the console's "use as a contact search filter" and "use in analytics" choices are stored,
- `AttributeConfiguration.EnableValueValidationOnAssociation`, the console's "enforce valid values".

`UpdatePredefinedAttribute` replaces the whole value list.

System attributes use the `connect:` prefix (`connect:WorkloadType`, `connect:Language`, `connect:Subtype`). They cannot be created, renamed or deleted. Custom values can be added to `connect:WorkloadType` and `connect:Language`; `connect:Subtype` cannot be changed.

References: [Predefined attributes](https://docs.aws.amazon.com/connect/latest/adminguide/predefined-attributes.html).

## Effect on this package

No command copies predefined attributes, and validation does not check for them. A routing profile or flow that depends on a value missing from the target is either rejected or left silently broken.

## Decisions

Add predefined attributes as a resource type following the existing pattern (`operations.ts`, `report.ts`, `copy.ts`).

1. **Match by name.** Create missing attributes with their values, purposes and setting. Never delete an attribute.
2. **Purposes and "enforce valid values" are made to match the source.** Show the change clearly in the preview: turning on "enforce valid values" in the target can start rejecting contacts that carry a value the attribute does not list.
3. **System attributes get values only.** For `connect:WorkloadType` and `connect:Language`, sync custom values and touch nothing else. Skip `connect:Subtype`.
4. **Order:** before routing profiles.
5. **Filters** in the source config, like the other resource types.
6. **No flow validation for now.** Flows refer to these attributes by name in routing criteria, so nothing needs translating. Checking that every name and value a flow uses exists in the target is left until there is a case for it.

## Open decision: how values are synced

To be decided at implementation time. The current lean is the second option.

- **Add-only.** Add values the target lacks and never remove one, by sending the union of both sides.
- **Made to match the source**, as the tool does with tags: values missing from the source are removed from the target.

Points to weigh for matching the source:

- Connect warns that removing a value leaves any contact waiting for an agent with that value unmatched.
- A value in use by an agent proficiency, or by a routing profile's workload-type concurrency, may not be removable, or may strand contacts if it is (item 4).
- It would combine with "enforce valid values" (decision 2): with the target's extra values removed and enforcement on, contacts carrying those values are rejected.

## Open questions for the implementing session

These need a live instance.

- Does the API accept adding custom values to the system attributes, and which ones?
- Are names matched case-sensitively? The docs say `language` and `Language` cannot coexist, so names may need comparing without regard to case.
- What are the valid `Purposes` strings, and are they the same in every instance?
- What does the API do when a value in use by an agent or routing profile is removed?
