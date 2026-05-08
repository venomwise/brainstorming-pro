# Implementation Plan: Workflow Runtime Orchestrator

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

## Overview

Build the workflow runtime in layers: first define the durable workflow data model and state transitions, then add artifact storage, event logging, review decision gates, and approval gates, then wire the state-aware `/brainstorm-pro --resume` entrypoint and phase adapters, and finally validate the full lifecycle and security boundaries with integration tests.

The execution order matters because the runtime must own state before any command or adapter can mutate it. Review decisions, approval gates, and artifact versioning come next so that later orchestration code can safely pause and resume. Command entrypoints and adapters are added after the persistence contracts exist, and verification runs throughout with unit, integration, and security coverage.

## Tasks

- [✅] 1. Phase 1: Define the workflow domain model and state machine
  - [✅] 1.1 Create `extensions/clarification-orchestrator/workflow/types.ts` and `extensions/clarification-orchestrator/workflow/state-machine.ts`
    - Define `WorkflowPhase`, `WorkflowState`, `VersionedArtifactRef`, `ReviewMode`, `ReviewDecisionRef`, `ApprovalRef`, `ReviewPhaseStatus`, `UserDecisionRequest`, and `WorkflowErrorSnapshot` in `workflow/types.ts`
    - Include `reviewDecisions` and `reviewStatus` in `WorkflowState`, separate from approval `gates`
    - Implement `canTransition()`, `transition()`, and `assertTransitionAllowed()` in `workflow/state-machine.ts`
    - Encode the legal paths for `designing`, `awaiting-design-review-decision`, `design-review`, `awaiting-design-approval`, `planning`, `awaiting-plan-review-decision`, `plan-review`, `awaiting-plan-approval`, `executing`, `execution-review`, `done`, `blocked`, and `failed`
    - Ensure `awaiting-design-review-decision -> awaiting-design-approval` is legal only for user-selected `skip`, and `awaiting-design-review-decision -> design-review` is legal only for user-selected `minimal` or implemented `full`
    - Ensure `awaiting-plan-review-decision -> awaiting-plan-approval` is legal only for user-selected `skip`, and `awaiting-plan-review-decision -> plan-review` is legal only for user-selected `minimal` or implemented `full`
    - _Requirements: 1.1, 2.1, 2.2, 2.3, 4.1, 4.2, 8.1, 9.1_
  - [✅] 1.2 Add workflow state initialization helpers in `extensions/clarification-orchestrator/workflow/runtime.ts`
    - Implement `createInitialWorkflowState()` and the run bootstrap path that creates the first persisted state for a topic
    - Preserve prior runs by generating a new run identifier instead of mutating previous approved artifacts
    - Initialize empty `reviewDecisions`, `reviewStatus`, and `gates` containers
    - _Requirements: 1.1, 1.3, 1.4_
  - [✅]* 1.3 Add unit tests for the workflow state model and transition rules in `tests/unit/workflow/state-machine.test.ts`
    - Test legal transitions, illegal transitions, terminal-state behavior, and boundary cases for `blocked` and `failed`
    - Test review decision transitions for design and plan `skip`, `minimal`, unavailable `full`, and missing decision data
    - _Requirements: 2.1, 2.2, 2.3, 4.1, 4.2, 8.1_

- [✅] 2. Phase 2: Implement artifact storage, event logging, review decisions, and approval gates
  - [✅] 2.1 Create `extensions/clarification-orchestrator/workflow/artifact-store.ts`
    - Implement `createWorkflowLayout()`, `writeVersionedArtifact()`, `mirrorLatestArtifact()`, `readLatestArtifact()`, and `assertWorkflowPath()`
    - Store versioned files under `.workflow/artifacts/<kind>/vN.md` and mirror them to `design.md`, `requirements.md`, and `tasks.md`
    - Support checksum or equivalent integrity metadata for versioned artifact references
    - _Requirements: 3.1, 3.2, 3.4, 9.1_
  - [✅] 2.2 Create `extensions/clarification-orchestrator/workflow/events.ts` and `extensions/clarification-orchestrator/workflow/gates.ts`
    - Implement `appendWorkflowEvent()` and `readWorkflowEvents()` in `events.ts`
    - Implement `recordReviewDecision()`, `validateReviewDecision()`, `validateDesignApproval()`, `validatePlanApproval()`, and `approveGate()` in `gates.ts`
    - Persist review decision artifacts under `.workflow/decisions/` with exact artifact version references, selected mode, selecting user, and timestamps
    - Persist `design-approval.json` and `plan-approval.json` under `.workflow/approvals/` with exact artifact version references and timestamps
    - Reject stale review decisions and stale approvals when latest artifact versions no longer match
    - _Requirements: 4.1, 4.2, 4.3, 4.6, 4.7, 5.1, 5.2, 5.3, 7.1, 7.3_
  - [✅] 2.3 Implement minimal review readiness checks in `extensions/clarification-orchestrator/workflow/review-validation.ts`
    - Validate that selected artifacts exist, are non-empty, resolve inside the topic directory, and match the expected version/checksum metadata
    - Return typed `passed`, `blocked`, or `failed` results for review adapters to commit
    - Keep content-section checks optional for the first pass, but make artifact integrity checks mandatory
    - _Requirements: 4.4, 6.3, 8.3, 9.2, 9.3_
  - [✅]* 2.4 Add unit tests for artifact versioning, event appends, review decision handling, minimal validation, and gate mismatch handling in `tests/unit/workflow/artifact-store.test.ts`, `tests/unit/workflow/events.test.ts`, `tests/unit/workflow/gates.test.ts`, and `tests/unit/workflow/review-validation.test.ts`
    - Test mirror updates, version increments, append-only log behavior, missing artifact detection, user-selected skip recording, minimal validation pass/block cases, unavailable full review handling, review decision rejection for stale versions, and approval rejection for stale versions
    - _Requirements: 3.1, 3.2, 3.3, 4.3, 4.5, 4.6, 5.3, 7.1, 7.3, 8.2, 9.2_

- [✅]* 3. Checkpoint - Verify persisted workflow primitives
  - Confirm the new workflow domain files compile and the phase 1-2 unit tests pass
  - Verify the runtime can create safe directories, append events, record review decisions, and reject invalid decisions or approvals without mutating state
  - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 7.1, 8.1, 9.1_

- [✅] 4. Phase 3: Build the runtime orchestrator and command entrypoints
  - [✅] 4.1 Implement `extensions/clarification-orchestrator/workflow/runtime.ts`
    - Add `WorkflowRuntimeOrchestrator`, `startWorkflow()`, `resumeWorkflow(topic?)`, and `getStatus(topic?)`
    - Drive phase progression from persisted state, the adapter registry, review decision gates, and approval gates instead of prompt order
    - Implement discovery of resumable workflows and return a topic-selection prompt when multiple workflows are pending and no topic is specified
    - Implement state-aware resume behavior for active phases, review decision gates, approval gates, blocked states, failed states, and terminal states
    - Record state changes, review decision prompts, approval prompts, and errors through the event log before returning to the caller
    - _Requirements: 1.1, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 6.1, 6.4, 6.5, 7.2, 8.2_
  - [✅] 4.2 Add command handlers in `extensions/clarification-orchestrator/commands/brainstorm-pro.ts` and status-related command wiring
    - Wire `/brainstorm-pro "<request>"`, `/brainstorm-pro --resume`, and `/brainstorm-pro --status` into the runtime orchestrator
    - Make `/brainstorm-pro --resume` the primary user path for selecting a workflow, choosing review mode, approving artifacts, requesting revision, retrying recoverable failures, or exiting
    - Do not expose `--approve design`, `--approve plan`, or `--review --mode` as required first-version user commands; if helper internals exist, keep them behind runtime validation rather than documenting them as the main path
    - Preserve the existing `/clarify`, `/spec-plan`, and `/spec-exec` commands as lower-level capabilities beneath the new runtime
    - _Requirements: 1.1, 2.4, 2.6, 2.7, 4.1, 4.2, 5.1, 5.2, 7.2_
  - [✅] 4.3 Implement state-aware user decision rendering and handling
    - Render design review decision options from `awaiting-design-review-decision`: `skip`, `minimal`, `full`, `revise`, and `exit`
    - Render design approval options from `awaiting-design-approval`: approve, request revision, show status/summary, and exit
    - Render plan review decision options from `awaiting-plan-review-decision`: `skip`, `minimal`, `full`, `revise`, and `exit`
    - Render plan approval options from `awaiting-plan-approval`: approve, request revision, show status/summary, and exit
    - Ensure user choices are recorded as typed state/events and are bound to exact current artifact versions
    - _Requirements: 2.6, 2.7, 4.1, 4.2, 4.7, 5.4, 7.1, 7.2_
  - [✅]* 4.4 Add unit tests for start, resume, status, review decision, and approval flows in `tests/unit/workflow/runtime.test.ts` and `tests/unit/commands/brainstorm-pro.test.ts`
    - Test paused review decision handling, multiple-workflow selection, unavailable full review behavior, user-selected skip, minimal review progression, paused approval handling, resume after approval, blocked-state reporting, and fail-closed behavior on corrupted state
    - _Requirements: 2.4, 2.6, 2.7, 4.3, 4.5, 5.1, 5.3, 7.2, 8.1, 8.3_

- [✅] 5. Phase 4: Implement phase adapters and placeholder review stages
  - [✅] 5.1 Create `extensions/clarification-orchestrator/workflow/adapters/brainstorming.ts`, `spec-plan.ts`, and `spec-exec.ts`
    - Define a shared `PhaseAdapter<Input, Output>` interface and adapter registry
    - Map each adapter to its required artifacts, allowed source phases, `run()`, `validate()`, and `commit()` behavior
    - Ensure the brainstorming adapter commits design artifacts and transitions to `awaiting-design-review-decision`
    - Ensure the spec-plan adapter commits requirements/tasks artifacts and transitions to `awaiting-plan-review-decision`
    - _Requirements: 2.2, 2.3, 6.1, 6.2, 6.4_
  - [✅] 5.2 Create review adapters in `extensions/clarification-orchestrator/workflow/adapters/design-review.ts`, `plan-review.ts`, and `execution-review.ts`
    - Support user-selected `skip` by committing explicit skipped status with `reason = "user-selected-skip"` without running automated review
    - Support `minimal` by running artifact existence, non-empty content, path safety, version consistency, and checksum/integrity validation
    - Return unavailable for `full` until the future multi-agent review panel is implemented; do not silently downgrade
    - Keep the adapter contract stable so future multi-agent review logic can be added without changing the runtime contract
    - _Requirements: 4.3, 4.4, 4.5, 6.3, 6.4, 7.1, 8.3_
  - [✅]* 5.3 Add integration tests for the full happy path in `tests/integration/workflow-runtime.test.ts`
    - Cover start → design → awaiting design review decision → choose skip/minimal → awaiting design approval → approve design → planning → awaiting plan review decision → choose skip/minimal → awaiting plan approval → approve plan → executing → done
    - Cover stale review decision rejection when design or plan artifacts change between decision and approval
    - _Requirements: 1.1, 2.2, 2.3, 2.6, 2.7, 4.1, 4.2, 4.6, 5.1, 5.2, 6.1, 7.2_

- [✅]* 6. Checkpoint - Verify end-to-end recovery and security boundaries
  - Validate illegal transitions, topic path traversal rejection, review decision mismatch rejection, approval mismatch rejection, and missing artifact blocking across the runtime path
  - Confirm status output and event log records make paused review decisions, paused approvals, blocked runs, and failed runs understandable to operators
  - _Requirements: 2.1, 3.3, 4.6, 5.3, 7.2, 8.3, 9.2_

- [✅]* 7. Optional Phase: Documentation and future extension hooks
  - [✅] 7.1 Update `README.md` and `specs/workflow-runtime-orchestrator/design.md` to document the runtime command model and gates
    - Describe `/brainstorm-pro "<request>"`, `/brainstorm-pro --resume`, `/brainstorm-pro --status`, persisted files, review decision gates, approval gates, and pause/resume behavior for users and maintainers
    - _Requirements: 1.2, 2.6, 4.1, 5.1, 7.2_
  - [✅] 7.2 Add a typed future-tool hook in `extensions/clarification-orchestrator/workflow/runtime.ts`
    - Leave a narrow entry point for a future `brainstorming_pro({ action, topic, request })` API without exposing a public tool yet
    - Ensure any future tool action still routes through state-aware resume and cannot bypass review decision or approval gates
    - _Requirements: 2.1, 5.1, 6.1, 6.5_
  - [✅]* 7.3 Add documentation validation or snapshot tests for the new workflow docs in `tests/unit/docs/workflow-runtime.test.ts`
    - Verify the published command names, state names, gate names, and file layout stay aligned with the implementation
    - _Requirements: 1.2, 2.6, 4.1, 5.1, 7.2_

## Notes

- Tasks marked with `*` are optional and can be skipped for the first implementation pass.
- Each task includes one or more requirement IDs for traceability.
- Keep task numbering stable so requirement references remain valid.
