# pi-subagents Reuse Notice

Brainstorming Pro may reuse selected infrastructure from [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) under the MIT License. This directory records the attribution and sync policy for any copied or adapted code.

## Upstream source

- Project: `nicobailon/pi-subagents`
- Source URL: https://github.com/nicobailon/pi-subagents
- npm package: `pi-subagents`
- License: MIT
- Copyright notice: Copyright (c) 2026 Nico Bailon
- Imported commit/version token: `pi-subagents@0.24.0` (`gitHead` not resolved in this repository; replace with an exact upstream commit before importing substantial derived code)
- Initial policy/import date: 2026-05-08

## Imported modules summary

The initial implementation imports these small helpers:

- `src/shared/formatters.ts` into `extensions/clarification-orchestrator/tui/formatters.ts` as an adapted formatting helper. The copied helper removes upstream `Usage`, `SingleResult`, `ChainStep`, and chain summary dependencies and exposes Brainstorming Pro workflow-oriented formatting names.
- `src/tui/render-helpers.ts` into `extensions/clarification-orchestrator/tui/render-helpers.ts` as read-only terminal rendering helpers. The local version uses Brainstorming Pro names and avoids upstream product types while preserving fuzzy filtering, width-aware rows, headers, footers, scroll info, and path/text display behavior.
- `src/shared/atomic-json.ts` into `extensions/clarification-orchestrator/workflow/atomic-json.ts` as an async atomic JSON helper plus parse wrapper. It is not yet wired into the workflow runtime and does not change artifact layout or gate semantics.

The reuse inventory also records planned target paths for future direct-vendored or adapted infrastructure modules including:
- atomic JSON, JSONL, and file coalescing helpers;
- workflow-owned TUI/live snapshot/status formatting patterns;
- foreground Pi child launch, spawn, and output handling patterns;
- artifact helper ideas that preserve Brainstorming Pro artifact layout.

The inventory also marks upstream extension lifecycle, background runner, intercom, and builtin agent modules as reference-only or not reused.

## Local modifications summary

Any copied code must be adapted for Brainstorming Pro workflow runtime semantics. Local adaptations must preserve workflow-first state, versioned artifact references, review decision binding, approval gates, topic/path safety, single-executable `PI_COMMAND` handling, provider-qualified model validation, `--no-session`, `--no-skills`, child process depth guards, and non-TUI fallback behavior.

Brainstorming Pro does not directly depend on, register, or expose the generic `pi-subagents` product model. This means no public generic `subagent` command, arbitrary `single`/`parallel`/`chain`/`async` orchestration API, intercom runtime, background async runner, or upstream builtin role discovery is imported by this reuse work.

## Header tokens

Derived TypeScript files must mention this notice token exactly:

- `Derived from nicobailon/pi-subagents`
- `pi-subagents@0.24.0`
- `MIT License`
- `Brainstorming Pro`

Heavily rewritten files may instead use `Inspired by nicobailon/pi-subagents` when the inventory status is `rewritten-from-reference` and this notice records the rewrite summary.

## Sync record

| Date | Previous commit/version | New commit/version | Changed modules | Local conflict notes | Tests run | Reviewer notes |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-05-08 | none | `pi-subagents@0.24.0` placeholder | Policy scaffold, inventory, adapted `src/shared/formatters.ts`, adapted `src/tui/render-helpers.ts`, and adapted `src/shared/atomic-json.ts` helpers | Exact upstream commit should be resolved before additional substantial derived-code imports; formatter product dependencies removed locally; render helpers renamed for workflow TUI use; atomic helper converted to async and left unintegrated with runtime layout | `npm run validate-package`; formatter tests; render helper tests; atomic JSON tests | Initial attribution scaffold and first helper imports |

## Future upstream sync process

1. Record the previous and new upstream commit or version before editing local derived files.
2. List every changed upstream module and the corresponding Brainstorming Pro target path from `reuse-inventory.json`.
3. Review changes for product semantics. Reject or rewrite changes that introduce generic delegation commands, arbitrary orchestration, background async jobs, intercom, builtin role discovery, or gate/state mutation outside workflow runtime APIs.
4. Document local conflicts and adaptation decisions in this notice.
5. Run derived helper tests, workflow safety tests, product-boundary tests, package validation, and any affected workflow runtime tests.
6. Add reviewer notes confirming that attribution headers and inventory statuses still match the imported code.
