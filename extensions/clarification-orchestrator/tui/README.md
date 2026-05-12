# Workflow TUI Scaffold

This directory contains the Brainstorming Pro read-only workflow live progress presentation foundation. It renders `WorkflowLiveSnapshot` data produced by workflow-owned state plus command-scoped progress events. It is intentionally not an interactive decision surface.

## Implemented files

- `workflow-widget.ts` — compact and expanded read-only renderer for workflow phase, reviewer/agent/task progress, artifact refs, diagnostics, and gate cards.
- `workflow-result.ts` — deterministic markdown/plain text fallback formatter for non-interactive status output.
- `workflow-session.ts` — fail-soft helper that opens a Pi custom component when available, requests redraws from controller updates, and closes/hides the component in cleanup paths.
- `render-helpers.ts` — ANSI-safe, width-aware rendering utilities.
- `formatters.ts` — duration, token/count, path, checksum, artifact, safe-command, and workflow status formatting helpers.

## Snapshot source of truth

TUI snapshots must be derived from workflow-owned data:

1. durable `state.json` for authoritative phase, pending gate, and artifact references;
2. durable `events.jsonl` for append-only workflow events;
3. in-memory progress emitted by currently running workflow adapters or child processes.

A `WorkflowLiveSnapshot` is presentation data only. TUI code can render phase/reviewer progress and approval cards, but it cannot approve gates, mutate review decisions, advance workflow phases, change artifact refs, or write authoritative state.

Spec 8.1 is responsible for any future interactive runtime-gated decisions. Those controls must submit decision intent through runtime-owned validation paths; this Spec 8 foundation remains usable without interactivity.

## Non-TUI fallback

Every future TUI feature must have a readable markdown or plain text fallback for non-interactive execution. If terminal capability detection fails, snapshot data is stale/corrupt, or rendering cannot fit the current width, the runtime should degrade to concise status text instead of corrupting workflow state.

## Product boundary

TUI modules must use workflow-first terminology and must not inherit generic `pi-subagents` product concepts such as a public `subagent` command/tool, arbitrary `single`/`parallel`/`chain`/`async` orchestration, intercom, background async runners, or upstream builtin agent discovery.
