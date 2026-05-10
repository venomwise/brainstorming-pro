# Implementation Plan: Design Review Execution Control

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is organized into seven phases: type/model foundations, reviewer selection and coverage, partial aggregation/readiness, attempt/ledger persistence, retry and accept-incomplete recovery flows, runtime resume/status integration, and validation/documentation. The execution order starts with typed contracts so downstream modules can remain strict, then adds pure helpers with focused unit coverage, then integrates them into the design review panel and workflow runtime. The implementation uses TypeScript ES modules under `extensions/clarification-orchestrator/`, existing workflow atomic JSON persistence, existing artifact binding/path guards, and Node's built-in test runner.

## Tasks

- [✅] 1. Phase 1: Extend workflow and design review type contracts
  - [✅] 1.1 Add reviewer selection fields to review decisions
    - Modify `extensions/clarification-orchestrator/workflow/types.ts` to add a design-review-specific decision shape or extension that can carry `selectedReviewerRoles?: FullDesignReviewerRole[]` and `selectionReason?: string` without allowing those fields for `skip` or `minimal` decisions.
    - Modify `extensions/clarification-orchestrator/workflow/gates.ts` in `RecordReviewDecisionInput`, `recordReviewDecision`, and validation helpers so design review decisions can persist selected reviewer roles only when mode is `full` and still validate artifact refs with `validateReviewDecision`.
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 10.6_
  - [✅] 1.2 Extend design review status, readiness, aggregate, coverage, and attempt types
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts` to add `DesignReviewRunStatus` value `partial` and `DesignApprovalReadiness.status` value `incomplete-review`.
    - Add `FullDesignReviewerRole` imports/aliases, `DesignReviewCoverage`, `DesignReviewAttempt`, `AcceptIncompleteDesignReviewDecision`, and `DesignReviewRecoveryAction` types in `types.ts` or dedicated modules exported from `types.ts`.
    - Extend `DesignReviewAggregateResult` with optional `coverage?: DesignReviewCoverage` and status support for `partial` while preserving existing skipped/unavailable/minimal paths.
    - _Requirements: 2.1, 3.3, 4.3, 5.2, 6.6, 9.1_
  - [✅] 1.3 Define execution-control event payload types
    - Modify `extensions/clarification-orchestrator/workflow/events.ts` to add typed helpers or exported payload types for `design-review-reviewer-selection-recorded`, `design-review-attempt-started`, `design-review-attempt-completed`, `design-review-partial-aggregated`, `design-review-failed-reviewers-retried`, and `design-review-incomplete-accepted`.
    - Keep `appendWorkflowEvent` append-only and ensure event payload details remain serializable without trusting mutable ledger files as the only audit source.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - [✅]* 1.4 Write type and gate unit tests
    - Add or update `tests/unit/workflow/design-review-panel-types.test.ts` to assert `partial` and `incomplete-review` type-compatible fixtures serialize correctly.
    - Add or update `tests/unit/workflow/gates.test.ts` to assert full review decisions may include valid selection metadata while skip/minimal decisions reject full reviewer selection metadata.
    - _Requirements: 1.2, 1.3, 3.3, 6.6, 8.1_

- [✅] 2. Phase 2: Implement reviewer selection and coverage helpers
  - [✅] 2.1 Implement reviewer selection resolver
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-selection.ts` with `resolveDesignReviewerSelection(decision, designRef)` and `validateDesignReviewerSelection(...)` functions.
    - Use `resolveFullDesignReviewerSet` and package-owned full reviewer registry data from `full-reviewer-registry.ts` to default omitted full selections to all five reviewers, reject empty/duplicate/unknown/minimal/unregistered/non-design-review roles, and return deterministic selected/unselected role ordering.
    - _Requirements: 1.1, 1.2, 1.4, 1.6, 10.5_
  - [✅] 2.2 Record reviewer selection decisions and audit events
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts` or the review-decision handling path to call `resolveDesignReviewerSelection` before creating a full review run.
    - Append `design-review-reviewer-selection-recorded` through `appendWorkflowEvent` after durable decision validation and before reviewer execution.
    - Ensure invalid selection prevents review run creation and surfaces diagnostics instead of falling back to all reviewers.
    - _Requirements: 1.2, 1.4, 1.5, 8.1, 10.6_
  - [✅] 2.3 Implement review coverage computation
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts` with `createInitialDesignReviewCoverage(...)`, `computeDesignReviewCoverage(...)`, and `assertCoverageConsistent(...)` functions.
    - Ensure unselected reviewers are recorded but never counted as failed/succeeded/pending retry, succeeded and failed sets are derived from latest effective selected reviewer results, pending retry defaults to failed reviewers, and out-of-selection roles are rejected.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [✅] 2.4 Pass selected reviewers into full reviewer execution
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-coordinator.ts` and `runDesignReviewers` call sites so `selectedFullReviewerRoles` comes from the resolved stable selection for full mode.
    - Preserve current minimal reviewer behavior and ensure selected full reviewers execute in deterministic order.
    - _Requirements: 1.1, 1.2, 1.6, 2.1, 2.4_
  - [✅]* 2.5 Write selection and coverage unit tests
    - Add `tests/unit/workflow/design-review-execution-control-selection.test.ts` covering default five-reviewer selection, explicit subset selection, empty subset rejection, duplicate rejection, unknown role rejection, `minimal-reviewer` rejection, stale design selection semantics, and deterministic ordering.
    - Add `tests/unit/workflow/design-review-execution-control-coverage.test.ts` covering initial coverage, selected/unselected semantics, success/failure/pending retry computation, retry updates, and rejection of roles outside the stable selected set.
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [✅] 3. Checkpoint - Verify selection and coverage foundations
  - Run `npm run typecheck` and targeted tests `node --test tests/unit/workflow/design-review-execution-control-selection.test.ts tests/unit/workflow/design-review-execution-control-coverage.test.ts tests/unit/workflow/gates.test.ts`.
  - Inspect `extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-selection.ts` and `review-coverage.ts` to confirm invalid selections fail before review run creation and unselected reviewers never count as failed.
  - Confirm requirement coverage for selection and coverage criteria in `specs/design-review-execution-control/requirements.md` before continuing.
  - Stop only if requirement validation fails, TypeScript errors remain, tests fail, or the implementation would require changing approved requirements.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [✅] 4. Phase 3: Implement partial aggregation and readiness semantics
  - [✅] 4.1 Extend readiness evaluation for partial reviews
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/readiness.ts` to support `incomplete-review` and the exact matrix for all-selected-success/no-blocking, all-selected-success/blocking, partial/no-blocking, partial/blocking, and all-selected-failed.
    - Ensure inconsistent coverage/result input fails closed and never returns `ready-for-user-approval`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [✅] 4.2 Implement partial-success aggregation
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/partial-aggregation.ts` or extend `aggregation.ts` with `aggregatePartialDesignReviewFindings(...)` that accepts successful reviewer results, failed diagnostics, coverage, and design ref.
    - Aggregate only normalized findings from successful reviewers, preserve empty partial aggregates, include coverage/counts/status/readiness, and exclude failed diagnostics from findings.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [✅] 4.3 Integrate partial aggregation into panel execution
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts` so full review no longer fails the whole run when at least one selected reviewer succeeds and at least one selected reviewer fails.
    - Write successful reviewer results, failed diagnostics, coverage, aggregate, and readiness; set `partial`/`incomplete-review` or `blocked`/`blocked` according to findings.
    - Preserve all-selected-failed behavior as `failed`/`failed`.
    - _Requirements: 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.6_
  - [✅] 4.4 Append partial aggregation audit events
    - Modify `panel.ts` or an execution-control helper to append `design-review-partial-aggregated` when a partial result is durably written.
    - Ensure event append failure prevents treating the partial result as recoverable approval readiness.
    - _Requirements: 8.3, 8.6, 4.6_
  - [✅]* 4.5 Write partial aggregation and readiness unit tests
    - Add `tests/unit/workflow/design-review-execution-control-coverage.test.ts` or a new aggregation test covering successful findings entering aggregate when another reviewer fails and failed diagnostics staying out of findings.
    - Add `tests/unit/workflow/design-review-panel.test.ts` cases for partial/no-blocking yielding `partial` and `incomplete-review`, partial/blocking yielding `blocked`, and all selected failed yielding `failed`.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [✅] 5. Phase 4: Add attempt-aware ledger persistence
  - [✅] 5.1 Extend review-run store for coverage and attempts
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts` to add `writeCoverage`, `writeDesignReviewAttempt`, `writeAttemptReviewerResult`, `writeAcceptIncompleteDecision`, and read helpers needed for retry/status.
    - Ensure `ensureReviewLedger` creates `reviewer-results/` and `attempts/<attempt-id>/reviewer-results/` as needed, while all paths are checked with `assertWorkflowPath`.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [✅] 5.2 Create attempt store helper
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/review-attempt-store.ts` with `createDesignReviewAttempt(...)`, `completeDesignReviewAttempt(...)`, and attempt id generation such as `attempt-001`, `attempt-002` scoped to the review run ledger.
    - Preserve same `reviewRunId`, stable selected set, reason values `initial` and `retry-failed-reviewers`, and exact design ref in every attempt.
    - _Requirements: 5.2, 5.3, 7.2, 7.3_
  - [✅] 5.3 Wire initial execution through attempt persistence
    - Modify `panel.ts` to create `attempt-001` for the initial run, write attempt-level reviewer results, update top-level latest effective reviewer results, complete the attempt, and append attempt started/completed events.
    - Ensure ledger or event write failure fails closed and does not advance readiness from non-durable results.
    - _Requirements: 7.2, 7.3, 8.2, 8.6, 4.6_
  - [✅] 5.4 Add ledger consistency and corruption checks
    - Add helper functions in `review-run-store.ts` or `review-attempt-store.ts` to read review run, coverage, aggregate, readiness, attempts, and reviewer results and validate they agree with selected reviewers and event/state data.
    - Reject missing, corrupted, or inconsistent ledger evidence before retry or accept incomplete can proceed.
    - _Requirements: 6.4, 7.6, 10.2, 10.5_
  - [✅]* 5.5 Write ledger and attempt unit tests
    - Add `tests/unit/workflow/design-review-execution-control-ledger.test.ts` covering ledger layout, path confinement, attempt records, attempt-level reviewer results, top-level effective result updates, coverage/readiness/aggregate writes, accept-incomplete decision writes, and corrupted ledger rejection.
    - Update `tests/unit/workflow/design-review-ledger.test.ts` if existing ledger fixtures need to include attempt-aware paths.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 8.2, 8.6_

- [✅] 6. Checkpoint - Verify partial aggregation and durable ledger behavior
  - Run `npm run typecheck` and targeted tests `node --test tests/unit/workflow/design-review-panel.test.ts tests/unit/workflow/design-review-execution-control-ledger.test.ts tests/unit/workflow/design-review-ledger.test.ts`.
  - Inspect a temporary test ledger under `.workflow/reviews/design/<review-run-id>/` to confirm `attempts/`, top-level `reviewer-results/`, `coverage.json`, `aggregated-findings.json`, and `readiness.json` match the approved layout.
  - Confirm partial reviews are never returned as `passed` and that ledger/event failures fail closed.
  - Stop only if requirement validation fails, tests fail, ledger files escape expected paths, or partial review can be mistaken for approval-ready passed review.
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [✅] 7. Phase 5: Implement retry and accept-incomplete recovery operations
  - [✅] 7.1 Implement failed reviewer retry operation
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/retry-failed-reviewers.ts` with `retryFailedDesignReviewers(...)` that loads the review run ledger, validates exact design ref/checksum through `bindDesignArtifactForReview` or equivalent artifact validation, creates a new attempt, and runs only current failed reviewers by default.
    - Update latest effective reviewer results, coverage, aggregate, readiness, and attempt completion after retry; preserve successful results that are not rerun.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_
  - [✅] 7.2 Append retry audit events and enforce retry durability
    - Modify `retry-failed-reviewers.ts` to append `design-review-failed-reviewers-retried`, `design-review-attempt-started`, and `design-review-attempt-completed` events at the correct durable points.
    - Ensure retry ledger or event append failure keeps previous effective results and does not advance to approval readiness.
    - _Requirements: 5.7, 8.2, 8.4, 8.6_
  - [✅] 7.3 Implement accept-incomplete gate
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/accept-incomplete.ts` with `acceptIncompleteDesignReview(...)` that validates mode `full`, `incomplete-review`, at least one success, at least one failure, no blocking findings, current exact design binding, explicit user confirmation, and durable ledger availability.
    - Write `accept-incomplete-decision.json` with all required fields, append `design-review-incomplete-accepted`, and return a result that allows runtime to transition only to `awaiting-design-approval`.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 8.5_
  - [✅] 7.4 Enforce untrusted input and authority boundaries
    - Add validation in `accept-incomplete.ts`, `retry-failed-reviewers.ts`, `partial-aggregation.ts`, and `review-coverage.ts` so reviewer output or crafted payloads cannot mutate workflow state, approvals, review decisions, artifact refs, coverage, or acceptance decisions.
    - Cross-check accept-incomplete and retry decisions against effective reviewer results, aggregate blocking findings, artifact refs/checksums, and state-machine transitions.
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [✅]* 7.5 Write retry and accept-incomplete unit tests
    - Add `tests/unit/workflow/design-review-execution-control-retry.test.ts` covering failed-only retry target selection, same review run id/design ref, attempt id creation, retry success updating effective results, retry failure preserving previous successes, stale design rejection, and ledger/event failure handling.
    - Add `tests/unit/workflow/design-review-execution-control-accept-incomplete.test.ts` covering explicit user confirmation, no-blocking partial acceptance, all-failed rejection, blocking partial rejection, stale artifact rejection, corrupted ledger rejection, skip/minimal rejection, missing explicit confirmation rejection, decision record writes, event appends, and movement only to design approval gate.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 8.4, 8.5, 8.6_

- [✅] 8. Phase 6: Integrate recovery actions with runtime status/resume contract
  - [✅] 8.1 Add design review recovery action builder
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/recovery-actions.ts` with `buildDesignReviewRecoveryActions(...)` that derives `retry-failed-reviewers`, `accept-incomplete-review`, `replace-review-selection`, and `view-review-ledger` actions from run status, readiness, coverage, design ref, diagnostics, and ledger health.
    - Omit unsafe accept-incomplete actions when blocking findings, all-failed results, stale artifact binding, or corrupted ledger evidence exists.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [✅] 8.2 Expose incomplete review as recoverable blocked workflow state
    - Modify `extensions/clarification-orchestrator/workflow/runtime.ts` and related status helpers under `extensions/clarification-orchestrator/tui/` to represent `partial`/`incomplete-review` as recoverable `blocked` with reason `incomplete-design-review` and recovery actions.
    - Ensure retry or accept-incomplete resumes from that recoverable state without adding public command surface or polished UX beyond the contract.
    - _Requirements: 3.3, 6.2, 9.1, 9.2, 9.3, 9.6_
  - [✅] 8.3 Preserve state-machine and approval gate separation
    - Modify `runtime.ts` and `state-machine.ts` only as needed so retry success can transition from recoverable blocked/design-review back to `awaiting-design-approval`, and accept-incomplete can transition only to `awaiting-design-approval`.
    - Confirm design approval remains a separate user gate using `approveGate` and cannot be written by review/retry/accept-incomplete helpers.
    - _Requirements: 6.2, 6.3, 10.3, 10.4, 10.6_
  - [✅]* 8.4 Write runtime/status recovery tests
    - Add or update `tests/unit/workflow/runtime.test.ts`, `tests/unit/workflow/state-machine.test.ts`, and TUI/status tests to verify incomplete review exposes coverage, failed diagnostics summary, aggregate counts, recovery actions, and safe blocker diagnostics.
    - Add `tests/integration/design-review-execution-control.test.ts` cases for subset pass reaching `awaiting-design-approval`, partial exposing retry, retry success reaching `awaiting-design-approval`, accept-incomplete reaching `awaiting-design-approval`, blocking partial rejecting accept-incomplete, and stale design rejecting retry/accept-incomplete.
    - _Requirements: 5.4, 5.6, 6.1, 6.2, 6.3, 6.4, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.6_

- [✅] 9. Checkpoint - Verify recovery control and workflow authority
  - Run `npm run typecheck` and targeted tests `node --test tests/unit/workflow/design-review-execution-control-retry.test.ts tests/unit/workflow/design-review-execution-control-accept-incomplete.test.ts tests/unit/workflow/runtime.test.ts tests/integration/design-review-execution-control.test.ts`.
  - Inspect retry and accept-incomplete paths to confirm stale artifacts reject, unsafe accept-incomplete actions are omitted, and successful accept-incomplete still requires separate design approval.
  - Confirm runtime state changes use `transition`/`assertTransitionAllowed` and explicit user decisions rather than reviewer output or LLM implications.
  - Stop only if recovery actions are unsafe, approval can be bypassed, stale artifacts can be reused, or events/ledger records are not durable.
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [✅] 10. Phase 7: Security, integration, and documentation alignment
  - [✅]* 10.1 Add security tests for trust boundaries
    - Add `tests/security/design-review-execution-control.test.ts` covering package-owned registry boundaries, spoofed `designRef`/checksum rejection, ledger path traversal rejection, crafted reviewer results claiming false success, crafted aggregates hiding blocking findings, crafted events/decisions bypassing explicit confirmation, and reviewer output attempting to mutate workflow state or approvals.
    - _Requirements: 1.4, 5.6, 6.4, 6.5, 7.5, 7.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
  - [✅]* 10.2 Update documentation and docs alignment tests
    - Update `README.md` and relevant workflow design docs to document that full design review defaults to all five reviewers, may support user-selected subsets, partial review is not passed review, accept incomplete is explicit, failed reviewer retry preserves artifact binding, and design approval remains separate.
    - Update `tests/unit/docs/workflow-runtime.test.ts` or existing docs tests so public command names, review states, readiness names, and artifact layout references match the implemented behavior.
    - _Requirements: 1.1, 3.3, 5.2, 6.1, 6.3, 7.1, 9.1_
  - [✅]* 10.3 Run full validation suite
    - Run `npm run typecheck`, `npm test`, and `npm run validate-package` from the repository root.
    - Review failures for drift between `design.md`, `requirements.md`, implementation, tests, and documentation before marking the spec complete.
    - _Requirements: 1.1, 2.1, 3.3, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- Each task references requirement IDs from [requirements.md](requirements.md) for traceability.
- The implementation must preserve package-owned reviewer roles, exact design artifact binding, append-only events, workflow path guards, and runtime authority over state transitions and approvals.
- Partial review outputs are useful for status and recovery, but they must never be treated as a passed full review or as automatic design approval.
