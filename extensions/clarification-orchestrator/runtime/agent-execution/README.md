# Agent Execution Runtime Scaffold

This directory is reserved for future Brainstorming Pro foreground child execution infrastructure adapted from the approved `pi-subagents` reuse inventory. It does **not** yet implement foreground child execution, background execution, generic delegation, or public orchestration APIs.

## Planned files

- `launch-spec.ts` — future Brainstorming Pro launch description for workflow-owned `AgentRun` and `ReviewerRun` processes.
- `spawn.ts` — future subprocess launcher for foreground Pi child execution.
- `output.ts` — future bounded output capture, truncation, and artifact handoff helpers.
- `progress.ts` — future progress event adapter that reports child execution status to workflow runtime snapshots.

## Safety defaults required for future implementation

Any implementation in this directory must preserve Brainstorming Pro workflow-first safety defaults:

- `PI_COMMAND` is a single executable path override; do not parse it through a shell or split it into command fragments.
- Model selection must keep provider-qualified model validation before spawning a child process.
- Child Pi invocations must use `--no-session` so execution cannot implicitly attach to parent sessions.
- Child Pi invocations must use `--no-skills` unless a future spec explicitly grants a narrow exception.
- Child environment must include a Brainstorming Pro child marker so extension registration can prevent recursive child command exposure.
- A depth guard must prevent unbounded nested child execution.
- Child command registration prevention must ensure the workflow command surface remains parent-owned.

## Product boundary

This scaffold is for workflow-owned execution only. It must not expose generic `single`, `parallel`, `chain`, or `async` orchestration modes, a public `subagent` command/tool, an intercom runtime, or a background async runner. Review concurrency, if introduced by a future spec, must be driven only by workflow-defined review panels and approval gates.
