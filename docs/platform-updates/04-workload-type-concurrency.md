# 4. Routing profiles: workload-type concurrency

Status: decided, not implemented.

## Platform change

Released September 2026. For the Task and Email channels, a routing profile can set concurrency per workload type instead of per channel.

- A workload type is a custom value of the system predefined attribute `connect:WorkloadType` (for example "Tax Filing"). Contacts get one from a Set contact attributes block or the `UpdateContact` API; with none set, a contact defaults to its subtype.
- In the API, each `MediaConcurrencies` entry gained `WorkloadTypeConcurrencies`: a list of `WorkloadType`, `Concurrency` (1–10) and `CrossChannelWorkloadBehavior`. The channel-level `Concurrency` became optional.
- A channel uses either channel-level or workload-type concurrency, not both. At most 5 workload types per channel per routing profile, and their limits must sum to 10 or less.
- If a contact's workload type has no matching entry in the agent's routing profile, the contact stays queued indefinitely.

References: [Channels and concurrency](https://docs.aws.amazon.com/connect/latest/adminguide/channels-and-concurrency.html), [WorkloadTypeConcurrency](https://docs.aws.amazon.com/connect/latest/APIReference/API_WorkloadTypeConcurrency.html), [Predefined attributes](https://docs.aws.amazon.com/connect/latest/adminguide/predefined-attributes.html).

## Effect on this package

The tool passes `MediaConcurrencies` through whole, so the new field travels with it, but nothing looks at it.

- **Create:** workload-type settings are copied.
- **Update:** `mediaConcurrenciesMatch` in `src/resources/routing-profiles/report.ts` compares channel, channel-level concurrency and cross-channel behaviour only. A workload-only difference is reported as "no changes needed" and never reaches the target.
- **Display:** the verbose output prints `TASK(undefined)` for a channel using workload types, and the diff line lists channel names only.
- **Dependency:** the tool does not copy predefined attributes. A routing profile copied to a target whose `connect:WorkloadType` lacks the values is either rejected or left silently broken.

## Decisions

1. **Compare workload-type concurrency.** Per channel, compare `WorkloadTypeConcurrencies` as a set keyed by `WorkloadType`, checking `Concurrency` and `CrossChannelWorkloadBehavior.ChannelWorkloadBehaviorType`.
2. **Show it.** Include workload types in the diff and in the verbose create and update output.
3. **Check the dependency in the preview.** Flag a routing profile whose workload types are missing from the target's `connect:WorkloadType`, and skip it, so `copy-routing-profiles` fails clearly when run on its own.
4. **Copy predefined attributes as a new resource type.** Tracked separately (`predefined-attributes.md`). Once it exists and runs before routing profiles, a full `copy` satisfies the dependency by itself.

## Prerequisite

The AWS SDK upgrade (`@aws-sdk/client-connect` from 3.908.0), which adds the new fields.

## Open questions for the implementing session

These need a live instance.

- Does the API reject a routing profile that names a workload type the instance does not have?
- Does a channel using workload types come back with no channel-level `Concurrency`, or with a zero?
- Does switching a channel between the two models need anything beyond sending the new array?
