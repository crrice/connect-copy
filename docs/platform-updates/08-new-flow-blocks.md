# 8. New flow blocks and environment-specific references

Status: decided, not implemented.

## Platform change

Blocks added or changed since `FLOW_BLOCK_REFERENCE.md` was written:

| Block | What it references |
|---|---|
| Interrupt agent (`RouteContactToAgent`, June 2026) | A specific user, set manually or from an attribute (user ARN, ID or username). Customer queue flows only |
| Data Table (December 2025) | A data table (item 7) |
| Invoke module | Module versions, aliases and inputs (items 2 and 3) |
| External Tool | An MCP application and tool, selected by name, reached through a Bedrock AgentCore gateway integration |
| Agentic CX | An Agentic CX application built in the Agentic CX designer |
| Connect assistant (renamed from Amazon Q in Connect) | An assistant domain ARN and an orchestration AI agent |

How each block stores its reference is inferred from the admin guide; the flow-language reference for these actions was not found.

References: [Flow block definitions](https://docs.aws.amazon.com/connect/latest/adminguide/contact-block-definitions.html), [Interrupt agent](https://docs.aws.amazon.com/connect/latest/adminguide/interrupt-agent.html), [External Tool](https://docs.aws.amazon.com/connect/latest/adminguide/external-tool.html), [Agentic CX](https://docs.aws.amazon.com/connect/latest/adminguide/agentic-cx-block.html), [Connect assistant](https://docs.aws.amazon.com/connect/latest/adminguide/connect-assistant-block.html).

## Effect on this package

The tool does not need to know a block to copy it. It scans every block's parameters for Connect ARNs, translates those it has a mapping for, and passes everything else through. A new block is a problem only when it references a Connect resource type the tool does not map, or something outside Connect.

- **Users.** The flow ARN mapping (`buildAllResourceMappings` in `src/mapping.ts`) does not include users. A manually selected agent is passed through as the source user's ARN.
- **`arnMappings` is narrower than it looks.** `buildExternalArnMappings` in `src/arn-replacement.ts` only considers ARNs matched by `EXTERNAL_ARN_PATTERN` (Lambda, Lex, S3). An explicit mapping for any other ARN, an assistant domain for example, is never applied and gives no warning.
- **Other environment-specific references** (assistant domains, AI agents, Agentic CX applications) are passed through silently.
- **New blocks go unnoticed.** Nothing reports a block type the tool has no knowledge of.

## Decisions

1. **Map users in flow content by username**, as the quick connect copy already does. A user missing from the target is a blocking validation error. This also needs the `agent` ARN word recognised (see `arn-classification.md`).
2. **Apply explicit `arnMappings` to any ARN in content**, not only Lambda, Lex and S3. `arnPatterns` is unchanged. Item 6 relies on this for security profile AI agent ARNs.
3. **Recognise the new environment-specific kinds** (assistant domains, AI agents, Agentic CX applications), so an unmapped one produces the "must exist in target" warning.
4. **External Tool: no translation.** List the application names each flow uses in the report as things that must exist in the target.
5. **Report unrecognised block types.** Keep a list of the block types the tool knows and list any others found in the source flows at preview time.
6. **Update `FLOW_BLOCK_REFERENCE.md` and `src/arn-field-mapping.ts`** once the field names are confirmed.

## Open questions for the implementing session

These need a live instance.

- The action type, parameter names and reference forms for Interrupt agent, Data Table, External Tool, Agentic CX and Connect assistant, from real exported flows.
- Does Connect reject a flow at publish when it references a user, application or assistant domain that does not exist?
- What do assistant domain, AI agent and Agentic CX application identifiers look like, so they can be recognised?
