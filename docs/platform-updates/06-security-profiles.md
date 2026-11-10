# 6. Security profiles: new fields and AWS-managed type

Status: decided, not implemented.

## Platform change

Security profiles now govern AI agents and data as well as console permissions.

| Field | What it holds | Portable as is? |
|---|---|---|
| `Type` | `AWS_MANAGED` or `CUSTOMER_MANAGED` | n/a |
| `AllowedFlowModules` | Modules an AI agent with this profile may call as tools, by module ID (`ListSecurityProfileFlowModules`) | No. IDs are per instance |
| `AllowedAIAgents` | Third-party AI agents the profile grants access to, by ARN (`ListSecurityProfileAIAgents`) | No. ARNs are per environment |
| `GranularAccessControlConfiguration` | Row-level data table access: primary attribute names and allowed values | Yes. Names and values only |
| `Applications[].Type` | New marker on each application: `MCP` or `THIRD_PARTY_APPLICATION` | See open questions |

Also, since June 2026 a user can hold up to seven security profiles with access control (previously two). This does not affect the tool.

References: [SecurityProfile](https://docs.aws.amazon.com/connect/latest/APIReference/API_SecurityProfile.html), [UpdateSecurityProfile](https://docs.aws.amazon.com/connect/latest/APIReference/API_UpdateSecurityProfile.html), [GranularAccessControlConfiguration](https://docs.aws.amazon.com/connect/latest/APIReference/API_GranularAccessControlConfiguration.html).

## Effect on this package

`copy-security-profiles` copies description, permissions, tag-based access control and hierarchy restrictions (`src/resources/security-profiles/`).

- None of the new fields is read, compared or written. A difference in them is reported as "no changes needed".
- The profile `Type` is not checked, so the tool attempts to create or update AWS-managed profiles like any other.
- Module grants reference modules, which are copied last (with flows), while security profiles are copied fourth.

## Decisions

1. **Skip AWS-managed profiles** and list them in the report.
2. **Copy and compare granular access control as is.** It depends on the data table and attribute existing in the target (item 7).
3. **Map allowed flow modules by module name.** A grant whose module is missing from the target is reported through the "skip (missing deps)" path.
4. **Move security profiles after flows** in the `copy` and `report` order, so module grants resolve in a single run. Nothing copied by this tool is known to depend on a security profile. Update the dependency order in `README.md` and `CLAUDE.md`.
5. **Treat allowed AI agents like Lambda ARNs.** Translate them through the existing `arnMappings` and `arnPatterns` config where a mapping matches, and report any that have none.

## Prerequisite

The AWS SDK upgrade (`@aws-sdk/client-connect` from 3.908.0), which adds the new fields and list calls.

## Open questions for the implementing session

These need a live instance.

- **Applications.** The tool tells users the applications field "cannot be copied via AWS API" (`logManualConfigurationWarning` in `copy.ts`). The API accepts `Applications` on create and update, and did in SDK 3.908.0. The reason for the manual step is not recorded: the API may not have allowed it at the time, or setting it may have had no effect. Test whether applications set through the API take effect, including the new `Type` field. Decide whether to copy them and drop the warning based on the result.
- What does Connect return when an AWS-managed profile is updated, and which profiles are marked as managed? Can their tags be changed?
- What does an allowed AI agent ARN look like, and does `arnPatterns` (currently Lambda, Lex and S3 only) need extending for it?
- Does Connect check, when a profile is saved, that the data table attribute named in the granular access config exists?
- Does Connect check that an allowed flow module has external invocation enabled (item 2)?
