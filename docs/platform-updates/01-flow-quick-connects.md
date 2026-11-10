# 1. FLOW quick connects

Status: decided, not implemented.

## Platform change

Quick connects gained a fourth type, `FLOW`, alongside `USER`, `QUEUE` and `PHONE_NUMBER`. It backs agent-initiated flows: an agent pushes an interactive workflow (a form, a payment step) into a live chat from the quick connect menu.

- The config is `QuickConnectConfig.FlowConfig.ContactFlowId`, a single flow ID.
- The flow must be an inbound flow (`CONTACT_FLOW` type).
- Chat channels only. One agent-initiated flow at a time per contact, at most 10 per chat.
- Created and associated with queues the same way as the other types.

References: [Enable agent-initiated flows](https://docs.aws.amazon.com/connect/latest/adminguide/agent-initiated-flows.html), [FlowQuickConnectConfig](https://docs.aws.amazon.com/connect/latest/APIReference/API_FlowQuickConnectConfig.html).

## Effect on this package

- `copy-quick-connects` throws `Unknown quick connect type` in `buildQuickConnectConfig` (`src/resources/quick-connects/copy.ts`) when the source has a `FLOW` quick connect.
- The comparison in `src/resources/quick-connects/report.ts` has no `FLOW` case, so such a quick connect is always reported as different.
- After the SDK upgrade, `QuickConnectType` includes `"FLOW"` and the `quickConnectType` union on `QuickConnectAction` no longer compiles (4 errors in `report.ts`).
- The flow dependency itself is not new: `USER` and `QUEUE` already carry a `ContactFlowId` and use the existing flow mapping. What changes is how often it matters. `FLOW` quick connects always point at a custom inbound flow, usually one this tool copies in the same run, and quick connects currently run before flows. On a fresh target they would be skipped for missing dependencies on the first run.

## Decisions

1. **Add the `FLOW` type.** Mirror the `QUEUE` case, minus the queue, in `getMissingDeps`, `quickConnectContentMatches`, `getQuickConnectDiff`, `logConfigDetails`, `buildQuickConnectConfig`, and the `quickConnectType` union. Queue associations need no change; they match by name regardless of type.
2. **Move quick connects after flows.** Change the order in `RESOURCE_STEPS` (`src/copy-all.ts`) and in the report order (`src/report.ts`), and update the dependency order in `README.md` and `CLAUDE.md`. No known flow block references a quick connect, so nothing is expected to depend on the old order.
3. **Check flow types in the preview phase.** The flow list already fetched includes each flow's type, so no extra API calls are needed. Report a mismatch through the existing "skip (missing deps)" path so it appears in both `report` and the copy preview, for example `Flow "X" in target is type AGENT_TRANSFER, expected CONTACT_FLOW`. Apply it to all three flow-bearing types:
   - `FLOW` requires `CONTACT_FLOW`
   - `USER` requires `AGENT_TRANSFER`
   - `QUEUE` requires `QUEUE_TRANSFER`
4. **Fix quick connect ARN classification.** `categorizeArn` in `src/arn-utils.ts` looks for `/quick-connect/`, but quick connect ARNs use `/transfer-destination/` (per the [IAM reference for Connect](https://docs.aws.amazon.com/service-authorization/latest/reference/list_connect.html)). With quick connects now copied after flows, a flow referencing a quick connect that is not yet in the target must fail validation with a clear error. Today it is classified as unknown, produces only a warning, and the copy proceeds with an unmapped source ARN. The same mismatch exists for other resource types; see the separate note on ARN classification.

## Prerequisite

The AWS SDK upgrade (`@aws-sdk/client-connect` from 3.908.0), which adds the `FLOW` type.

## Open questions for the implementing session

These need a live instance.

- Does the API accept a `FLOW` quick connect that points at a flow which is saved but not published? This decides how `FLOW` quick connects behave with `--no-publish`.
- Confirm a real quick connect ARN contains `/transfer-destination/`.
- Confirm no flow block in real flow content references a quick connect. If one does, a flow and a `FLOW` quick connect could reference each other, and the first copy would need a manual step.
