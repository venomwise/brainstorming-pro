# Implementation Plan: Workflow TUI Controlled Execution Views

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is organized into seven phases. The first phases define the runtime/status execution summary contract and TUI view-model builder because all controlled execution rendering depends on typed, read-only presentation data. Middle phases add task timeline, current task, checkpoint, checkbox, mutation warning, blocker, report, done, fallback, and widget integration renderers. Final phases add resilience, security boundary tests, documentation, and validation. All implementation uses TypeScript ES modules under `extensions/clarification-orchestrator/`, keeps TUI execution modules presentation-only, and preserves runtime/adapter authority for task parsing, task selection, evidence validation, checkbox writes, mutation detection, blockers, reports, events, artifacts, and workflow state.

## Tasks

- [✅] 1. Phase 1: Define runtime/status execution summary contract
  - [✅] 1.1 Create execution summary types
    - Create `extensions/clarification-orchestrator/workflow/execution-summary.ts` with `WorkflowExecutionSummary`, `ExecutionTaskSummary`, `ExecutionCheckboxSummary`, `ExecutionMutationWarningSummary`, `ExecutionReportSummary`, `ExecutionSummaryDiagnostic`, `ExecutionSafeCommandHint`, and display-safe blocker/validation summary types
    - Include topic, run id, generated timestamp, execution status, execution mode, task ids, titles, kinds, optional markers, requirement ids, status values, timestamps, agent run ids, output paths, evidence paths, validation command summaries, blocker details, mutation warning details, report paths, diagnostics, and safe command hints where available
    - Keep the module type-focused and free of TUI rendering dependencies
    - _Requirements: 1.1, 1.2, 1.4_
  - [✅] 1.2 Add safe summary construction helpers
    - Implement pure helpers in `workflow/execution-summary.ts` such as `createEmptyWorkflowExecutionSummary()`, `normalizeExecutionSummaryDiagnostic()`, `summarizeExecutionReportOutput()`, and path/status formatting helpers needed by status code
    - Represent absent execution data explicitly through omitted optional fields and diagnostics rather than TUI file discovery
    - Preserve missing, stale, malformed, or unavailable execution records and reports as diagnostics rather than normalizing them into completed execution
    - _Requirements: 1.3, 1.5, 1.6_
  - [✅] 1.3 Integrate execution summary as an optional runtime/status surface
    - Extend `extensions/clarification-orchestrator/workflow/runtime.ts` status result types or a narrow adjacent status helper to optionally expose `WorkflowExecutionSummary`
    - Populate at least safe empty summaries and diagnostics for states without execution detail, without changing workflow phase, decision, approval, or execution semantics
    - Ensure exposed summaries contain no writer handles, mutation callbacks, task selection callbacks, evidence validation functions, child process launch functions, retry/abort/continue functions, artifact commit functions, or state transition helpers
    - _Requirements: 1.1, 1.3, 1.4, 9.1_
  - [✅]* 1.4 Write unit tests for execution summary contract shape
    - Create `tests/unit/workflow-execution-summary.test.ts`
    - Test empty summary construction, diagnostic preservation, execution report summarization, task/checkbox/mutation warning summary shape, malformed optional evidence diagnostics, and absence of mutation-like fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [✅] 2. Phase 2: Implement ExecutionViewModelBuilder
  - [✅] 2.1 Create TUI execution view model module
    - Create `extensions/clarification-orchestrator/tui/execution-view-model.ts`
    - Define `ExecutionViewModel`, `ExecutionTaskView`, `ExecutionSummaryView`, `ExecutionBlockerView`, `ExecutionMutationWarningView`, `ExecutionReportView`, `ExecutionDiagnosticView`, and related display model types
    - Import only read-only types from `workflow/progress-types.ts`, `workflow/execution-summary.ts`, and `workflow/types.ts`
    - _Requirements: 2.1, 9.1_
  - [✅] 2.2 Implement `buildExecutionViewModel()`
    - Implement `buildExecutionViewModel(input)` that accepts `WorkflowLiveSnapshot` and optional `WorkflowExecutionSummary`
    - Preserve topic, run id, phase, generated timestamp, execution status, optional mode, task counts, optional current task, timeline, blockers, mutation warnings, execution report, diagnostics, and safe commands
    - Return snapshot-only execution output when no summary is supplied but `snapshot.tasks` exists, and avoid throwing when neither summary nor task progress exists
    - _Requirements: 2.1, 2.3, 8.1, 8.2_
  - [✅] 2.3 Enforce runtime/status summary precedence over live progress
    - In the builder, preserve runtime/status summary status for execution status, task state, checkbox status, blocker state, mutation warning state, and report state when live `snapshot.tasks` disagrees
    - Use live task progress only as presentation hints for running or absent summary data
    - Add diagnostics for summary/snapshot topic or run id mismatch and avoid presenting mismatched evidence as current
    - _Requirements: 2.2, 2.4, 8.5, 8.6_
  - [✅] 2.4 Preserve partial data without file-system inference
    - In the builder, preserve available task kind, optional marker, checkbox status, validation summary, blocker detail, mutation warning, and report metadata while marking missing fields as unknown or unavailable
    - Do not read, parse, or diff `tasks.md` from the builder
    - Omit malformed subsections while continuing to build valid sections and diagnostics
    - _Requirements: 2.5, 2.6, 5.2, 5.5, 8.7_
  - [✅]* 2.5 Write unit tests for execution view model building
    - Create `tests/unit/workflow-tui-execution-view-model.test.ts`
    - Test normal summary mapping, snapshot-only task mapping, no-data handling, durable summary precedence over live task progress, topic/run mismatch handling, missing checkbox/validation/report diagnostics, malformed subsection omission, and no `tasks.md` file access
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.2, 8.6, 8.7_

- [✅] 3. Phase 3: Add task timeline, current task, and checkpoint renderers
  - [✅] 3.1 Create execution renderer entrypoint
    - Create `extensions/clarification-orchestrator/tui/execution/index.ts` with `renderExecutionView(viewModel, width)`
    - Compose execution summary, current task, task timeline, checkpoint, checkbox/mutation, blocker/report/done, diagnostics, and safe next-action sections while omitting absent sections safely
    - Use existing `extensions/clarification-orchestrator/tui/render-helpers.ts` and `formatters.ts` for width-safe output
    - _Requirements: 3.1, 7.5, 8.7_
  - [✅] 3.2 Implement task timeline rendering
    - Create `extensions/clarification-orchestrator/tui/execution/task-timeline-view.ts`
    - Render task id, title, kind, status, optional/skipped marker, activity, and concise evidence/output path hints where available
    - Distinguish pending, running, completed, skipped optional, blocked, and failed statuses with stable labels or glyphs and use one-task-per-line output on narrow widths
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 3.7_
  - [✅] 3.3 Implement current task card rendering
    - Create `extensions/clarification-orchestrator/tui/execution/current-task-view.ts`
    - Render the current task id, title, kind, status, activity, timestamps or duration, agent run id, output path, evidence path, validation command summaries, and evidence items when supplied
    - Render all paths and validation details as read-only text
    - _Requirements: 3.3, 3.4, 7.5_
  - [✅] 3.4 Implement checkpoint-as-task rendering
    - Create `extensions/clarification-orchestrator/tui/execution/checkpoint-view.ts`
    - Render checkpoint tasks as execution validation tasks inside the execution section, preserving pending/running/completed/blocked/failed status
    - Include required wording that checkpoints are execution tasks and not user approval gates
    - Do not infer checkpoint approval semantics from title text alone when kind is unknown
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 9.3_
  - [✅]* 3.5 Write unit tests for task timeline, current task, and checkpoint rendering
    - Create `tests/unit/workflow-tui-execution-views.test.ts`
    - Test task timeline status labels, skipped optional rendering, snapshot-only task rendering, current task card paths/validation details, narrow width summaries, unknown status/kind diagnostics, checkpoint-as-task wording, and absence of approval-gate wording for checkpoints
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.4, 4.5, 9.3_

- [✅] 4. Phase 4: Add checkbox, mutation warning, blocker, report, and done renderers
  - [✅] 4.1 Implement checkbox update rendering
    - Create `extensions/clarification-orchestrator/tui/execution/checkbox-view.ts`
    - Render expected checkbox state, observed checkbox state, and update status such as pending, written, failed, not-needed, or unauthorized-mutation-detected when supplied
    - Render absent checkbox status as omitted or unavailable without reading `tasks.md`
    - _Requirements: 5.1, 5.2, 5.5_
  - [✅] 4.2 Implement mutation warning rendering
    - Create `extensions/clarification-orchestrator/tui/execution/mutation-warning-view.ts`
    - Render runtime/adapter-reported unauthorized `tasks.md` mutation warning message, affected path or task ids, severity, fail-closed wording when supplied, diagnostics, and safe command hints
    - Continue rendering safe remaining execution sections when mutation warning data is malformed
    - _Requirements: 5.3, 5.4, 5.5, 5.6_
  - [✅] 4.3 Implement blocker and failure rendering
    - Create `extensions/clarification-orchestrator/tui/execution/blocker-view.ts`
    - Render blocked task id/title, blocker type, risk, attempted actions, options, needed user input, failure diagnostics, and safe command hints when supplied
    - Ensure output does not expose retry, abort, continue, skip, resolve, or mark-complete controls
    - _Requirements: 6.1, 6.2, 6.3, 7.7, 9.2_
  - [✅] 4.4 Implement execution report and done rendering
    - Create `extensions/clarification-orchestrator/tui/execution/execution-report-view.ts`
    - Render report status, mode, completed task count, remaining task count, skipped optional task count, changed files count, validation command summary, blocker count, summary text, and report paths where available
    - Render a terminal done card for completed workflow state and display report-unavailable diagnostics without marking workflow failed
    - _Requirements: 6.4, 6.5, 6.6, 6.7_
  - [✅]* 4.5 Write unit tests for checkbox, mutation, blocker, report, and done rendering
    - Extend `tests/unit/workflow-tui-execution-views.test.ts`
    - Test checkbox update statuses, absent checkbox status without file access, mutation warning rendering, malformed mutation diagnostics, blocked task diagnostics, failed execution diagnostics, no retry/abort/continue controls, execution report summary, done terminal card, and missing report diagnostics
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 9.2_

- [✅] 5. Phase 5: Integrate execution views with widget and fallback output
  - [✅] 5.1 Extend `WorkflowLiveWidget` with optional execution provider
    - Modify `extensions/clarification-orchestrator/tui/workflow-widget.ts` to accept optional `getExecutionViewModel?: (snapshot: WorkflowLiveSnapshot) => ExecutionViewModel | undefined`
    - Render an `Execution` section in expanded mode when the provider returns a model
    - Preserve existing Spec 8 read-only behavior, Spec 8.1 interactive behavior, and Spec 8.2 review panel behavior when the provider is absent
    - _Requirements: 7.1, 7.2, 8.3_
  - [✅] 5.2 Add deterministic execution fallback renderer
    - Create `extensions/clarification-orchestrator/tui/execution-fallback.ts`
    - Implement `renderExecutionFallback(viewModel, options)` for non-TUI and narrow output including concise execution status, mode, task counts, current task, blocker/failure summary, mutation warning summary, execution report path, diagnostics, and safe next-action hints
    - Prefer `/brainstorm-pro --resume` and `/brainstorm-pro --status` hints without adding public command surfaces
    - _Requirements: 7.3, 7.4, 7.5, 7.7_
  - [✅] 5.3 Wire execution fallback into existing workflow fallback surfaces
    - Integrate execution fallback with `extensions/clarification-orchestrator/tui/workflow-result.ts` or command/session presentation boundaries where an `ExecutionViewModel` is available
    - Ensure compact mode may remain summary-only while expanded and fallback provide detailed execution sections
    - Ensure render failures fall back to existing fail-soft workflow live progress behavior
    - _Requirements: 7.3, 7.4, 7.6, 8.3, 8.4_
  - [✅]* 5.4 Write widget and fallback tests
    - Create `tests/unit/workflow-tui-execution-fallback.test.ts` and extend `tests/unit/workflow-tui-widget.test.ts`
    - Test optional provider integration, absence of provider preserving old output, expanded execution section, coexistence with review panel and interactive controls, deterministic fallback content, narrow width truncation, safe command hints, provider exception diagnostics, and render-failure fail-soft behavior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.3, 8.4_

- [✅] 6. Checkpoint - Verify execution rendering and fail-soft behavior
  - Run `npm run typecheck`
  - Run `node --test tests/unit/workflow-execution-summary.test.ts tests/unit/workflow-tui-execution-view-model.test.ts tests/unit/workflow-tui-execution-views.test.ts tests/unit/workflow-tui-execution-fallback.test.ts tests/unit/workflow-tui-widget.test.ts`
  - Inspect `extensions/clarification-orchestrator/tui/execution-view-model.ts`, `extensions/clarification-orchestrator/tui/execution/`, `extensions/clarification-orchestrator/tui/execution-fallback.ts`, and `extensions/clarification-orchestrator/tui/workflow-widget.ts` to confirm renderers preserve runtime-provided execution facts and do not parse tasks, update checkboxes, validate evidence, launch agents, or decide execution recovery
  - Confirm requirements 1.1-1.6, 2.1-2.6, 3.1-3.7, 4.1-4.5, 5.1-5.6, 6.1-6.7, 7.1-7.7, and 8.1-8.7 are covered
  - Stop only if typecheck fails, required checkpoint-as-task wording is missing, blocked/failure output exposes unsupported controls, mutation warnings can be rendered as successful execution, or render failures can affect workflow state

- [✅] 7. Phase 6: Add security boundaries, documentation, and final validation
  - [✅] 7.1 Add static boundary tests for execution TUI modules
    - Create `tests/security/tui-controlled-execution-boundary.test.ts`
    - Assert `extensions/clarification-orchestrator/tui/execution-view-model.ts`, `extensions/clarification-orchestrator/tui/execution/`, and `extensions/clarification-orchestrator/tui/execution-fallback.ts` do not import execution loop controllers, task selectors, task plan parsers for authority, checkbox writers, mutation guard writer APIs, evidence validators, state transition helpers, artifact commit helpers, approval/decision writers, or child process launch/run-agent APIs
    - _Requirements: 9.1, 9.4_
  - [✅] 7.2 Add execution-control and product-boundary security tests
    - Extend `tests/security/tui-controlled-execution-boundary.test.ts` or create focused tests
    - Assert execution renderers do not expose retry, abort, continue, skip, resolve, mark-complete, approval, state transition, checkpoint approval-gate controls, arbitrary task runner controls, generic subagent orchestration, background runner, intercom, arbitrary chains, or builtin agent discovery
    - _Requirements: 6.3, 9.2, 9.3, 9.5_
  - [✅] 7.3 Add no-write rendering boundary tests
    - Add tests that render execution views, mutation warnings, blockers, and done cards against fixture directories and verify no workflow files are written
    - Verify rendering does not write `.workflow/*`, `design.md`, `requirements.md`, or `tasks.md`
    - _Requirements: 5.5, 9.4_
  - [✅]* 7.4 Update TUI documentation
    - Update `extensions/clarification-orchestrator/tui/README.md` to describe execution views, runtime/status summary input, view model boundary, checkpoint-as-task semantics, mutation warning display, fallback behavior, and non-goals
    - Update `README.md` only if user-visible TUI behavior needs public documentation
    - _Requirements: 4.2, 7.7, 9.2, 9.3_
  - [✅]* 7.5 Add documentation alignment tests
    - Update docs tests under `tests/unit/docs/` so docs state execution views are read-only, controlled execution authority remains runtime/adapter-owned, checkpoints are not approval gates, and `/brainstorm-pro --status` / `/brainstorm-pro --resume` remain fallback paths
    - _Requirements: 4.2, 7.7, 9.2, 9.3_
  - [✅]* 7.6 Update pi-subagents reuse inventory if derived helper code is added
    - If any new code is derived from `nicobailon/pi-subagents`, update `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json` and `NOTICE.md`
    - Ensure attribution headers are present where required
    - _Requirements: 9.6_
  - [✅]* 7.7 Run final validation
    - Run `npm run typecheck`
    - Run `npm test`
    - Run `npm run validate-package`
    - Confirm Spec 8.3 files do not change workflow phase semantics, decision semantics, execution loop semantics, task selection, checkbox writer behavior, evidence validation, public command surface, or runtime authority
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for a minimal implementation, but authority boundaries, checkpoint-as-task wording, mutation warning safety, and fail-soft behavior should not be skipped in a production PR.
- Spec 8.3 is presentation-only. Runtime/status and the controlled spec-exec adapter own task parsing, task selection, evidence validation, checkbox writes, mutation detection, blockers, execution reports, and workflow transitions.
- Use existing TypeScript ES module style with explicit `.ts` relative imports, two-space indentation, double quotes, and strict typing.
- Prefer runtime/status execution summary data over direct workflow file reads from TUI modules.
- Preserve the pi-subagents infrastructure-only reuse policy and update attribution if any additional derived helper code is introduced.
