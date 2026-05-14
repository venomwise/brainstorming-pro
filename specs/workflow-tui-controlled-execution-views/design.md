# Workflow TUI Controlled Execution Views Design

## Summary

Spec 8.3 adds **Workflow TUI Controlled Execution Views** for Brainstorming Pro. It introduces a read-only execution view-model and expanded/fallback TUI renderers that make controlled spec execution understandable at task level: task timeline, current task, checkpoint-as-task display, task executor activity, evidence/output links, checkbox update status, blocked task diagnostics, unauthorized `tasks.md` mutation warnings, execution report summary, and done terminal card. The views consume runtime-owned `WorkflowLiveSnapshot`, task progress events, and execution summaries, but they do not parse tasks for execution authority, select tasks, update checkboxes, validate evidence, retry/abort execution, or advance workflow state.

## Goals

- Provide clear task-level visualization for `executing`, `blocked`, `failed`, and post-execution `done` workflow states.
- Show controlled execution progress using the existing Spec 8 snapshot-first live progress foundation.
- Make the code-owned execution discipline visible to users: code owns task selection, LLM executes one current task, code owns checkbox writes, checkpoints are tasks, and blockers stop execution fail-closed.
- Render current task details including id, title, kind, status, activity, duration, agent run id, output path, and evidence path when available.
- Render a task timeline that distinguishes pending/running/completed/skipped optional/blocked/failed/checkpoint tasks.
- Display checkbox update status as a read-only execution fact.
- Display blocked task diagnostics, unauthorized `tasks.md` mutation warnings, execution report summaries, and terminal done cards.
- Provide deterministic non-TUI fallback output for execution progress and diagnostics.
- Preserve Spec 8 live rendering, Spec 8.1 runtime-gated decisions, and Spec 8.2 review panel views without changing workflow authority.

## Primary Users / Roles

- **Workflow user**: wants to understand what the approved plan executor is doing, which task is current, what evidence was produced, and why execution stopped if blocked.
- **Brainstorming Pro maintainer**: needs a testable presentation layer that explains controlled execution without coupling TUI code to execution authority.
- **Implementation agent observer**: needs task progress and evidence paths displayed while the child executor runs, without being allowed to choose or complete tasks through UI state.
- **Security / reliability reviewer**: needs proof that task execution controls, checkbox writes, evidence validation, and lifecycle transitions remain runtime/adapter-owned.
- **Future TUI implementer**: needs a stable execution detail view that can coexist with interactive gate controls and review panel views.

## Non-Goals

- Do not implement a task parser, execution loop, task selector, checkbox writer, mutation detector, or evidence validator.
- Do not update `tasks.md`, `requirements.md`, `design.md`, `.workflow/*`, review ledgers, approvals, decisions, or runtime state.
- Do not retry, abort, continue, skip, resolve, or otherwise control blocked execution from Spec 8.3 views.
- Do not launch child Pi processes or expose a task runner UI.
- Do not add a public command surface or generic subagent UI.
- Do not implement background async dashboards, detached execution monitors, intercom, arbitrary chains, or generic orchestration modes.
- Do not add an execution review panel or automatic post-execution fix loop.
- Do not render checkpoint tasks as approval gates.
- Do not infer execution truth by re-parsing `tasks.md` or validating evidence in TUI code.

## Context

Brainstorming Pro follows a runtime-first workflow architecture. `/brainstorm-pro` is the public workflow intent interface; runtime owns phases, artifact refs, event logs, review decisions, approval gates, planning, controlled execution, blockers, and done transitions. Spec 8 added `WorkflowLiveSnapshot`, workflow progress events, compact/expanded live rendering, and fallback output. Spec 8.1 added runtime-gated interactive gate decisions. Spec 8.2 added read-only review panel detail views.

Controlled execution is owned by `controlled-spec-exec-adapter`. That adapter parses the approved `tasks.md`, selects one executable task at a time, invokes a single-task executor, validates structured output, updates checkboxes through code-owned writers, records task progress/events, detects unauthorized `tasks.md` mutation, writes execution reports, and stops fail-closed on blockers. Spec 8.3 must show these facts without duplicating or weakening those controls.

Existing useful contracts include:

- `WorkflowLiveSnapshot` and `TaskProgressSnapshot` in `extensions/clarification-orchestrator/workflow/progress-types.ts`.
- `ExecutionTaskProgressEvent` for live task progress.
- `TaskRunRecord`, `ExecutionBlocker`, and `ExecutionReportOutput` from the controlled spec-exec adapter schemas.
- The existing `WorkflowLiveWidget` expanded renderer and optional provider pattern already used for review panel views.

## Discovery

### Key Discoveries

- The core value of Spec 8.3 is observability, not control. Users need to see exactly which approved task is running and what evidence/blocker was produced, but the UI must not become another execution authority.
- `WorkflowLiveSnapshot.tasks` is enough for a basic timeline, but richer execution views need optional runtime/status-provided summaries for checkbox write status, task run records, blocker details, mutation warnings, and execution report summaries.
- Expanding `WorkflowLiveSnapshot` into a large execution-specific contract would make the Spec 8 foundation too coupled to controlled execution. A provider-based execution view-model keeps the foundation stable.
- Checkpoints are easy to misread as user approval gates. The TUI must explicitly render them as execution tasks.
- Blocked execution is a high-risk area: showing retry/continue-like controls before runtime owns such decisions would undermine fail-closed behavior.
- Unauthorized `tasks.md` mutation warnings should be displayed only when runtime/adapter reports them; TUI code must not perform file diffing or mutation checks itself.

### Scope Decisions

- Include a read-only `ExecutionViewModel` built from `WorkflowLiveSnapshot` plus optional runtime-provided execution summaries.
- Include expanded TUI renderers for execution summary, task timeline, current task, checkpoints, blockers, mutation warnings, execution report, and done card.
- Include deterministic fallback rendering for non-TUI or failed-TUI environments.
- Exclude all execution authority: parsing, selection, checkbox mutation, evidence validation, child process launch, retry/abort/continue, and state transitions.
- Prefer provider integration with `WorkflowLiveWidget` instead of hard-coding execution logic into the generic snapshot renderer.
- Treat missing optional execution summaries as degraded display, not workflow failure.

## Proposed Solution

Spec 8.3 adds a presentation adapter for controlled execution. The adapter builds a typed `ExecutionViewModel` from the current `WorkflowLiveSnapshot` and, when available, runtime/status-owned execution summary data. The expanded workflow widget receives an optional `getExecutionViewModel(snapshot)` provider. If the provider returns a model, the widget renders an "Execution" section using dedicated execution renderers. If the provider is absent, returns undefined, or throws, existing Spec 8/8.1/8.2 behavior remains intact and fallback text points users to `/brainstorm-pro --status` or `/brainstorm-pro --resume`.

The model is intentionally descriptive. It can carry task status, output/evidence paths, checkbox write status, blocker details, mutation warnings, execution report metadata, and safe command hints. It cannot carry executable callbacks or mutable handles.

### Architecture

```text
Controlled SpecExec Adapter / Runtime
  owns task parsing, task selection, single-task execution, validation,
  checkbox writes, mutation detection, blockers, reports, state transitions
        ↓
Workflow progress events + durable runtime/status summaries
        ↓
WorkflowLiveSnapshot + optional ExecutionSummary
        ↓
ExecutionViewModelBuilder
        ↓
TUI execution renderers / fallback renderer
        ↓
User observes progress and diagnostics
```

Authority boundary:

```text
Runtime / adapter creates execution facts.
Spec 8.3 renders execution facts.
Spec 8.3 never creates, mutates, validates, or advances execution facts.
```

### Components

#### 1. `ExecutionViewModel`

Suggested file:

```text
extensions/clarification-orchestrator/tui/execution-view-model.ts
```

Representative shape:

```ts
export type ExecutionViewModel = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  generatedAt: string;
  status: "not-started" | "running" | "blocked" | "failed" | "completed";
  mode?: "mvp" | "full";
  summary: ExecutionSummaryView;
  currentTask?: ExecutionTaskView;
  taskTimeline: ExecutionTaskView[];
  blockers: ExecutionBlockerView[];
  mutationWarnings: ExecutionMutationWarningView[];
  executionReport?: ExecutionReportView;
  diagnostics: ExecutionDiagnosticView[];
  safeCommands: string[];
};
```

The view-model should include only serializable display data. It must not include writer functions, task selection callbacks, runtime transition callbacks, child process handles, or mutable file handles.

#### 2. `ExecutionTaskView`

Represents a display-only task row/card:

```ts
export type ExecutionTaskView = {
  taskId: string;
  title: string;
  kind: "task" | "checkpoint" | "phase" | "unknown";
  status: "pending" | "running" | "completed" | "skipped" | "blocked" | "failed";
  optional?: boolean;
  requirementIds: string[];
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  activity?: string;
  agentRunId?: string;
  outputPath?: string;
  evidencePath?: string;
  checkbox?: {
    expected: "unchecked" | "checked";
    observed?: "unchecked" | "checked" | "unknown";
    updateStatus?: "not-needed" | "pending" | "written" | "failed" | "unauthorized-mutation-detected";
  };
  validation?: {
    commands: Array<{
      command: string;
      status: "passed" | "failed" | "not-run";
      summary: string;
    }>;
    evidence: string[];
  };
};
```

Task kind and optional metadata should come from runtime/status summaries when available. The TUI builder may classify unknown tasks as `unknown`, but it must not re-parse `tasks.md` to become authoritative.

#### 3. Execution summary provider

Suggested widget option:

```ts
getExecutionViewModel?: (snapshot: WorkflowLiveSnapshot) => ExecutionViewModel | undefined;
```

This mirrors the Spec 8.2 review panel provider pattern. The provider can be wired by command/session/status code that already has runtime-owned summary data. Rendering code remains isolated from workflow mutation modules.

#### 4. Execution renderers

Suggested files:

```text
extensions/clarification-orchestrator/tui/execution/index.ts
extensions/clarification-orchestrator/tui/execution/execution-summary-view.ts
extensions/clarification-orchestrator/tui/execution/task-timeline-view.ts
extensions/clarification-orchestrator/tui/execution/current-task-view.ts
extensions/clarification-orchestrator/tui/execution/checkpoint-view.ts
extensions/clarification-orchestrator/tui/execution/blocker-view.ts
extensions/clarification-orchestrator/tui/execution/mutation-warning-view.ts
extensions/clarification-orchestrator/tui/execution/execution-report-view.ts
```

Renderer responsibilities:

- Keep compact output low-noise.
- Render expanded execution details when available.
- Fit/truncate lines using existing width helpers.
- Render paths and safe commands as text only.
- Render checkpoints as execution tasks, never as approval gates.
- Render missing data as "unavailable" or "unknown" rather than inferring state.

#### 5. Fallback renderer

Suggested file:

```text
extensions/clarification-orchestrator/tui/execution-fallback.ts
```

Fallback output should include:

- execution status and mode;
- task counts;
- current task;
- blocked task summary when present;
- mutation warning summary when present;
- execution report path when present;
- safe next commands.

#### 6. `WorkflowLiveWidget` integration

`WorkflowLiveWidgetOptions` gains an optional execution provider. In expanded mode, after the current generic snapshot sections and alongside review panel details, the widget renders execution details when available. Provider failure is caught and rendered fail-soft:

```text
Execution details unavailable: <message>
Use /brainstorm-pro --status or /brainstorm-pro --resume.
```

Compact mode remains mostly unchanged, except it may continue to show aggregate task counts already available from `snapshot.tasks`.

### Data Flow

Primary live path:

1. Runtime enters `executing` only after plan approval gate passes.
2. Controlled spec-exec adapter selects the next task and emits `task.progress` events.
3. Agent execution runtime emits agent progress for the single-task executor.
4. Adapter validates structured task output.
5. Adapter records task run facts, checkbox writer result, blocker/mutation diagnostics, and execution report facts through runtime-owned paths.
6. Progress controller builds/updates `WorkflowLiveSnapshot`.
7. Runtime/status layer optionally provides an execution summary for richer display.
8. `ExecutionViewModelBuilder` merges snapshot task progress with summary facts.
9. Expanded TUI renders task timeline, current task, checkpoint, blocker, warning, report, and done views.
10. If TUI is unavailable or fails, fallback text renders the same display-only facts.

Blocked path:

1. Current task returns `blocked`, `failed`, malformed output, validation failure, missing dependency, or mutation warning.
2. Controlled execution stops fail-closed and records blocker/report diagnostics.
3. Spec 8.3 renders the blocked task and safe command hints.
4. Any recovery remains outside Spec 8.3 and must go through runtime-owned resume/decision validation.

Done path:

1. Required tasks/checkpoints are complete and no blocker remains.
2. Runtime records execution report and transitions to `done`.
3. Spec 8.3 renders execution report summary and done terminal card.

## Error Handling

- **Execution provider absent**: render no execution detail section; existing widget behavior remains unchanged.
- **Execution provider throws**: catch the error, render an "Execution details unavailable" diagnostic, and continue rendering the rest of the widget.
- **Missing optional execution report**: show report as unavailable; do not infer workflow failure.
- **Stale snapshot**: render the snapshot stale warning and note that runtime reloads authoritative state on resume.
- **Unknown task status/kind**: render `unknown` rather than coercing to completed/failed.
- **Narrow terminal**: degrade to counts, current task id/title, blocker summary, and safe commands.
- **Malformed optional summary**: reject it at provider/builder boundary and fail soft to snapshot-only task timeline.
- **Mutation warning present**: display the warning exactly as runtime/adapter reports it; do not inspect files in renderer code.
- **Renderer failure**: never affect workflow state, events, artifacts, checkboxes, or reports.

## Testing

### Unit tests

Add tests under `tests/unit/tui/` for:

- building an execution view-model from a snapshot with running task progress;
- merging optional execution summary data into task views;
- rendering current task card with output/evidence paths;
- rendering checkpoint tasks as checkpoint-as-task, not as approval gates;
- rendering blocked task diagnostics with blocker type, risk, attempts, and needed user input;
- rendering unauthorized mutation warnings;
- rendering execution report summary and done terminal card;
- rendering fallback text for running, blocked, failed, and done execution states;
- handling missing provider, provider exceptions, stale snapshots, unknown statuses, and narrow widths.

### Widget integration tests

Add tests that instantiate `WorkflowLiveWidget` with and without `getExecutionViewModel` and assert:

- existing Spec 8 behavior remains unchanged when provider is absent;
- review panel and interactive decision sections still render when configured;
- execution section appears only in expanded mode or documented execution-detail rendering mode;
- provider errors are contained to execution detail output.

### Security tests

Add tests under `tests/security/` or existing import-boundary suites to assert Spec 8.3 TUI modules do not import:

- `workflow/adapters/spec-exec/execution-loop.ts`;
- `workflow/adapters/spec-exec/checkbox-writer.ts`;
- task selection or parser modules for authority;
- mutation guard writer APIs;
- state transition helpers;
- artifact commit helpers;
- approval/decision writers;
- child process launch/run-agent APIs.

Also assert rendering does not write `.workflow/*`, `tasks.md`, `requirements.md`, or `design.md`, and does not expose generic subagent orchestration, arbitrary `single`/`parallel`/`chain`/`async` controls, intercom, or background runner behavior.

### Documentation alignment tests

If README, roadmap, or TUI docs are updated, extend docs tests to mention:

- Spec 8.3 is execution visualization only;
- controlled execution authority remains runtime/adapter-owned;
- checkpoint tasks are not approval gates;
- `/brainstorm-pro --status` and `/brainstorm-pro --resume` remain deterministic fallbacks.

## Open Questions

1. **Where should rich execution summaries be produced?** Recommended: runtime/status layer should expose a read-only summary derived from adapter-owned records and execution report, rather than letting TUI modules read and interpret workflow files directly.
2. **Should `WorkflowLiveSnapshot` gain additional task fields?** Recommended: keep the base snapshot minimal and use the optional execution provider for richer details unless multiple future specs need the same fields.
3. **Should blocked execution get future interactive retry/abort controls?** Not in Spec 8.3. If needed later, add a separate runtime-owned decision facade and controls spec.
4. **How much validation command detail should be shown in compact mode?** Recommended: compact mode shows only counts/status; expanded/fallback can show command summaries.
5. **Should skipped optional tasks appear in the generic task timeline?** Recommended: yes when runtime/status summary provides them, but do not infer skipped optional tasks from unchecked boxes in TUI code.
