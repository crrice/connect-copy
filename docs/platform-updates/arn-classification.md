# ARN classification in dependency validation

Status: decided, not implemented. Not a platform change; an existing defect found during the November 2026 platform review.

## The problem

When a flow or module references a resource that has no counterpart in the target, validation decides what kind of resource it is by looking for a keyword in the ARN (`categorizeArn` in `src/arn-utils.ts`). For five resource types the keyword is the resource's friendly name, but the ARN uses a different word:

| Resource | Word in real ARNs | Word the code looks for |
|---|---|---|
| Quick connect | `transfer-destination` | `quick-connect` |
| Flow module | `flow-module` | `contact-flow-module` |
| Hours of operation | `operating-hours` | `hours-of-operation` |
| Agent status | `agent-state` | `agent-status` |
| Hierarchy group | `agent-group` | `hierarchy-group` |

Flows, queues, prompts, routing profiles and security profiles match.

The real words come from the [IAM reference for Connect](https://docs.aws.amazon.com/service-authorization/latest/reference/list_connect.html), not from a live instance.

## Effect on this package

This only matters when a referenced resource is missing from the target. In that case `validateDependencies` (`src/mapping.ts`) files the ARN as "unknown":

- It produces an "Unknown ARN type" warning where a blocking "not found in target" error is intended.
- Validation passes and the copy proceeds. In pass 2 the source ARN is left unreplaced in the content sent to the target.

Two cases matter most:

- **Hours of operation.** The "Check hours of operation" block references them, so a flow pointing at hours missing from the target gets through validation.
- **Flow modules.** The mismatch also bypasses the "module is about to be created" check. A flow that invokes a module being created in the same run is expected to produce a spurious "Unknown ARN type" warning.

Quick connects become relevant once they are copied after flows (see `01-flow-quick-connects.md`): a flow referencing a quick connect not yet in the target must fail validation with a clear error.

## Decision

Fix all five keywords in `categorizeArn` together, including quick connects. Item 1 relies on this fix but does not carry it.

## Open questions for the implementing session

These need a live instance.

- Confirm each of the five ARN words against a real ARN of that type.
- Check customer-managed view ARNs. The IAM reference gives them as `instance/{id}/view/{id}` with an optional `:qualifier`, while `categorizeArn` and `normalizeViewArn` look for `:view/`, which matches AWS-managed view ARNs. View handling was fixed in 0.2.1, so this may already be correct; verify before changing anything.
- Confirm what Connect does when content containing an untranslated source ARN is submitted (rejected, or saved with a dangling reference).
