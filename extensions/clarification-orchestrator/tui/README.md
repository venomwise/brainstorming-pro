# Workflow TUI Scaffold

This directory contains the Brainstorming Pro workflow live progress presentation foundation. It renders `WorkflowLiveSnapshot` data produced by workflow-owned state plus command-scoped progress events. Interactive decision controls are optional and runtime-gated: they collect user intent only and submit it through `submitWorkflowDecision()` for authoritative validation.

## Implemented files

- `workflow-widget.ts` — compact and expanded renderer for workflow phase, reviewer/agent/task progress, artifact refs, diagnostics, gate cards, and optional runtime-gated interactive controls.
+- `interactive-gates.ts` — snapshot-derived interactive gate models and pure decision payload builders.
+- `decision-submission.ts` — idempotency-aware submission controller that calls the runtime decision facade.
+- `decision-controls.ts` — facade-only rendering/state helpers for review mode, recovery, design approval, revision authorization, and plan approval controls.
- `workflow-result.ts` — deterministic markdown/plain text fallback formatter for non-interactive status output.
- `workflow-session.ts` — fail-soft helper that opens a Pi custom component when available, requests redraws from controller updates, and closes/hides the component in cleanup paths.
- `render-helpers.ts` — ANSI-safe, width-aware rendering utilities.
- `formatters.ts` — duration, token/count, path, checksum, artifact, safe-command, and workflow status formatting helpers.

## Snapshot source of truth

TUI snapshots must be derived from workflow-owned data:

1. durable `state.json` for authoritative phase, pending gate, and artifact references;
2. durable `events.jsonl` for append-only workflow events;
3. in-memory progress emitted by currently running workflow adapters or child processes.

A `WorkflowLiveSnapshot` is presentation data only. TUI code can render phase/reviewer progress and approval cards, and optional controls can build `RuntimeUserDecision` intent, but TUI code cannot approve gates, mutate review decisions, advance workflow phases, change artifact refs, or write authoritative state.

Interactive controls require a runtime-owned gate binding (`gateId`, `gateNonce`, phase, artifact refs/checksums) and submit an idempotency key with each attempt. The runtime reloads authoritative state, validates the pending gate, nonce, phase, artifact refs, checksums, readiness/recovery context where applicable, and duplicate submissions before any durable write. A repeated submission with the same accepted idempotency key is treated separately from a stale or duplicate decision.

`/brainstorm-pro --resume <topic>` remains the deterministic CLI fallback for every interactive action. If snapshots are stale, corrupt, missing bindings, too narrow to render safely, or input handling fails, controls must disable executable actions and show the fallback rather than guessing.

## Non-TUI fallback

Every TUI feature must have a readable markdown or plain text fallback for non-interactive execution. If terminal capability detection fails, snapshot data is stale/corrupt, or rendering cannot fit the current width, the runtime should degrade to concise status text instead of corrupting workflow state. Runtime rejections must state that no decision was recorded and point users to `/brainstorm-pro --status` or `/brainstorm-pro --resume` when current status cannot be shown.

## Product boundary

TUI modules must use workflow-first terminology and must not inherit generic `pi-subagents` product concepts such as a public `subagent` command/tool, arbitrary `single`/`parallel`/`chain`/`async` orchestration, intercom, background async runners, or upstream builtin agent discovery.

Interactive TUI is not an execution dashboard. It must not expose plan review mode/subset/partial-accept/per-reviewer retry controls, select execution tasks, write task checkboxes, validate execution evidence, approve gates directly, run design revisers directly, or mutate artifacts/ledgers outside the runtime decision facade. Accept incomplete is not approval; plan review ready is not plan approval.
