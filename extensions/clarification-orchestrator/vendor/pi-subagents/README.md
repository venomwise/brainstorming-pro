# pi-subagents Infrastructure Reuse Policy

This directory contains metadata for infrastructure-only reuse from [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents). It is not a runtime package import location. Brainstorming Pro owns all executable code under its normal source directories.

## Approved target directories

Derived or inspired TypeScript may be placed only in Brainstorming Pro-owned directories approved by the reuse inventory:

- `extensions/clarification-orchestrator/tui/` for read-only workflow rendering, result formatting, and terminal helpers.
- `extensions/clarification-orchestrator/workflow/` for workflow persistence helpers and live snapshot derivation that preserve runtime/gate semantics.
- `extensions/clarification-orchestrator/runtime/agent-execution/` for future foreground child process launch/output helpers.
- `extensions/clarification-orchestrator/shared/` only if a future inventory entry explicitly records a clearly named derived helper there.

Do not import executable logic from `extensions/clarification-orchestrator/vendor/pi-subagents/`. This directory is for `LICENSE`, `NOTICE.md`, this README, and `reuse-inventory.json` unless a future inventory entry and package validation explicitly approve a local helper target.

## Required TypeScript headers

Every copied or adapted derived TypeScript file must start with a header that identifies upstream, the notice token, MIT licensing, and Brainstorming Pro adaptation purpose.

### Direct vendoring example

```ts
/**
 * Derived from nicobailon/pi-subagents src/shared/formatters.ts.
 * Upstream notice token: pi-subagents@0.24.0.
 * Licensed under the MIT License; see vendor/pi-subagents/LICENSE and NOTICE.md.
 * Adapted for Brainstorming Pro workflow runtime terminology and tests.
 */
```

Use direct vendoring only for small business-agnostic helpers. Exported names must still fit Brainstorming Pro conventions when exposed to local code.

### Adapted infrastructure example

```ts
/**
 * Derived from nicobailon/pi-subagents src/runs/shared/pi-spawn.ts.
 * Upstream notice token: pi-subagents@0.24.0.
 * Licensed under the MIT License; see vendor/pi-subagents/LICENSE and NOTICE.md.
 * Adapted for Brainstorming Pro AgentRun/ReviewerRun foreground execution semantics.
 */
```

Adapted infrastructure must use workflow-first names such as `AgentRun`, `ReviewerRun`, `WorkflowProgress`, `WorkflowSnapshot`, or `WorkflowLiveSnapshot`. It must preserve topic/path guards, review decision binding, approval gates, and child execution safety defaults.

### Rewritten-from-reference example

```ts
/**
 * Inspired by nicobailon/pi-subagents src/tui/render.ts.
 * Upstream notice token: pi-subagents@0.24.0.
 * Licensed under the MIT License; see vendor/pi-subagents/LICENSE and NOTICE.md.
 * Rewritten for Brainstorming Pro read-only workflow live snapshots.
 */
```

Use `Inspired by` only when the file is heavily rewritten and the inventory status is `rewritten-from-reference`. The rewrite summary must be recorded in `NOTICE.md`.

## Product-boundary rules

Derived infrastructure must not expose generic `pi-subagents` product semantics. In particular, this reuse policy does not allow:

- a public generic `subagent` command or tool;
- arbitrary public `single`, `parallel`, `chain`, or `async` orchestration modes;
- background async runner commands;
- intercom runtime modules or public intercom commands;
- upstream builtin role files as user-visible Brainstorming Pro agents;
- TUI or snapshot code that mutates workflow state, approves gates, or transitions phases.

Any future need for those capabilities requires a separate design/spec and new tests before implementation.

## Sync checklist

For each upstream sync:

1. Update `NOTICE.md` with previous/new commit or version, import date, changed modules, conflict notes, tests, and reviewer notes.
2. Update `reuse-inventory.json` statuses and target paths before adding files.
3. Confirm every derived TypeScript file has the required header.
4. Run package validation, product-boundary tests, derived helper tests, and affected workflow tests.
5. Reject or rewrite any upstream change that leaks product semantics into Brainstorming Pro.
