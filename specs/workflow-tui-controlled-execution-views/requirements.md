# Requirements Document: Workflow TUI Controlled Execution Views

## Introduction

Workflow TUI Controlled Execution Views adds read-only task-level execution rendering to Brainstorming Pro's snapshot-first TUI. It helps workflow users, implementation observers, maintainers, and security reviewers understand controlled spec execution progress, current task activity, checkpoint tasks, evidence/output links, checkbox update status, blockers, unauthorized `tasks.md` mutation warnings, execution reports, and terminal done state without turning the TUI into an execution authority.

The system is built around an optional runtime/status-owned execution summary, a presentation-only `ExecutionViewModelBuilder`, width-safe TUI renderers, deterministic fallback output, and strict mutation-boundary tests. Runtime and the controlled spec-exec adapter remain the source of truth for task parsing, task selection, single-task execution, evidence validation, checkbox writes, mutation detection, blockers, reports, workflow events, and state transitions. TUI code renders summaries and safe command hints only; it does not parse `tasks.md` for authority, select tasks, update checkboxes, validate evidence, retry or abort execution, launch child agents, or mutate workflow files.

## Glossary

- **Workflow Runtime**: The Brainstorming Pro runtime that owns workflow state, artifact refs, event logs, approval gates, controlled execution state, blockers, reports, and transitions.
- **Controlled SpecExec Adapter**: The runtime-owned execution adapter that parses approved `tasks.md`, selects one task at a time, invokes the single-task executor, validates output, updates checkboxes, detects unauthorized mutations, writes reports, and stops fail-closed on blockers.
- **WorkflowLiveSnapshot**: The read-only presentation object from Spec 8 that combines durable workflow state with foreground progress events for live rendering.
- **Execution Summary**: A runtime/status-owned display-safe summary of task runs, checkbox update status, blockers, mutation warnings, execution report metadata, and diagnostics.
- **ExecutionViewModel**: A TUI-owned read-only display model derived from `WorkflowLiveSnapshot` and optional execution summary data.
- **ExecutionViewModelBuilder**: The presentation adapter that converts snapshot and execution summary data into `ExecutionViewModel` instances without reading or writing workflow files.
- **Task Timeline**: The rendered list of execution tasks and checkpoints with display status such as pending, running, completed, skipped, blocked, or failed.
- **Current Task Card**: The expanded display section for the currently running or recently active task, including activity, paths, duration, and agent run metadata when available.
- **Checkpoint-as-task**: A checkpoint rendered as a validation task inside controlled execution, not as a user approval gate.
- **Checkbox Update Status**: Read-only display data describing whether the code-owned checkbox writer wrote, failed, skipped, or detected unauthorized mutation for a task.
- **Unauthorized Mutation Warning**: Runtime/adapter-reported evidence that `tasks.md` changed outside the allowed checkbox-only code-owned mutation path.
- **Deterministic Fallback**: Width-safe, non-TUI text rendering that preserves execution meaning in unsupported, non-interactive, narrow, or failed render contexts.

## Requirements

### Requirement 1: Runtime execution summary display contract

**User Story:** As a TUI implementer, I want runtime/status to expose display-safe execution summaries, so that TUI code can render controlled execution detail without scanning workflow files or inferring execution truth.

#### Acceptance Criteria

1. WHEN Spec 8.3 is implemented, THEN the system SHALL define a typed execution summary contract for topic, run id, generation timestamp, execution status, execution mode, task run summaries, checkbox update summaries, blockers, mutation warnings, execution report metadata, diagnostics, and safe command hints.
2. WHEN runtime/status provides execution summary data, THEN each summary SHALL carry relevant task ids, task titles, task kind, optional markers, requirement ids, status values, timestamps, agent run ids, output paths, evidence paths, validation command summaries, blocker details, mutation warning details, and report paths where available.
3. WHEN no controlled execution evidence exists for the current workflow state, THEN the summary contract SHALL represent the missing execution section explicitly or omit it safely without requiring TUI file-system discovery.
4. WHEN summary data is exposed to TUI code, THEN it SHALL NOT expose writer handles, mutation callbacks, task selection callbacks, evidence validation functions, child process launch functions, retry/abort/continue functions, artifact commit functions, or state transition helpers.
5. IF optional execution records, reports, or diagnostics are missing, stale, malformed, or unavailable, THEN runtime/status SHALL preserve that condition as display diagnostics rather than normalizing it into completed execution.
6. IF summary construction cannot load optional evidence, THEN runtime/status SHALL provide a diagnostic summary item without changing workflow state.

### Requirement 2: Execution view model builder

**User Story:** As a maintainer, I want a presentation-only builder to adapt snapshot and execution summary data into TUI models, so that rendering stays testable and does not duplicate controlled execution logic.

#### Acceptance Criteria

1. WHEN given a `WorkflowLiveSnapshot` and optional execution summary, THEN `ExecutionViewModelBuilder` SHALL produce an `ExecutionViewModel` containing topic, run id, phase, generated timestamp, execution status, optional mode, task summary counts, optional current task, task timeline, blockers, mutation warnings, execution report, diagnostics, and safe commands.
2. WHEN durable execution summary status and live task progress disagree, THEN the builder SHALL preserve runtime/status summary data as authoritative and use live `snapshot.tasks` only as presentation hints for running or absent summary sections.
3. WHEN no execution summary is supplied, THEN the builder SHALL still produce a snapshot-only model from `WorkflowLiveSnapshot.tasks` when task progress exists, or return undefined/diagnostic-only output according to the integration contract without throwing.
4. WHEN summary topic or run id differs from the snapshot, THEN the builder SHALL mark diagnostics as context mismatch and avoid presenting mismatched execution evidence as current.
5. WHEN task kind, optional marker, checkbox status, validation summary, blocker detail, mutation warning, or report metadata is missing, THEN the builder SHALL preserve available fields and mark missing fields as unknown or unavailable without reading `tasks.md`.
6. IF malformed or partially missing summary sections are encountered, THEN the builder SHALL omit only the malformed subsection, add diagnostics, and continue building safe remaining sections.

### Requirement 3: Task timeline and current task rendering

**User Story:** As a workflow user, I want to see the task timeline and current task clearly, so that I can understand what controlled execution is doing and what evidence has been produced.

#### Acceptance Criteria

1. WHEN execution task data exists, THEN the TUI SHALL render a task timeline with task id, title, task kind, status, and activity where available.
2. WHEN tasks are completed, running, pending, skipped optional, blocked, or failed, THEN the timeline SHALL distinguish those statuses with stable labels or glyphs.
3. WHEN one task is running or recently active, THEN expanded rendering SHALL include a current task card with id, title, kind, status, activity, timestamps or duration where available, agent run id, output path, and evidence path.
4. WHEN validation command summaries or evidence items are supplied, THEN the current task or task detail rendering SHALL display them as read-only text.
5. WHEN terminal width is narrow, THEN the renderer SHALL degrade to one task per line or concise summaries that preserve task id, status, and blocker/current-task meaning.
6. IF task progress exists only in `WorkflowLiveSnapshot.tasks`, THEN the renderer SHALL render snapshot-derived task progress without requiring execution summary data.
7. IF an unknown task status or kind appears, THEN the renderer SHALL render a safe unknown label and diagnostics instead of throwing or coercing it to completed/failed.

### Requirement 4: Checkpoint-as-task rendering

**User Story:** As a workflow user, I want checkpoint tasks shown as execution validation tasks, so that I do not confuse them with user approval gates.

#### Acceptance Criteria

1. WHEN a task is classified as a checkpoint, THEN the TUI SHALL render it as a checkpoint task within the execution timeline or checkpoint section.
2. WHEN checkpoint details are rendered, THEN the TUI SHALL state or imply that the checkpoint is an execution task and not a user approval gate.
3. WHEN checkpoint evidence, validation commands, output paths, or blocker details are supplied, THEN the TUI SHALL display those fields as read-only execution facts.
4. WHEN checkpoint status is pending, running, completed, blocked, or failed, THEN the renderer SHALL preserve that status without converting it to approval readiness.
5. IF checkpoint kind cannot be determined, THEN the renderer SHALL not infer approval-gate semantics from task title text alone.

### Requirement 5: Checkbox update and mutation warning rendering

**User Story:** As a security reviewer, I want checkbox updates and unauthorized `tasks.md` mutations displayed as runtime-owned facts, so that users can diagnose progress without letting TUI mutate the approved plan.

#### Acceptance Criteria

1. WHEN checkbox update status is supplied for a task, THEN the TUI SHALL render expected checkbox state, observed checkbox state when available, and update status such as pending, written, failed, not-needed, or unauthorized-mutation-detected.
2. WHEN checkbox update status is absent, THEN the TUI SHALL omit it or render it as unavailable without inspecting `tasks.md`.
3. WHEN runtime/adapter reports unauthorized `tasks.md` mutation, THEN the TUI SHALL display a mutation warning with reported message, affected path or task ids, severity, and safe command hints where supplied.
4. WHEN mutation warning details are rendered, THEN the TUI SHALL state that execution stopped or remains fail-closed when that status is supplied by runtime/adapter.
5. WHEN rendering checkbox or mutation information, THEN TUI modules SHALL NOT write `tasks.md`, diff `tasks.md`, update checkbox markers, or call mutation guard writer APIs.
6. IF mutation warning data is malformed, THEN the TUI SHALL render a diagnostic and continue rendering other execution sections safely.

### Requirement 6: Blocked, failed, report, and done rendering

**User Story:** As a workflow user, I want blockers, failures, execution reports, and completed workflow state shown clearly, so that I know what happened and which safe next command to use.

#### Acceptance Criteria

1. WHEN execution is blocked, THEN the TUI SHALL render blocked task id/title, blocker type, risk, attempted actions, options, needed user input, and safe command hints when supplied.
2. WHEN execution has failed, THEN the TUI SHALL render failure diagnostics and safe command hints without implying that execution can continue from the TUI.
3. WHEN blockers or failures are rendered, THEN the TUI SHALL NOT expose retry, abort, continue, skip, resolve, or mark-complete controls.
4. WHEN an execution report exists, THEN the TUI SHALL render report status, mode, completed task count, remaining task count, skipped optional task count, changed files count, validation command summary, blocker count, summary text, and report paths where available.
5. WHEN workflow is `done` after controlled execution, THEN the TUI SHALL render a terminal done card that includes execution completion and report path when available.
6. WHEN report metadata is unavailable in a `done` or post-execution state, THEN the TUI SHALL display report unavailable diagnostics without marking the workflow failed.
7. IF blocked/failure/report data is malformed, THEN the renderer SHALL omit malformed fields, render diagnostics, and continue rendering safe remaining sections.

### Requirement 7: Widget integration and deterministic fallback rendering

**User Story:** As a terminal user, I want execution details integrated into expanded TUI and fallback output, so that execution progress remains understandable across terminal capabilities.

#### Acceptance Criteria

1. WHEN `WorkflowLiveWidget` is configured with an execution view model provider, THEN expanded rendering SHALL include an Execution section built from the returned view model.
2. WHEN no execution provider is configured, THEN existing Spec 8, Spec 8.1, and Spec 8.2 widget behavior SHALL remain unchanged.
3. WHEN execution rendering is unavailable, unsupported, or fails, THEN the system SHALL fall back to deterministic text output without changing workflow state.
4. WHEN fallback rendering is used, THEN it SHALL include concise execution status, mode, task counts, current task, blocker/failure summary, mutation warning summary, execution report path, diagnostics, and safe next-action hints when available.
5. WHEN terminal width is narrow, THEN both TUI and fallback renderers SHALL truncate or summarize lines using existing width-aware helpers and SHALL preserve critical warning wording.
6. WHEN compact mode is used, THEN the implementation MAY remain summary-only, but expanded mode and fallback SHALL remain available for execution detail.
7. WHEN rendering safe next actions, THEN the TUI SHALL prefer `/brainstorm-pro --resume` and `/brainstorm-pro --status` hints and SHALL NOT invent new public command surfaces.

### Requirement 8: Fail-soft diagnostics and resilience

**User Story:** As a workflow user, I want missing or inconsistent execution detail to degrade safely, so that UI issues do not corrupt or fail the workflow.

#### Acceptance Criteria

1. WHEN execution summary is missing but task progress exists, THEN the TUI SHALL render snapshot task progress and diagnostics explaining that richer execution detail is unavailable.
2. WHEN execution summary is missing and no task progress exists, THEN the TUI SHALL omit execution detail or render an unavailable diagnostic without throwing.
3. WHEN provider exceptions occur, THEN the widget SHALL render an execution-details-unavailable diagnostic and continue rendering other sections.
4. WHEN renderer exceptions occur, THEN the TUI SHALL use existing fail-soft fallback behavior and SHALL NOT mark the workflow failed solely due to UI rendering failure.
5. WHEN snapshot is stale, THEN the TUI SHALL render stale snapshot warning and SHALL NOT use stale display data to submit or imply execution decisions.
6. WHEN summary/snapshot topic or run id mismatch is detected, THEN the TUI SHALL render context mismatch diagnostics and avoid presenting mismatched evidence as current.
7. WHEN unknown statuses, missing paths, malformed optional fields, or unsupported values appear, THEN the TUI SHALL render safe unknown/unavailable labels and diagnostics instead of throwing.

### Requirement 9: Runtime authority and TUI boundary enforcement

**User Story:** As a security reviewer, I want execution TUI code to remain read-only, so that it cannot mutate tasks, validate evidence, launch agents, or advance workflow execution.

#### Acceptance Criteria

1. WHEN Spec 8.3 TUI modules are implemented, THEN they SHALL NOT import execution loop controllers, task selectors, task plan parsers for authority, checkbox writers, mutation guard writer APIs, evidence validators, state transition helpers, artifact commit helpers, approval/decision writers, or child process launch/run-agent APIs.
2. WHEN execution views render blocked or failed context, THEN they SHALL NOT submit retry, abort, continue, skip, resolve, mark-complete, approval, or state transition decisions.
3. WHEN checkpoint tasks are rendered, THEN TUI execution modules SHALL NOT expose approval-gate controls or approval wording for checkpoints.
4. WHEN workflow files are inspected during tests, THEN Spec 8.3 TUI rendering SHALL NOT write `.workflow/*`, `design.md`, `requirements.md`, or `tasks.md`.
5. WHEN implementing Spec 8.3, THEN the package SHALL NOT expose generic subagent orchestration, background runner, intercom, arbitrary chains, arbitrary task runner controls, or builtin agent discovery.
6. IF new code is derived from `nicobailon/pi-subagents`, THEN reuse inventory and attribution SHALL be updated according to repository policy.
