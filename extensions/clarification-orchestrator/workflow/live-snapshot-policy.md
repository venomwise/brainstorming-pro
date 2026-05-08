# Workflow Live Snapshot Policy

Future Brainstorming Pro live progress UI must treat workflow live snapshots as read-only presentation data derived from runtime-owned sources. A snapshot is never the authoritative workflow state.

## Allowed data flow

```text
workflow runtime/adapters
  -> durable state.json
  -> durable events.jsonl
  -> in-memory progress events
  -> WorkflowLiveSnapshot
  -> TUI renderer or markdown/plain text fallback
```

The runtime and workflow gates remain the only authority for phase transitions, artifact refs, review decisions, and approvals. TUI rendering may display current phase, reviewer progress, blocked/failed status, pending approval cards, and latest artifact refs, but it must not call gate approval helpers, transition the state machine, or mutate review decisions.

## Failure isolation

Snapshot creation and rendering must fail soft:

- invalid or stale live snapshot data must not overwrite `state.json`;
- rendering errors must not corrupt `events.jsonl` or workflow artifacts;
- snapshot corruption should degrade to markdown/plain text status output;
- non-interactive execution should skip TUI rendering and emit readable status text;
- any mismatch between snapshot data and durable state must prefer durable state.

## Product boundary

Live snapshots use workflow-first terminology such as `WorkflowLiveSnapshot`, `WorkflowProgress`, `AgentRun`, and `ReviewerRun`. They must not expose generic `pi-subagents` orchestration modes, background async jobs, intercom, or builtin agent discovery. Future specs for workflow TUI or agent execution runtime must reference the reuse inventory and this policy before adapting upstream infrastructure.
