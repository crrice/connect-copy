# 7. Data tables as a new resource type

Status: decided, not implemented.

## Platform change

Released December 2025. A data table is a lookup table held on the instance and read at runtime by other resources, so that operational data (store hours, greeting text) can change without editing a flow.

- **Table:** name, description, time zone, lock level, tags.
- **Attributes (columns):** name, value type (`TEXT`, `NUMBER`, `BOOLEAN`, `TEXT_LIST`, `NUMBER_LIST`), whether it is a primary key, validation rules.
- **Values (cells):** addressed by primary key values plus attribute name. A value can be an expression (starting with `=`) that references the same or other tables. A default record supplies fallback values.
- **Referenced by:** flows (the Data Table block, with the table picked manually or set dynamically), views, and security profile row-level access (item 6).
- **Constraints:** primary attributes cannot be added or removed once a table holds data. Writes are subject to the table's lock level (optimistic locking).
- **Default quotas:** 100 tables per instance; 100 attributes and 1,000 values per table.

References: [Create and configure data tables](https://docs.aws.amazon.com/connect/latest/adminguide/data-tables.html), [Flow block: Data Table](https://docs.aws.amazon.com/connect/latest/adminguide/data-table-block.html).

## Effect on this package

Nothing copies or maps data tables.

- The inventory and ARN mapping (`src/mapping.ts`, `src/connect/resources.ts`) do not include them.
- A flow with a manually selected table is expected to produce an "Unknown ARN type" warning and be copied with the source table's ARN still in its content. This is inferred from the ARN format (`instance/{id}/data-table/{id}`), not observed.

## Decisions

Add data tables as a resource type following the existing pattern (`operations.ts`, `report.ts`, `copy.ts`).

1. **Copy structure.** Match tables and attributes by name. Create what is missing and update what differs. Never delete a table or an attribute.
2. **Copy values by default, for all tables.** Tables are excluded through filters in the source config (opt-out). This is the choice for now and may be revisited: data tables exist so operations staff can change live values in the target, and a copy overwrites those changes for every table not excluded.
3. **Values are made to match the source.** Add missing records and update differing ones. Never delete a record.
4. **Map table references in flow content** by adding data tables to the inventory and ARN mapping. A referenced table missing from the target is a blocking validation error, which also needs the `data-table` ARN word recognised (see `arn-classification.md`).
5. **Order:** before views, flows and security profiles, since all three can reference tables.
6. **Report primary key mismatches, do not fix them.** A target table whose primary attributes differ from the source's is listed in the report and skipped.

## Prerequisite

The AWS SDK upgrade (`@aws-sdk/client-connect` from 3.908.0), which adds the data table calls.

## Open questions for the implementing session

These need a live instance.

- How does a flow's Data Table block reference the table in content: ARN, ID or name?
- How does an expression reference another table? If by name, expressions copy as is.
- What does the table's `Version` field mean, and do tables have their own versioning?
- Does the lock level get in the way of bulk value updates, and how should lock versions be handled?
- Do views reference tables by an ID that needs mapping?
- Do values ever hold instance-specific data (queue ARNs, for example) that would need translating?
- How should the report present value changes for a large table?
