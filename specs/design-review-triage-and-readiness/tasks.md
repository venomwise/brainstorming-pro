# Implementation Plan: Design Review Triage and Readiness

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is organized into seven phases: type/schema foundations, source binding and ledger persistence, deterministic clustering/classification, readiness refinement and summary generation, panel/runtime integration, stale validation and recovery integration, and validation/documentation. The execution order starts with strict TypeScript contracts and pure helpers, then wires durable ledger and review panel integration after the triage behavior is testable in isolation. The implementation uses existing TypeScript ES modules under `extensions/clarification-orchestrator/`, existing review ledger/path guard helpers, existing workflow atomic JSON persistence, and Node's built-in test runner.

## Tasks

- [✅] 1. Phase 1: Add triage type contracts and schema foundations
  - [✅] 1.1 Extend design review types with triage report contracts
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts` to add `DesignReviewTriageReport`, `DesignReviewFindingCluster`, `DesignReviewConflict`, `DesignReviewUnresolvedQuestion`, `DesignReviewCoverageSummary`, and `DesignReviewReadinessReport`.
    - Add status unions for triage report status, conflict type/impact, triage level, and recommended next action.
    - Keep existing `DesignReviewFinding`, `DesignReviewAggregateResult`, and `DesignApprovalReadiness` backward-compatible.
    - _Requirements: 1.1, 1.2, 2.2, 3.6, 4.1, 5.1, 6.7_
  - [✅] 1.2 Add source binding input and validation types
    - Add `DesignReviewTriageEngineInput` and `DesignReviewTriageSourceRefs` to `types.ts` or a new `triage-types.ts` re-exported from `types.ts`.
    - Include aggregate path/checksum, optional coverage path/checksum, reviewer result refs, design ref, and review run id.
    - _Requirements: 1.2, 1.3, 1.4, 8.6_
  - [✅] 1.3 Add triage schema validation helpers
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-schemas.ts` with validators for triage report, clusters, conflicts, unresolved questions, and readiness report.
    - Ensure validators reject unknown workflow-authority fields such as approval, planning, state transition, artifact mutation, retry, or accept-incomplete instructions.
    - _Requirements: 2.6, 8.6, 10.1, 10.2, 10.5_
  - [✅]* 1.4 Write type and schema unit tests
    - Add `tests/unit/workflow/design-review-triage-types.test.ts` covering valid report serialization, invalid cluster source ids, invalid readiness actions, and unauthorized authority fields.
    - _Requirements: 1.2, 2.6, 6.7, 10.2_

- [✅] 2. Phase 2: Implement source binding and triage ledger persistence
  - [✅] 2.1 Implement triage source binder
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-source-binding.ts` with `bindDesignReviewTriageSources(...)` and `validateTriageSourceBinding(...)`.
    - Validate that review run id, aggregate design ref, current readiness design ref where available, coverage, and source checksums agree with the exact design artifact binding.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 10.4_
  - [✅] 2.2 Extend review run store with triage persistence
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts` to add `writeTriageReport`, `readTriageReport`, and optional `writeUserSummary` helpers.
    - Use `assertWorkflowPath` and existing atomic JSON write helpers so `triage-report.json` remains under `.workflow/reviews/design/<review-run-id>/`.
    - _Requirements: 8.1, 8.2, 8.3, 8.5_
  - [✅] 2.3 Implement stale triage validation
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-staleness.ts` with `isDesignReviewTriageStale(...)` and `assertFreshDesignReviewTriage(...)`.
    - Compare stored source aggregate checksum, coverage checksum, reviewer result refs, and design artifact checksum against latest durable evidence.
    - _Requirements: 1.4, 1.5, 8.6, 9.2, 9.3, 10.1, 10.4_
  - [✅]* 2.4 Write source binding and ledger tests
    - Add `tests/unit/workflow/design-review-triage-ledger.test.ts` covering triage write/read, path confinement, source checksum mismatch, stale design mismatch, corrupted triage rejection, and ledger write failure behavior.
    - _Requirements: 1.3, 1.4, 1.5, 8.1, 8.2, 8.3, 8.5, 8.6_

- [✅] 3. Checkpoint - Verify triage contracts and durable source binding
  - Run `npm run typecheck` and targeted tests `node --test tests/unit/workflow/design-review-triage-types.test.ts tests/unit/workflow/design-review-triage-ledger.test.ts`.
  - Inspect `types.ts`, `triage-schemas.ts`, `triage-source-binding.ts`, and `review-run-store.ts` to confirm triage cannot be trusted without matching source bindings.
  - Confirm requirements coverage for source binding, stale invalidation, ledger path confinement, and authority-field rejection.
  - Stop only if type errors remain, tests fail, ledger paths can escape the workflow directory, stale triage can be treated as fresh, or generated types conflict with existing design review contracts.
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 8.1, 8.2, 8.3, 8.6, 10.1, 10.2_

- [✅] 4. Phase 3: Implement deterministic clustering, conflict detection, and classification
  - [✅] 4.1 Implement finding deduplication and clustering
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-deduplication.ts` with `clusterDesignReviewFindings(...)`.
    - Normalize title, description, recommendation, affected sections, category, severity, `requiresRevision`, and `userQuestion` signals.
    - Merge only high-confidence duplicate findings, preserve all source finding ids/reviewer roles/evidence/recommendations, and generate deterministic cluster ids.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [✅] 4.2 Implement conflict detection
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-conflicts.ts` with `detectDesignReviewConflicts(...)`.
    - Detect recommendation conflicts, severity disagreements, scope disagreements, and readiness disagreements using clusters and source findings.
    - Mark high-risk security/gate/artifact/state/scope conflicts as blocking approval readiness or should-resolve before revision.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [✅] 4.3 Implement triage classification
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-classification.ts` with `classifyDesignReviewClusters(...)`.
    - Classify clusters into must-fix, should-fix, or note using blocking severity, high-risk non-blocking patterns, user questions, conflict impact, and optional/informational signals.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [✅] 4.4 Implement unresolved question extraction
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-questions.ts` with `extractDesignReviewUnresolvedQuestions(...)`.
    - Group duplicate/equivalent questions, preserve source finding ids, and mark questions blocking when they affect scope, architecture, requirements, data model, security, lifecycle gates, or approval safety.
    - _Requirements: 5.1, 5.2, 5.3_
  - [✅]* 4.5 Write clustering, conflict, and classification tests
    - Add `tests/unit/workflow/design-review-triage-deduplication.test.ts`, `tests/unit/workflow/design-review-triage-conflicts.test.ts`, and `tests/unit/workflow/design-review-triage-classification.test.ts`.
    - Cover duplicate merge, ambiguous non-merge, highest severity, deterministic ids, all conflict types, high-risk conflict impact, must-fix promotion, should-fix classification, notes, and blocking questions.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3_

- [✅] 5. Phase 4: Implement coverage-aware readiness and deterministic summary
  - [✅] 5.1 Implement coverage summary builder
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-coverage.ts` with `buildDesignReviewCoverageSummary(...)`.
    - Preserve selected/unselected/succeeded/failed/pending retry semantics and identify incomplete coverage only when selected reviewers failed and at least one selected reviewer succeeded.
    - _Requirements: 5.4, 5.5, 5.6_
  - [✅] 5.2 Implement enhanced readiness builder
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-readiness.ts` with `buildDesignReviewReadinessReport(...)`.
    - Implement skipped, failed, incomplete, blocked, and ready-for-user-approval matrix from the design, including recommended next actions.
    - Ensure accepted incomplete remains represented as incomplete coverage rather than fully passed review.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_
  - [✅] 5.3 Implement deterministic user-facing summary
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage-summary.ts` with `buildDesignReviewUserFacingSummary(...)`.
    - Include counts/implications for must-fix, should-fix, notes, conflicts, unresolved questions, and incomplete coverage.
    - Avoid approval wording when readiness is blocked, incomplete, failed, skipped, or stale.
    - _Requirements: 7.1, 7.2, 7.3_
  - [✅] 5.4 Implement the triage engine orchestration
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/triage.ts` with `buildDesignReviewTriageReport(...)`.
    - Compose source binding, clustering, conflicts, classification, unresolved questions, coverage summary, readiness report, deterministic summary, and triage validation.
    - Return a complete `DesignReviewTriageReport` without mutating artifacts, approvals, review decisions, retry state, or workflow state.
    - _Requirements: 1.1, 1.6, 2.1, 3.6, 4.1, 5.1, 6.1, 7.1, 10.5_
  - [✅]* 5.5 Write readiness and summary tests
    - Add `tests/unit/workflow/design-review-triage-readiness.test.ts` and `tests/unit/workflow/design-review-triage-summary.test.ts`.
    - Cover skipped caveat, failed readiness, incomplete without blockers, incomplete with blockers, must-fix blocking, ready-for-user-approval without approval, accepted-incomplete truthfulness, deterministic summary wording, and no approval implication for unsafe statuses.
    - _Requirements: 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3_

- [✅] 6. Checkpoint - Verify deterministic triage semantics
  - Run `npm run typecheck` and targeted tests `node --test tests/unit/workflow/design-review-triage-deduplication.test.ts tests/unit/workflow/design-review-triage-conflicts.test.ts tests/unit/workflow/design-review-triage-classification.test.ts tests/unit/workflow/design-review-triage-readiness.test.ts tests/unit/workflow/design-review-triage-summary.test.ts`.
  - Inspect clustering/classification rules to confirm false-positive merges are conservative and no source finding is dropped.
  - Confirm incomplete review never becomes ready-for-user-approval and summary text never implies approval for blocked/incomplete/failed/stale reports.
  - Stop only if deterministic output is unstable, blockers can be hidden, incomplete review can be treated as passed, or user-facing summary contradicts structured readiness.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.5, 4.1, 4.2, 4.3, 5.6, 6.3, 6.4, 6.5, 6.6, 7.3_

- [✅] 7. Phase 5: Integrate triage with review panel, retry, and status paths
  - [✅] 7.1 Run triage after initial design review aggregation
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts` to call `buildDesignReviewTriageReport(...)` after aggregate/readiness are durably created for minimal, full, partial, skipped, failed, and unavailable-compatible paths where source data is valid.
    - Write `triage-report.json` through `writeTriageReport` before returning enhanced readiness metadata to the adapter.
    - _Requirements: 1.1, 1.6, 8.1, 8.5, 9.1_
  - [✅] 7.2 Refresh triage after failed reviewer retry
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/retry-failed-reviewers.ts` to invalidate/rebuild triage whenever retry updates effective reviewer results, coverage, aggregate, or readiness.
    - Ensure old triage source checksum mismatch prevents stale readiness from being exposed.
    - _Requirements: 1.4, 1.5, 8.6, 9.2_
  - [✅] 7.3 Preserve accept-incomplete semantics with triage
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/accept-incomplete.ts` and/or status helpers only as needed to read triage truthfully while preserving Spec 5.2 accept-incomplete decision semantics.
    - Ensure accepted incomplete can move only to awaiting design approval and triage still reports incomplete coverage.
    - _Requirements: 6.8, 9.5, 9.6, 10.5, 10.6_
  - [✅] 7.4 Expose triage summaries through adapter/status outputs
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review.ts`, `extensions/clarification-orchestrator/workflow/runtime.ts`, and relevant `extensions/clarification-orchestrator/tui/` status helpers to include triage summary, tiers, conflicts, unresolved questions, and enhanced readiness when available and fresh.
    - Preserve existing public command surface and approval gate behavior.
    - _Requirements: 7.1, 7.2, 8.6, 9.3, 9.4, 9.5, 9.6_
  - [✅]* 7.5 Write integration tests for panel/runtime triage
    - Add `tests/integration/design-review-triage-and-readiness.test.ts` covering full pass with triage, duplicate blockers, conflicts, custom subset partial, partial blocker rejection, retry rebuild, and design artifact staleness.
    - Update unit tests for `panel.ts`, `retry-failed-reviewers.ts`, and status helpers where existing fixtures need triage fields.
    - _Requirements: 1.1, 1.4, 1.5, 6.3, 6.4, 6.6, 8.1, 9.1, 9.2, 9.3, 9.4_

- [✅] 8. Phase 6: Harden security boundaries and optional summary guardrails
  - [✅] 8.1 Enforce triage authority boundaries
    - Add validation in `triage.ts`, `triage-schemas.ts`, and status integration so triage files cannot approve design, start planning, mutate artifacts, record review decisions, retry reviewers, or accept incomplete.
    - Cross-check triage claims against aggregate findings, coverage, reviewer results, design checksum, and state/event data before exposing readiness.
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6_
  - [✅] 8.2 Add optional summary-agent boundary as disabled extension point
    - If a future summary agent seam is added, keep it disabled by default or internal-only in `triage-summary.ts`.
    - Validate that any summary output is prose-only and cannot alter structured report fields; fallback to deterministic summary on failure.
    - _Requirements: 7.4, 7.5, 10.3_
  - [✅]* 8.3 Write security tests
    - Add `tests/security/design-review-triage-and-readiness.test.ts` covering spoofed design refs/checksums, hidden blockers, crafted readiness, crafted coverage, path traversal, optional summary mutation, stale aggregate reuse, and attempts to approve/start planning from triage.
    - _Requirements: 8.3, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

- [✅] 9. Checkpoint - Verify runtime authority and stale-readiness safety
  - Run `npm run typecheck` and targeted tests `node --test tests/integration/design-review-triage-and-readiness.test.ts tests/security/design-review-triage-and-readiness.test.ts tests/unit/workflow/design-review-triage-ledger.test.ts`.
  - Inspect runtime/status integration to confirm stale triage cannot drive approval readiness and triage never calls approval, planning, retry, accept-incomplete, or artifact commit helpers.
  - Confirm existing design approval gate tests still pass and readiness remains advisory only.
  - Stop only if triage can bypass runtime authority, stale reports can be trusted, crafted files can hide blockers, or approval/planning can occur without existing gates.
  - _Requirements: 1.5, 6.7, 6.8, 8.6, 9.3, 9.6, 10.1, 10.2, 10.4, 10.5, 10.6_

- [✅] 10. Phase 7: Documentation alignment and full validation
  - [✅]* 10.1 Update docs and design review documentation
    - Update `README.md` and relevant workflow docs/tests to mention must-fix/should-fix/note summaries, incomplete coverage truthfulness, stale triage invalidation, and readiness-not-approval semantics if public docs expose design review status.
    - Update `tests/unit/docs/workflow-runtime.test.ts` or related docs tests for new ledger file `triage-report.json` and status wording.
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 9.4, 9.5, 9.6_
  - [✅]* 10.2 Run full validation suite
    - Run `npm run typecheck`, `npm test`, and `npm run validate-package` from the repository root.
    - Review failures for drift between `design.md`, `requirements.md`, `tasks.md`, implementation, tests, and documentation before marking the spec complete.
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- Each task references requirement IDs from [requirements.md](requirements.md) for traceability.
- The MVP should prefer deterministic summary only. Agent-generated summary must not be implemented unless structural guardrails are fully tested.
- Triage readiness is advisory and must remain separate from design approval. Existing runtime state-machine and approval gate checks remain authoritative.
- False-negative deduplication is safer than false-positive deduplication: when uncertain, keep findings separate.
