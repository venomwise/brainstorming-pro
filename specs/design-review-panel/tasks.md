# Implementation Plan: Design Review Panel

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

## Overview

Build the design review panel foundation in three implementation phases. First define stable review contracts, artifact binding, and ledger persistence so every review run is version-bound and auditable. Next implement the real `minimal` review path, including controlled agent execution, finding normalization, aggregation, readiness evaluation, and adapter integration. Finally add the explicit `full` review capability boundary and extension hooks needed by the follow-up full reviewer, triage, and revision-loop specs.

The execution order keeps persistence and safety primitives ahead of reviewer execution. The runtime must be able to reject stale design refs and write durable review runs before a child reviewer is allowed to produce findings. Full review remains intentionally unavailable in this spec, but its contract is implemented so Spec 5.1 can add reviewer roles without changing the workflow gate semantics.

## Tasks

- [✅] 1. Phase 1: Define review panel contracts, artifact binding, and ledger persistence
  - [✅] 1.1 Create the design review type system
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts` with `DesignReviewMode`, `DesignReviewPanelRequest`, `DesignReviewPanelResult`, `DesignReviewPanelStatus`, `DesignReviewerRole`, `DesignReviewRun`, `DesignReviewFinding`, `DesignReviewAggregateResult`, and `DesignApprovalReadiness`
    - Define `full-review-unavailable` and `reviewer-role-pack-missing` as explicit unavailable reasons
    - Ensure all persisted types carry `VersionedArtifactRef` for the exact reviewed design artifact
    - _Requirements: 1.1, 1.4, 1.6, 2.1, 2.4, 7.1, 7.2_
  - [✅] 1.2 Implement review mode resolution
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/mode.ts` with `resolveDesignReviewMode()` and `assertSupportedDesignReviewMode()`
    - Enforce `skip`, `minimal`, and `full` semantics from the recorded review decision
    - Reject unknown modes and prevent `full` from falling back to `minimal` or `skip`
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 6.3, 7.5_
  - [✅] 1.3 Implement exact design artifact binding
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/artifact-binding.ts` with `bindDesignArtifactForReview()` and `assertDesignReviewDecisionFresh()`
    - Load and verify the exact latest `design` artifact ref from workflow state and artifact store helpers
    - Reject missing, unreadable, empty, checksum-mismatched, stale, or topic-escaping design artifacts
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 6.1, 6.4_
  - [✅] 1.4 Implement the review run ledger store
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts` with `createDesignReviewRun()`, `writeDesignReviewRun()`, `writeReviewerResult()`, `writeAggregatedFindings()`, and `writeReadiness()`
    - Persist review data under `specs/<topic>/.workflow/reviews/design/<review-run-id>/`
    - Ensure all ledger paths are topic-scoped and written atomically where existing helpers support it
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 6.5_
  - [✅]* 1.5 Add unit tests for contracts, mode resolution, binding, and ledger persistence
    - Add `tests/unit/workflow/design-review-panel-types.test.ts`, `tests/unit/workflow/design-review-mode.test.ts`, `tests/unit/workflow/design-review-artifact-binding.test.ts`, and `tests/unit/workflow/design-review-ledger.test.ts`
    - Test valid modes, invalid modes, explicit full unavailable, stale decision rejection, checksum mismatch rejection, path traversal rejection, and ledger layout creation
    - _Requirements: 1.1, 1.4, 1.5, 2.2, 2.3, 5.1, 5.2, 6.1, 6.3_

- [✅] 2. Checkpoint - Verify review foundation safety
  - Run `npm run typecheck` and the new Phase 1 unit tests
  - Inspect `.workflow/reviews/design/<review-run-id>/` fixture output from tests to confirm `review-run.json` contains mode, exact design ref, status, timestamps, and topic-scoped paths
  - Confirm stale design refs, checksum mismatches, unknown modes, and path escapes fail before reviewer execution
  - Stop only if persistence, artifact binding, or mode semantics do not satisfy the referenced acceptance criteria
  - _Requirements: 1.1, 1.5, 2.1, 2.2, 2.3, 5.1, 5.2, 6.1_

- [✅] 3. Phase 2: Implement minimal review execution and runtime adapter integration
  - [✅] 3.1 Add the minimal review prompt and schema
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/minimal-review.ts` with `buildMinimalDesignReviewPrompt()` and `buildMinimalDesignReviewSystemPrompt()`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/schemas.ts` with `minimalDesignReviewOutputSchema` and canonical finding validators
    - Ensure the prompt instructs the reviewer to return findings only and never approve, mutate state, or edit artifacts
    - _Requirements: 3.1, 3.2, 3.5, 3.6_
  - [✅] 3.2 Implement reviewer coordination for minimal mode
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-coordinator.ts` with `runDesignReviewers()` and `runMinimalDesignReviewer()`
    - Invoke `runAgent()` with role `minimal-reviewer`, phase `design-review`, the design-review prompt, and the minimal review output schema
    - Convert timeout, non-zero exit, and invalid-output agent results into structured review failures
    - _Requirements: 1.3, 3.1, 3.2, 4.6, 6.2_
  - [✅] 3.3 Implement finding normalization
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/finding-normalizer.ts` with `normalizeDesignReviewFindings()`
    - Inject `reviewRunId`, `designRef`, and `reviewerRole` into every canonical finding
    - Reject malformed findings and unauthorized approval/state/artifact directives from reviewer output
    - _Requirements: 3.3, 3.4, 3.5, 6.4, 7.3_
  - [✅] 3.4 Implement aggregation and readiness evaluation
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/aggregation.ts` with `aggregateDesignReviewFindings()`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/readiness.ts` with `evaluateDesignApprovalReadiness()`
    - Mark reviews with blocking findings as `blocked`, reviews with no blocking findings as `passed`, skipped reviews as `skipped-by-user`, unavailable reviews as `not-ready`, and failed reviews as `failed`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [✅] 3.5 Implement the panel orchestrator
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts` with `runDesignReviewPanel()`
    - Compose mode resolution, artifact binding, review run creation, minimal reviewer execution, finding normalization, aggregation, readiness, and ledger writes
    - Return a `DesignReviewPanelResult` without mutating workflow state directly
    - _Requirements: 1.1, 1.3, 1.6, 2.4, 3.6, 5.2, 5.5_
  - [✅] 3.6 Wire the existing design review adapter to the panel
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review.ts` so `run()` builds a panel request and `commit()` maps panel statuses to runtime review status patches
    - Preserve explicit `skip` behavior and move to `awaiting-design-approval` only for `skipped` or `passed` results
    - Keep `blocked`, `failed`, and `unavailable` from being committed as approval-ready
    - _Requirements: 1.2, 1.3, 1.4, 4.2, 4.3, 4.4, 4.5, 6.3_
  - [✅]* 3.7 Add unit and integration tests for minimal review behavior
    - Add `tests/unit/workflow/design-review-panel.test.ts` and update `tests/unit/workflow/adapters/design-review.test.ts`
    - Add or update `tests/integration/design-review-panel.test.ts` for start → design → review decision → minimal review → awaiting design approval
    - Test no blocking findings, blocking findings, invalid reviewer output, reviewer timeout/failure, skipped review, and runtime phase behavior for each result
    - _Requirements: 1.2, 1.3, 3.2, 3.3, 4.2, 4.3, 4.6, 5.5, 6.2_

- [✅] 4. Checkpoint - Verify minimal design review path and fail-closed behavior
  - Run `npm run typecheck`, targeted design-review unit tests, and the design-review integration tests
  - Confirm `minimal` review writes `review-run.json`, `reviewer-results/minimal-reviewer.json`, `aggregated-findings.json`, and `readiness.json`
  - Confirm passed minimal reviews reach `awaiting-design-approval`, while blocking, failed, stale, and unavailable reviews do not
  - Confirm reviewer output cannot approve design, mutate workflow state, or commit artifacts
  - Stop only if any referenced requirement fails or implementation would require changing the approved design
  - _Requirements: 1.3, 1.6, 3.1, 3.5, 4.1, 4.2, 4.3, 5.2, 6.1, 6.2_

- [✅] 5. Phase 3: Add full-review capability boundary and future extension hooks
  - [✅] 5.1 Implement explicit full-review unavailable behavior
    - Extend `extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-coordinator.ts` with `resolveFullDesignReviewerSet()` or equivalent capability check
    - Return `status = "unavailable"` and `unavailableReason = "full-review-unavailable"` when the full reviewer pack is not registered
    - Write unavailable review runs to the same ledger layout used by skip and minimal modes
    - _Requirements: 1.4, 4.5, 6.3, 7.1, 7.5_
  - [✅] 5.2 Add stable extension contracts for Spec 5.1, Spec 5.2, and Spec 5.3
    - Add exported types or interfaces for full reviewer role registration, triage input, readiness refinement input, and design revision request input in `extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts`
    - Ensure these extension contracts consume canonical findings and ledger records rather than redefining schemas
    - Keep the extension contracts internal to Brainstorming Pro and do not expose a public subagent or review command
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [✅]* 5.3 Add tests for full unavailable and extension stability
    - Test selecting `full` writes an unavailable review run and does not enter `awaiting-design-approval`
    - Test no fallback from `full` to `minimal` or `skip` occurs even when minimal review is available
    - Test exported extension contracts compile against representative fake full-reviewer and triage inputs
    - _Requirements: 1.4, 4.5, 6.3, 7.1, 7.2, 7.3_
  - [✅]* 5.4 Update documentation and docs-alignment tests
    - Update `README.md` or workflow docs only if public status/resume output changes need documentation
    - Update `tests/unit/docs/workflow-runtime.test.ts` if documented design review behavior changes
    - Document that `minimal` review is real, `full` is explicitly unavailable until Spec 5.1, and readiness is not approval
    - _Requirements: 4.4, 4.5, 5.5, 7.1_

- [✅] 6. Checkpoint - Verify complete Spec 5 foundation
  - Run `npm run typecheck && npm test && npm run validate-package`
  - Inspect review ledger fixture output for skip, minimal-passed, minimal-blocked, minimal-failed, and full-unavailable cases
  - Confirm all review decisions and review runs bind exact design artifact versions and checksums
  - Confirm review panel code does not expose a public subagent command/tool and does not mutate approval or workflow state outside the adapter/runtime contract
  - Confirm tasks completed for this spec do not implement Spec 5.1 full reviewer prompts, Spec 5.2 advanced triage, or Spec 5.3 automatic revision loop
  - _Requirements: 1.1, 1.4, 2.1, 2.4, 3.5, 4.2, 4.5, 5.1, 5.2, 6.1, 6.3, 7.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- Each task references one or more requirement IDs for traceability.
- Keep task numbering stable so requirement references remain valid.
- Spec 5 intentionally implements the full-review contract but not the full reviewer role pack. The actual full reviewer implementation belongs to Spec 5.1 `design-reviewer-role-pack`.
- Review readiness is not design approval. The workflow runtime must still require the design approval gate after a skipped or passed review.
