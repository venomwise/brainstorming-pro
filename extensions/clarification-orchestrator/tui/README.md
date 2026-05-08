# Workflow TUI Scaffold

This directory is reserved for future Brainstorming Pro read-only workflow TUI and status formatting infrastructure adapted from the approved `pi-subagents` reuse inventory. It does not yet implement an interactive TUI.

## Planned files

- `workflow-widget.ts` — future renderer for workflow phase, reviewer progress, artifact refs, and approval cards.
- `workflow-result.ts` — future markdown/plain text result formatter for non-interactive status output.
- `render-helpers.ts` — future ANSI-safe, width-aware rendering utilities.
- `formatters.ts` — future duration, token/count, path, and workflow status formatting helpers.

## Snapshot source of truth

TUI snapshots must be derived from workflow-owned data:

1. durable `state.json` for authoritative phase, pending gate, and artifact references;
2. durable `events.jsonl` for append-only workflow events;
3. in-memory progress emitted by currently running workflow adapters or child processes.

A `WorkflowLiveSnapshot` is presentation data only. TUI code can render phase/reviewer progress and approval cards, but it cannot approve gates, mutate review decisions, advance workflow phases, change artifact refs, or write authoritative state.

## Non-TUI fallback

Every future TUI feature must have a readable markdown or plain text fallback for non-interactive execution. If terminal capability detection fails, snapshot data is stale/corrupt, or rendering cannot fit the current width, the runtime should degrade to concise status text instead of corrupting workflow state.

## Product boundary

TUI modules must use workflow-first terminology and must not inherit generic `pi-subagents` product concepts such as a public `subagent` command/tool, arbitrary `single`/`parallel`/`chain`/`async` orchestration, intercom, background async runners, or upstream builtin agent discovery.
