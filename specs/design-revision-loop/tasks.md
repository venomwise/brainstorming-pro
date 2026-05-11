# Implementation Plan: Design Revision Loop

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is split into eight phases. It starts with schemas and durable ledger helpers because every later runtime action must be version-bound and auditable. It then adds eligibility, user-question gating, reviser adapter prompts, output validation, artifact commit/stale invalidation, post-revision re-review scheduling, and runtime/status recovery integration. Tests are included at each major boundary to preserve fail-closed behavior and prevent approval/review gate bypasses.

## Tasks

- [✅] 1. Phase 1: Add revision schemas and type contracts
  - [✅] 1.1 Define design revision domain types
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts`
    - Add `DesignRevisionAuthorization`, `DesignRevisionRequest`, `DesignRevisionUserAnswer`, `DesignRevisionRoundPolicy`, `DesignRevisionOutput`, `DesignRevisionRecord`, and revision status union types
    - Reuse existing `VersionedArtifactRef`, `FullDesignReviewerRole`, and design review/triage types instead of duplicating them
    - _Requirements: 1.1, 1.2, 5.1, 8.3, 9.1_
  - [✅] 1.2 Implement schema validators for revision records
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/schemas.ts`
    - Implement `validateDesignRevisionAuthorization`, `validateDesignRevisionRequest`, `validateDesignRevisionOutput`, `validateDesignRevisionRecord`, and `rejectUnauthorizedRevisionDirectives`
    - Reject unauthorized keys or directives for approval, planning, state mutation, review retry, accept-incomplete, and direct artifact commits
    - _Requirements: 1.4, 5.5, 6.1, 6.4, 11.1, 11.3_
  - [✅] 1.3 Add revision constants and defaults
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/constants.ts`
    - Define default cumulative limits such as `DEFAULT_MAX_TOTAL_DESIGN_REVISION_ROUNDS` and `DEFAULT_MAX_TOTAL_POST_REVISION_REVIEW_ROUNDS`
    - Define required design template heading names used by validation
    - _Requirements: 4.1, 4.2, 6.2_
  - [✅]* 1.4 Write schema validation unit tests
    - Add `tests/unit/workflow/design-revision-schemas.test.ts`
    - Cover valid authorization/request/output/record objects, consumed authorization rejection, unauthorized directive rejection, unknown item ID validation inputs, and malformed status fields
    - _Requirements: 1.2, 1.4, 5.5, 6.1, 11.1_

- [✅] 2. Phase 2: Implement revision ledger and source binding helpers
  - [✅] 2.1 Implement revision ledger path helpers
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/ledger.ts`
    - Add `getDesignRevisionLedgerPaths(topicDir, revisionId)` with strict path containment under `.workflow/revisions/design/<revision-id>/`
    - Add helpers to write/read `authorization.json`, `request.json`, `prompt.md`, `system-prompt.md`, `child-result.json`, `output.json`, `validation.json`, and `record.json`
    - _Requirements: 9.1, 9.2, 9.3, 11.2, 11.4_
  - [✅] 2.2 Add checksum and source evidence binding utilities
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/source-binding.ts`
    - Implement helpers that verify source design, review run, triage report, readiness report, coverage refs, and checksums are bound to the same design artifact
    - Reuse existing artifact/review checksum helpers where available and fail closed on missing/corrupt files
    - _Requirements: 1.5, 2.1, 2.2, 2.6, 11.4_
  - [✅] 2.3 Add revision event helpers
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/events.ts`
    - Add event payload builders for revision authorized, started, needs-user-input, failed, committed, stale invalidated, post-review scheduled, and post-review completed
    - Integrate with existing `extensions/clarification-orchestrator/workflow/events.ts` without changing append-only semantics
    - _Requirements: 9.4, 9.5, 9.6_
  - [✅]* 2.4 Write ledger and source binding tests
    - Add `tests/unit/workflow/design-revision-ledger.test.ts`
    - Test path traversal rejection, safe ledger writes/reads, checksum mismatch fail-closed behavior, and corrupted ledger resume/status handling
    - _Requirements: 2.2, 2.6, 9.1, 9.6, 11.2, 11.4_

- [✅] 3. Phase 3: Implement eligibility, round policy, and user-question gating
  - [✅] 3.1 Implement `RevisionRoundPolicy`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/round-policy.ts`
    - Count prior committed revision records and post-revision review records for the current topic/workflow
    - Return `revision-exhausted` before child execution when cumulative limits are exhausted
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [✅] 3.2 Implement `UserQuestionGate`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/user-questions.ts`
    - Classify triage unresolved questions as `requires-user-answer-before-revision`, `reviser-can-address`, or `carry-forward`
    - Validate supplied `DesignRevisionUserAnswer` entries against known question IDs
    - Return `needs-user-input` without child execution when blocking questions lack answers
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
  - [✅] 3.3 Implement `RevisionEligibilityEvaluator`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/eligibility.ts`
    - Validate latest design artifact binding, usable review/triage/readiness evidence, actionable finding/user instruction presence, workflow phase allowance, and round policy
    - Return explicit denial reasons for stale source, no actionable input, failed review evidence, path escape, and exhausted rounds
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.3, 10.1_
  - [✅]* 3.4 Write eligibility and question gate tests
    - Add `tests/unit/workflow/design-revision-eligibility.test.ts`
    - Cover actionable must-fix input, no actionable input, failed review without triage, stale design refs, missing user answers, unknown answer IDs, and cumulative limit exhaustion
    - _Requirements: 2.1, 2.4, 2.5, 3.2, 3.5, 4.3_

- [✅] 4. Phase 4: Build reviser request, prompts, adapter, and output validation
  - [✅] 4.1 Implement revision request builder
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/request-builder.ts`
    - Extract must-fix cluster IDs, should-fix cluster IDs, conflict IDs, unresolved question IDs, user answers, user instructions, round policy, and post-revision review settings from validated inputs
    - Write `request.json` through the revision ledger before child execution
    - _Requirements: 5.1, 9.2, 10.2_
  - [✅] 4.2 Implement package-owned reviser prompt templates
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/prompts.ts`
    - Build prompt/system prompt text that instructs the reviser to produce complete revised design markdown plus structured metadata only
    - Explicitly forbid requirements/tasks generation, approvals, review decisions, planning, direct file writes, state mutation, and guessing unanswered user questions
    - _Requirements: 5.2, 5.4, 11.1, 11.3, 11.6_
  - [✅] 4.3 Implement `DesignReviserAdapter`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/reviser-adapter.ts`
    - Invoke `runAgent()` from the controlled agent execution runtime with package-owned role configuration, `--no-session`, `--no-skills`, bounded output, and structured output validation
    - Persist prompt, system prompt, child result, and parsed output to the revision ledger
    - _Requirements: 5.2, 5.3, 5.5, 9.2, 9.3_
  - [✅] 4.4 Implement revised design validator
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/validator.ts`
    - Validate required design headings, non-empty complete markdown, output size, source item ID references, absence of approval/planning claims, and absence of requirements/tasks substitution
    - Produce `validation.json` with pass/fail diagnostics
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [✅]* 4.5 Write adapter and validator tests
    - Add `tests/unit/workflow/design-revision-adapter.test.ts`
    - Use fake child execution to cover successful structured output, timeout/failure, malformed JSON, forbidden directives, missing headings, unknown resolved IDs, and unchanged previous design on failure
    - _Requirements: 5.3, 5.5, 6.1, 6.3, 6.6, 11.3_

- [✅] 5. Phase 5: Implement revision controller, artifact commit, and stale invalidation
  - [✅] 5.1 Implement `DesignRevisionController`
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/controller.ts`
    - Orchestrate authorization validation, eligibility, user-question gate, request building, reviser execution, output validation, artifact commit request, ledger record updates, and events
    - Ensure the controller never approves design, enters planning, or writes workflow state truth directly
    - _Requirements: 1.3, 1.4, 2.1, 3.2, 5.5, 9.4, 11.1_
  - [✅] 5.2 Integrate runtime-owned design artifact commit
    - Extend existing artifact commit flow in `extensions/clarification-orchestrator/workflow/runtime.ts` or add a dedicated helper in `extensions/clarification-orchestrator/workflow/adapters/design-revision/artifact-commit.ts`
    - Commit revised markdown as a new `design` artifact version and mirror it to `specs/<topic>/design.md`
    - Leave previous design authoritative if commit fails
    - _Requirements: 7.1, 7.2, 7.5_
  - [✅] 5.3 Implement stale review invalidation checks
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/staleness.ts`
    - Mark source review/triage/readiness as provenance only after revised design commit
    - Update or extend approval validation so old review evidence cannot approve the revised design ref
    - _Requirements: 7.3, 7.4, 11.4_
  - [✅] 5.4 Write revision records for all terminal statuses
    - Ensure `record.json` is written for `committed`, `needs-user-input`, `blocked`, `failed`, `revision-exhausted`, and `stale-source`
    - Include source design ref, target design ref when present, source review run, post-revision review run when present, source triage checksum, resolved/unresolved IDs, and change summary
    - _Requirements: 9.3, 9.4, 10.3_
  - [✅]* 5.5 Write controller and stale invalidation tests
    - Add `tests/unit/workflow/design-revision-controller.test.ts`
    - Cover successful commit, artifact commit failure, stale source rejection, needs-user-input, revision-exhausted, old review approval rejection, and terminal record writes
    - _Requirements: 1.5, 3.2, 4.3, 7.2, 7.3, 7.4, 9.3_

- [✅] 6. Phase 6: Add post-revision re-review and runtime recovery integration
  - [✅] 6.1 Implement post-revision review scheduler
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-revision/post-review.ts`
    - Schedule exactly one design review for the newly committed design artifact using the authorization's review mode and selected reviewer roles
    - Create a new review decision bound to the revised design artifact and link it to the revision authorization/record
    - _Requirements: 8.1, 8.2, 8.3, 9.4_
  - [✅] 6.2 Wire post-review result handling into runtime
    - Modify `extensions/clarification-orchestrator/workflow/runtime.ts` and/or `extensions/clarification-orchestrator/workflow/adapters/design-review.ts` to return post-revision review outcomes to a user decision point
    - Ensure passed post-revision review reaches only `awaiting-design-approval`, while blocked/partial/failed/unavailable outcomes expose recovery actions without another automatic revision
    - _Requirements: 8.4, 8.5, 8.6, 10.3, 10.6_
  - [✅] 6.3 Extend recovery action types for revision
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts` and `extensions/clarification-orchestrator/workflow/types.ts` as needed
    - Add `revise-design-once`, user-question answer, and post-revision handoff action metadata while preserving Spec 5.2 retry/accept-incomplete/replace-selection actions
    - _Requirements: 10.1, 10.2, 10.4, 10.5_
  - [✅] 6.4 Update resume/status rendering hooks
    - Modify `extensions/clarification-orchestrator/workflow/runtime.ts` and TUI/status helpers under `extensions/clarification-orchestrator/tui/` if needed
    - Display revised design ref, post-revision review run, triage/readiness summary, blocking question IDs, and available next actions
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_
  - [✅]* 6.5 Write post-review and recovery integration tests
    - Add `tests/integration/design-revision-loop.test.ts`
    - Cover revision commit followed by exactly one re-review, passed re-review stopping at approval gate, blocked re-review not auto-revising, and latest design requiring new authorization for another revision
    - _Requirements: 1.6, 8.1, 8.5, 8.6, 10.3, 10.4_

- [✅] 7. Checkpoint - Verify revision lifecycle and gate safety
  - Run `npm run typecheck`
  - Run targeted tests for design revision schemas, ledger, eligibility, adapter, controller, post-review integration, and approval stale-evidence checks
  - Inspect `specs/design-revision-loop/requirements.md` and confirm implemented behavior satisfies requirement IDs 1.1 through 11.6 without adding plan review, planning, execution, or automatic approval
  - Stop only if typecheck fails, tests fail, stale review evidence can approve a revised design, one authorization can trigger multiple revisions, or implementation requires changing approved requirements

- [ ] 8. Phase 8: Documentation, validation, and package alignment
  - [✅] 8.1 Update roadmap and local design docs for implemented semantics
    - Review `specs/brainstorming-pro-refactor-roadmap/design.md` and `specs/design-revision-loop/design.md` for consistency with final implementation names, statuses, ledger paths, and recovery actions
    - Ensure docs state that one authorization permits one revision plus one re-review only
    - _Requirements: 1.2, 1.6, 8.6, 10.4_
  - [✅] 8.2 Update public README/status documentation if runtime UX output changes
    - Modify `README.md` only if user-visible `/brainstorm-pro --resume` or `--status` output changes
    - Document revised design handoff, post-revision review result display, and approval remaining separate
    - _Requirements: 10.1, 10.3, 10.6_
  - [✅] 8.3 Add security regression tests
    - Add `tests/security/design-revision-loop.test.ts`
    - Cover crafted triage checksum mismatch, path traversal in revision ledger refs, stale artifact reuse, unauthorized approval/planning directives, and direct mutation attempts in reviser output
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_
  - [ ] 8.4 Final validation
    - Run `npm run typecheck && npm test && npm run validate-package`
    - Confirm revision-related docs, requirements, tasks, tests, and implementation remain aligned
    - Confirm no executable derived helpers are added under `vendor/pi-subagents/` and no generic subagent command/tool is introduced
    - _Requirements: 9.4, 10.5, 11.1, 11.2_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- Each task references requirement IDs for traceability.
- Tests are marked optional according to the spec-plan format, but this repository expects meaningful unit/integration/security coverage before completion.
- The implementation must preserve the central rule: one user authorization permits one revision attempt and one post-revision re-review, never automatic approval or another revision.
