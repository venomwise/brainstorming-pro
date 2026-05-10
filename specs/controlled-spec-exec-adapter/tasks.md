# Implementation Plan: Controlled Spec Exec Adapter

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md). The work is organized into four implementation phases: deterministic parsing/context contracts, execution mode and task-loop control, child-agent enforcement with guarded checkbox mutation, and reporting/runtime integration. The order builds the execution substrate from the safest primitives outward: parse and validate the approved inputs first, decide optional-mode and next-task behavior second, integrate the single-task worker and mutation guard third, and only then wire completion/reporting into the workflow runtime.

The implementation uses TypeScript ES modules under `extensions/clarification-orchestrator/workflow/adapters/spec-exec/`, keeps `extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts` as the adapter entrypoint, and reuses the existing workflow runtime, artifact store, event log, approval gate, and Spec 3 child execution runtime. Tests should use Node's built-in test runner and existing `tests/unit/`, `tests/integration/`, and `tests/security/` layout.

## Tasks

- [✅] 1. Phase 1: Build deterministic execution context and task-plan parsing
  - [✅] 1.1 Implement `TaskPlanParser`
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts` with `parseTaskPlan(markdown: string): ParsedTaskPlan`, `isCheckpointTitle(title: string): boolean`, and typed exports for `ParsedTask` and `ParsedTaskPlan`
    - Parse only the `## Tasks` section, preserve original line text and 1-based line numbers, distinguish phases, sub-tasks, phase-level tasks, checkpoint tasks, completed markers, optional markers, inherited optionality, parent-child relationships, description lines, and `_Requirements: ..._` metadata
    - Reject unsafe or malformed structures by returning explicit malformed entries for absent task sections, ambiguous nesting, invalid checkbox markers, missing executable requirement references, or unparseable task numbering
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_
  - [✅] 1.2 Implement approved execution context loading
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts` with `buildSpecExecAdapterContext(cwd: string, state: WorkflowState): Promise<SpecExecAdapterContext>`
    - Load approved `requirements.md`, approved `tasks.md`, and optional background `design.md` through existing artifact/path helpers, and verify topic-scoped paths plus checksum-valid artifact refs
    - Validate that `state.phase` is `executing`, that the plan approval gate exists, and that the approval references the exact requirements/tasks versions used for execution
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_
  - [✅] 1.3 Define execution schemas and validators
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/schemas.ts` with `SingleTaskExecutionResult`, `ExecutionBlocker`, `ExecutionReportOutput`, `TaskRunRecord`, and `validateSingleTaskExecutionResult(result: unknown, task: ParsedTask): SingleTaskExecutionResult`
    - Validate status-specific fields, matching `taskId`, relative `changedFiles`, evidence requirements for completed tasks and checkpoint tasks, blocker shape, and failed error shape
    - Reject result paths that target approved `requirements.md`, approved `design.md`, `tasks.md`, or paths outside the project root
    - _Requirements: 5.5, 5.6, 5.7, 5.8, 5.9, 7.8_
  - [✅]* 1.4 Write unit tests for parser, context, and schemas
    - Add tests in `tests/unit/workflow/spec-exec-task-plan-parser.test.ts` for phases, sub-tasks, `[✅]`, `[ ]*`, optional inheritance, checkpoint keywords, requirement extraction, description attachment, and malformed structures
    - Add tests in `tests/unit/workflow/spec-exec-context.test.ts` for approved plan loading, missing approval rejection, stale approval rejection, checksum/path validation, and background-only design loading
    - Add tests in `tests/unit/workflow/spec-exec-schemas.test.ts` for valid completed, blocked, and failed results plus all schema rejection cases
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 5.5, 5.6, 5.7, 5.8, 5.9, 7.8_
  - [✅] 1.5 Checkpoint - Verify parsing and context foundations
    - Run `npm test -- tests/unit/workflow/spec-exec-task-plan-parser.test.ts tests/unit/workflow/spec-exec-context.test.ts tests/unit/workflow/spec-exec-schemas.test.ts`
    - Inspect `extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts` to confirm it never delegates task interpretation to the child agent
    - Confirm malformed plans and missing/stale approvals stop before any `runAgent()` invocation path exists
    - Stop only if parsing, context, schema validation, or approved-artifact safety cannot satisfy the referenced requirements
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 2.1, 2.2, 2.6, 5.5, 5.9_

- [✅] 2. Phase 2: Implement optional-mode resolution and code-owned loop selection
  - [✅] 2.1 Implement optional execution mode resolution
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-mode.ts` with `resolveExecutionMode(context: SpecExecAdapterContext, plan: ParsedTaskPlan): Promise<ExecutionModeResolution>` and `validateExecutionModeDecision(decision: unknown, context: SpecExecAdapterContext): ExecutionModeDecision`
    - Detect optional tasks, pause for a one-time `mvp` or `full` user decision when needed, persist the decision with requirements/tasks artifact versions, and reject stale decisions when artifact versions change
    - Ensure `mvp` mode skips optional tasks and optional phase children without marking them complete, while `full` mode makes optional work executable in order
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [✅] 2.2 Implement next-task selection and loop primitives
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-loop.ts` with `selectNextExecutableTask(plan: ParsedTaskPlan, mode: ExecutionMode): TaskSelection`, `hasAllExecutableChildrenComplete(task: ParsedTask, plan: ParsedTaskPlan, mode: ExecutionMode): boolean`, and `runExecutionLoop(context: SpecExecAdapterContext): Promise<ExecutionLoopResult>`
    - Re-read and re-parse `tasks.md` before each selection, choose the first incomplete executable task, skip completed and MVP-excluded optional work, execute no phase with incomplete executable children, and mark phase lines complete only after all executable children are done
    - Treat checkpoint tasks as normal selected tasks and stop immediately when a child result is blocked or failed
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.10, 7.9_
  - [✅] 2.3 Implement single-task prompt construction
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/prompts.ts` with `buildSingleTaskPrompt(context: SpecExecAdapterContext, plan: ParsedTaskPlan, task: ParsedTask, mode: ExecutionMode): string`
    - Include only the current task, task description, full requirements or referenced requirement excerpts, optional background design, task kind, execution mode, completed-task summary, forbidden actions, and required structured output schema
    - Add checkpoint-specific instructions for validating completed work against `requirements.md` as a task, not as a user approval gate
    - _Requirements: 5.1, 5.2, 5.3_
  - [✅]* 2.4 Write unit tests for mode, selection, and prompts
    - Add tests in `tests/unit/workflow/spec-exec-execution-mode.test.ts` for no-optional behavior, mode decision request, persisted mode validation, stale decision rejection, MVP skipping, optional phase child skipping, and full-mode inclusion
    - Add tests in `tests/unit/workflow/spec-exec-execution-loop.test.ts` for first-incomplete selection, phase child precedence, phase completion after children, checkpoint ordering, completed-task skipping, and no-required-task completion
    - Add tests in `tests/unit/workflow/spec-exec-prompts.test.ts` that assert prompts scope the child to one task, include requirements as acceptance truth, include design only as background, and forbid checklist/plan/requirements/design mutation
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.10, 5.1, 5.2, 5.3_
  - [✅] 2.5 Checkpoint - Verify task ordering and optional-mode behavior
    - Run `npm test -- tests/unit/workflow/spec-exec-execution-mode.test.ts tests/unit/workflow/spec-exec-execution-loop.test.ts tests/unit/workflow/spec-exec-prompts.test.ts`
    - Inspect `execution-loop.ts` to confirm it re-parses `tasks.md` before each selection and never passes the entire plan as uncontrolled execution instructions
    - Confirm checkpoint tasks are selected in normal order and optional MVP-skipped tasks remain unchecked in plan fixtures
    - Stop only if selection order, optional-mode persistence, checkpoint task handling, or prompt boundaries violate the referenced requirements
    - _Requirements: 3.2, 3.4, 3.5, 3.6, 4.1, 4.2, 4.6, 5.1, 5.2, 5.3_

- [✅] 3. Phase 3: Enforce single-task execution and guarded progress mutation
  - [✅] 3.1 Implement `TaskMutationGuard` and `TaskCheckboxWriter`
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/mutation-guard.ts` with `snapshotExecutionArtifacts(context: SpecExecAdapterContext): Promise<TaskMutationSnapshot>` and `verifyNoUnauthorizedArtifactMutation(snapshot: TaskMutationSnapshot, context: SpecExecAdapterContext): Promise<void>`
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/checkbox-writer.ts` with `markTaskComplete(context: SpecExecAdapterContext, task: ParsedTask): Promise<void>` and `markPhaseComplete(context: SpecExecAdapterContext, task: ParsedTask): Promise<void>`
    - Allow only `[ ]` to `[✅]` and `[ ]*` to `[✅]*` transitions, update exactly one checkbox per call, re-read and verify the original line before writing, preserve task text and descriptions, and append task/phase completion events
    - Block unauthorized child changes to `tasks.md`, approved `requirements.md`, or approved `design.md` before any code-owned checkbox update is applied
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [✅] 3.2 Integrate child `runAgent()` execution into the adapter entrypoint
    - Replace the deferred placeholder in `extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts` with a real `specExecAdapter` that builds context, parses the plan, resolves execution mode, runs `runExecutionLoop()`, validates `SingleTaskExecutionResult`, and commits adapter outcomes
    - Call the Spec 3 controlled child execution runtime with a `task-executor` role and a typed expectation equivalent to `runAgent<SingleTaskExecutionResult>()`
    - Ensure child output validation, mutation-guard verification, and checkbox writing occur in that order for every completed task
    - _Requirements: 4.7, 4.8, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.6, 6.7, 6.8, 7.8, 7.9_
  - [✅] 3.3 Implement blocker mapping and checkpoint execution semantics
    - Add blocker creation helpers in `extensions/clarification-orchestrator/workflow/adapters/spec-exec/schemas.ts` or `execution-loop.ts` for `conflict`, `underspecified`, `validation_failure`, `scope_change`, `destructive_op`, and `missing_dependency`
    - Ensure checkpoint task failures leave the checkpoint unchecked and produce `validation_failure` blockers when validation evidence does not satisfy requirements
    - Ensure scope changes, approved artifact mutation, destructive operations, missing dependencies, and task/requirement conflicts stop execution without selecting later tasks
    - _Requirements: 4.6, 4.8, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9_
  - [✅]* 3.4 Write unit, integration, and security tests for guarded execution
    - Add tests in `tests/unit/workflow/spec-exec-checkbox-writer.test.ts` for exact one-checkbox updates, marker transitions, original-line mismatch refusal, preservation of task text, skipped optional refusal, and event appending
    - Add tests in `tests/unit/workflow/spec-exec-mutation-guard.test.ts` for child mutation of `tasks.md`, approved `requirements.md`, approved `design.md`, and allowed code-owned checkbox updates after guard verification
    - Extend `tests/unit/workflow/spec-exec-adapter.test.ts` and `tests/integration/skill-phase-adapters.test.ts` with fake child runs for completed, blocked, failed, invalid-output, checkpoint, and unauthorized-mutation outcomes
    - Extend security tests in `tests/security/skill-phase-adapters-boundary.test.ts` or a new `tests/security/spec-exec-adapter-boundary.test.ts` for no generic subagent surface, child `--no-session`, child `--no-skills`, no LLM-owned progress mutation, and no approved requirements/design revision
    - _Requirements: 4.7, 4.8, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_
  - [✅] 3.5 Checkpoint - Verify mutation safety and fail-closed behavior
    - Run `npm test -- tests/unit/workflow/spec-exec-checkbox-writer.test.ts tests/unit/workflow/spec-exec-mutation-guard.test.ts tests/unit/workflow/spec-exec-adapter.test.ts tests/integration/skill-phase-adapters.test.ts tests/security/skill-phase-adapters-boundary.test.ts`
    - Inspect `spec-exec.ts`, `mutation-guard.ts`, and `checkbox-writer.ts` to confirm the child cannot directly update checkbox state or approved artifacts
    - Confirm blocked, failed, malformed-output, checkpoint-validation-failure, destructive-operation, missing-dependency, and scope-change cases leave the current task unchecked and later tasks unselected
    - Stop only if progress mutation, child result validation, or blocker mapping fails closed incorrectly
    - _Requirements: 4.7, 4.8, 5.5, 5.9, 6.1, 6.7, 6.8, 7.1, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

- [✅] 4. Phase 4: Persist execution reports and runtime completion state
  - [✅] 4.1 Implement execution report writing
    - Create `extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-report.ts` with `writeExecutionReport(context: SpecExecAdapterContext, report: ExecutionReportOutput): Promise<ExecutionReportRefs>` and `buildExecutionReport(loopResult: ExecutionLoopResult, context: SpecExecAdapterContext): ExecutionReportOutput`
    - Write `specs/<topic>/.workflow/runs/<run-id>/execution-report.json` and `execution-report.md` with status, mode, task run records, completed tasks, remaining tasks, skipped optional tasks, changed files, validation commands, blockers, and summary
    - Include timestamps, child run ids when available, evidence, checkpoint task records, and skipped optional tasks without counting skipped work as complete
    - _Requirements: 8.1, 8.2, 8.3, 8.7_
  - [✅] 4.2 Wire execution stop outcomes into workflow runtime persistence
    - Update `extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts` and, if required, `extensions/clarification-orchestrator/workflow/runtime.ts` so completed execution writes reports, commits the current `tasks.md` as a new versioned tasks artifact, appends phase/task events, and transitions the workflow phase to `done`
    - Ensure blocked and failed execution writes reports, commits current task progress as a versioned tasks artifact, persists error/recoverability details, and does not add a default execution-review phase
    - Ensure resume behavior reuses the current parsed `tasks.md` checkbox state and continues from the first incomplete executable task
    - _Requirements: 4.9, 4.10, 7.7, 8.1, 8.4, 8.5, 8.6, 8.7_
  - [✅]* 4.3 Add end-to-end integration coverage for completion, reporting, and resume
    - Add or extend `tests/integration/workflow-runtime.test.ts` with approved-plan flows that execute multiple tasks in order, complete a checkpoint, enter `done`, and produce execution report files
    - Add integration tests for blocked child result, failed child result, invalid child output, unauthorized `tasks.md` mutation, interruption/resume from first unchecked task, MVP mode skipped optional tasks, and full mode executing optional tasks
    - Assert the committed tasks artifact version reflects code-owned progress and that no execution-review phase appears by default
    - _Requirements: 3.5, 3.6, 4.7, 4.8, 4.9, 4.10, 6.7, 7.7, 7.8, 7.9, 8.1, 8.4, 8.5, 8.6, 8.7_
  - [✅] 4.4 Checkpoint - Verify final runtime behavior and audit artifacts
    - Run `npm run typecheck && npm test -- tests/unit/workflow/spec-exec-*.test.ts tests/integration/skill-phase-adapters.test.ts tests/integration/workflow-runtime.test.ts tests/security/skill-phase-adapters-boundary.test.ts`
    - Inspect generated fixture reports in integration temp directories to confirm `execution-report.json`, `execution-report.md`, versioned `tasks.md`, and workflow events contain matching task ids, statuses, blockers, and evidence
    - Confirm completed execution transitions to `done`, while blocked/failed execution persists reports and recoverability details without selecting later tasks or introducing an execution-review phase
    - Stop only if final runtime state, report artifacts, progress artifact versioning, or audit events fail to match requirements
    - _Requirements: 4.9, 4.10, 7.7, 7.9, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- The adapter must not introduce public command surface, generic subagent tools, arbitrary chain/parallel/async orchestration, or background execution.
- `requirements.md` remains the execution acceptance source of truth; `design.md` is background only during execution.
- The child task executor must never update `tasks.md` checkboxes, revise the task plan, revise approved requirements, or revise approved design.
- Checkpoint tasks are executed by the child worker as validation tasks and are not user approval gates.
