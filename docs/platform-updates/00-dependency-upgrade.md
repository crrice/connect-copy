# 0. SDK and dependency upgrade

Status: decided, not implemented. Prerequisite for most of the other items.

## What is out of date

| Package | Current | Latest (November 2026) | Note |
|---|---|---|---|
| `@aws-sdk/client-connect`, `@aws-sdk/credential-providers` | 3.908.0 | 3.1165.0 | Needs Node 20+. Adds every API the other writeups rely on |
| `minimatch` | 10.0.3 | 11.0.6 | 10.x keeps one moderate advisory. 11.0.4+ needs Node 20+ |
| `commander` | 14.0.1 | 15.1.0 | 15 needs Node 22.12+ |
| `typescript` | 5.9.3 | 7.0.2 | |
| `@types/node` | 24.7.2 | 26.6.6 | Should track the minimum supported Node version |
| `@crrice/vali` | 2.4.0 | 2.5.0 | |

`npm audit` reports 22 findings on the current lockfile (1 critical, 2 high), most through the AWS SDK. `package.json` and the README still state Node 18 or later.

## Decisions

1. **Upgrade the AWS SDK packages to latest.**
2. **Raise the minimum Node version to 22** (`engines` in `package.json`, and the README). The SDK forces 20 or later, and Node 20 is already past end of life.
3. **Upgrade minimatch to 11.**
4. **Upgrade commander to 15.**
5. **Upgrade TypeScript to 7.**
6. **Bring `@types/node` and `@crrice/vali` up to date.**

## What was tried

In a scratch copy, with the SDK at 3.1165.0, minimatch 10.2.6, commander 14.0.3 and TypeScript 7.0.2:

- **TypeScript 7 no longer picks up `@types/node` automatically.** Without a change, every Node built-in and global (`console`, `process`, `fs/promises`) fails to resolve. Adding `"types": ["node"]` to `compilerOptions` in `tsconfig.json` fixes it.
- With that fix, the only errors are the four in `src/resources/quick-connects/report.ts` caused by the new `FLOW` quick connect type (item 1). The upgrade therefore lands together with item 1, or with a stopgap for those four lines.
- `npm audit` drops to the single moderate minimatch advisory, which minimatch 11 clears.

Not tried: minimatch 11, commander 15, the emitted build, or the `compile-test-utils` script under TypeScript 7.

## Checks for the implementing session

- Read the minimatch 11 changelog for changes to pattern matching. Filters decide what gets copied, so a behaviour change here matters.
- Read the commander 15 changelog for changes to option parsing.
- Confirm `npm run build` and `npm run compile-test-utils` work under TypeScript 7; the second passes compiler flags on the command line.
- Run a full `report` against the test instances before and after the upgrade and compare the output.
