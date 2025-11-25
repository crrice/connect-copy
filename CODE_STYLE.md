
# Code Style Guide

## Foundational Principles

These philosophical guidelines drive all code decisions in this project:

1. **Exceptions are for exceptional circumstances** - They are never used for normal control flow. Predictable failures (validation errors, missing data) return explicit states or empty results.

2. **Array methods and functional style preferred** - When manipulating data, especially lists, use `.map()`, `.filter()`, `.forEach()` over manual loops where natural.

3. **TypeScript is used to its fullest potential** - Types must NEVER LIE unless there is very good reason (documented with inline comment explaining why).

4. **Happy path coding at all times** - The most standard or 'normal' code path should always be the least indented. Early returns for edge cases keep the main logic clean.

5. **Story-style ordering for files** - Main exported functions and interfaces at the top, with helper functions appearing below in order of use (like a story with table of contents followed by chapters).

6. **Single Name Principle** - All things should go by only one name. Do not rename variables or extract fields to different names without good reason. Use judgment: transformation chains may justify new names (`filteredGroups`, `sortedGroups`) but prefer chaining when operations are simple.

7. **Minimize definition-to-use distance** - Declare variables immediately before use, not at function start. Keep related code together. Exception: Group related declarations together when they form a cohesive set (e.g., partitioning a collection, parallel operations on same data).

---

## Specific Style Rules

### Control Flow
- **Errors ≠ control flow**: Exceptions for bugs only. Predictable failures return explicit state.
- **Show all failures**: Collect violations; don't fail on first. `violations.forEach(...)` not `throw on first`.
- **Early returns for validation**: Return empty results or abort states, not exceptions.

### Naming
- **Cross-instance clarity**: Variables must indicate instance. `sourceGroup`, `targetParentName` (never ambiguous `group` when dealing with source/target).
- **Consistency first**: Match existing patterns in the codebase above all other preferences.

### Data Structures
- **Objects > Maps**: Use `Record<K, V>` or `{ [key: string]: V }` unless non-string keys required.
- **Arrays > Sets**: Use arrays unless Set operations (union, intersection) genuinely needed.

### Code Organization
- **Story-style**: Exported functions first, helpers in order of use. Read top-to-bottom.
- **Interfaces above functions**: Export interface immediately above its primary function.
- **Separation of concerns**: API wrappers (`operations.ts`) separate from logic (`report.ts`).

