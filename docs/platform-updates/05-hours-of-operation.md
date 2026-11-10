# 5. Hours of operation: overrides and parent links

Status: decided, not implemented.

## Platform change

Two layers sit on top of the weekly schedule.

- **Overrides** are date-specific exceptions belonging to one hours record: a name, a description, an effective date range, and either a set of hours or an open/closed type. Up to 50 per record. They predate this tool's last update. New in January 2026: recurrence (`RecurrenceConfig`, weekly, monthly or yearly) and `OverrideType` (`STANDARD`, `OPEN`, `CLOSED`). Recurring open/closed overrides take precedence over temporary hours.
- **Parent links** (new) let a record inherit the overrides of another. A child can have up to 3 parents; a parent cannot have a parent and a child cannot have children. Inherited overrides are read-only on the child and do not count toward its 50. The link is held on the child (`ParentHoursOfOperations` on describe, `AssociateHoursOfOperations` / `DisassociateHoursOfOperations` to change it) and refers to the parent by ID.

References: [Set overrides for extended, reduced, and holiday hours](https://docs.aws.amazon.com/connect/latest/adminguide/hours-of-operation-overrides.html), [ParentHoursOfOperationConfig](https://docs.aws.amazon.com/connect/latest/APIReference/API_ParentHoursOfOperationConfig.html).

## Effect on this package

`copy-hours-of-operation` copies name, description, time zone and the weekly schedule. Overrides and parent links are never read (`src/resources/hours-of-operation/`).

- A copied hours record behaves differently in the target on every date an override covers.
- A difference in overrides or links is reported as "no changes needed".

## Decisions

1. **Copy overrides, matched by name within each hours record.** Create the missing ones and update those that differ, comparing description, effective dates, hours, recurrence and type.
2. **Never delete a target override.** A closure entered directly in the target (a weather closure in production, for example) has no source counterpart, and removing it would reopen the contact centre. Target-only overrides are listed in the report and left alone.
3. **Copy overrides as they are, including expired ones.** The two sides stay identical and the comparison stays simple.
4. **Copy parent links by name, as a second step after all hours records exist.** If the parent is missing from the target, report the link as a missing dependency and skip it.
5. **Never remove a target link.** If adding a link would exceed the three-parent limit, or the target's structure conflicts (the source's child is already a parent in the target), report it and skip.

## Prerequisite

The AWS SDK upgrade (`@aws-sdk/client-connect` from 3.908.0), which adds recurrence, override type and the parent link calls.

## Open questions for the implementing session

These need a live instance.

- Does listing a child's overrides include inherited ones? If so, they must be told apart from the child's own, or they would be copied as the child's and count toward its 50.
- Are override names unique within an hours record? Matching by name depends on it.
- Does the API accept creating an override whose date range is already past?
