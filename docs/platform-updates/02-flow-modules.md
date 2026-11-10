# 2. Flow modules: settings and external invocation

Status: partly decided, not implemented. Module versions and aliases are covered in item 3; the security profile fields that reference modules are covered in item 6.

## Platform change

Flow modules changed in three steps.

- **Custom inputs, outputs and branches (November 2025).** A module can declare a typed interface: an input schema, an output schema, and up to 8 custom branches. In the API this is the module's `Settings` field, a serialized JSON string separate from `Content`.
- **Modules as tools.** `ExternalInvocationConfiguration.Enabled` makes a module callable from outside a flow, by AI agents and by the agentic CX designer. A tool module may only contain a supported subset of blocks, and may only invoke other tool modules.
- **All flow types and nesting (April 2026).** Modules can be invoked from every flow type and from other modules, up to five levels deep.

What each API call accepts in SDK 3.1165.0:

| Field | `CreateContactFlowModule` | `UpdateContactFlowModuleContent` | `UpdateContactFlowModuleMetadata` |
|---|---|---|---|
| `Settings` | yes | yes (`Content` is now optional) | no |
| `ExternalInvocationConfiguration` | yes | no | no |

So `Settings` can be sent on its own, and the tool flag can only be set at creation through the documented API. The console can convert an existing module to a tool, so another route may exist.

References: [Flow modules for reusable functions](https://docs.aws.amazon.com/connect/latest/adminguide/contact-flow-modules.html), [UpdateContactFlowModuleContent](https://docs.aws.amazon.com/connect/latest/APIReference/API_UpdateContactFlowModuleContent.html), [CreateContactFlowModule](https://docs.aws.amazon.com/connect/latest/APIReference/API_CreateContactFlowModule.html).

## Effect on this package

The tool treats a module as name, description, tags and content. `Settings` and `ExternalInvocationConfiguration` are never read, compared, written or backed up.

- A module that differs only in its interface or its tool flag is reported as "content matches" (`compareAndValidateFlows` in `src/report.ts`).
- A module with custom inputs, outputs or branches is copied without them (`createContactFlowModule` and `updateContactFlowModuleContent` in `src/connect/operations.ts`, called from `src/copy-flows.ts`).
- The backup of a target module (`src/backup.ts`) omits both fields.
- Pass 2 updates modules one at a time in list order. If module A uses a custom branch of module B, and B is still a stub when A is published, Connect may reject A. This is unconfirmed.

## Decisions

1. **Copy and compare `Settings`.** Read it from the source, include it in the comparison and in the reasons shown, and write it on create and update.
2. **Add `Settings` and `ExternalInvocationConfiguration` to the module backup.**

## Open questions

### The tool flag

How to handle `ExternalInvocationConfiguration`, for new modules and for existing target modules whose flag differs from the source. Two approaches were raised:

- **Report it.** Tell the user clearly whenever a flag mismatch affects them, and leave the conversion as a manual step.
- **Recreate the module.** Delete or archive the target module and create it again with the other flag.

Points to weigh for recreating:

- The new module gets a new ID and ARN. Every target flow and module that invokes it must be re-pointed, including ones outside the current filters, which the tool would not touch.
- Its versions and aliases are lost (item 3), and security profiles that list it in `AllowedFlowModules` hold the old ID (item 6).
- The tool is injective by design and never deletes from the target. This would be its first delete.
- Archiving does not stop a module executing, and an archived module keeps its name.

Setting the flag at creation for modules that do not yet exist in the target is the simple case, and satisfies the rule that a tool module may only invoke tool modules, provided the flag is set on the stub.

To settle with a live instance:

- Is there an API route to change the flag on an existing module (what does the console call when you choose "Save as tool")?
- Can a module be deleted while flows reference it?

### Update ordering

Does Connect validate a caller against the callee's declared interface at publish time? If so, the order of module updates in pass 2 matters. The fix is to be chosen once the behaviour is known. Two candidates:

- **Interfaces first.** Push `Settings` to every module before any content (at creation for new modules, as a settings-only update for existing ones), then run the content pass as today. Depends on Connect accepting a declared interface on a stub whose content does not use it yet.
- **Callee-first ordering.** Update each module after the modules it invokes.

### Smaller checks

- The stub template (`templates/modules/default-module-content.json`) already has a `Settings` block inside the module content (input parameters, output parameters, Success/Error transitions). How does that relate to the top-level `Settings` field? Inspect a real custom-block module.
- Does `Settings` contain ARNs or IDs that need mapping between instances?
- Does nesting work with the existing stub pass when no custom interfaces are involved?

## Prerequisite

The AWS SDK upgrade (`@aws-sdk/client-connect` from 3.908.0), which adds both fields.
