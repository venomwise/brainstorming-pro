# Requirements Document: Design Review Execution Control

## Introduction

Design Review Execution Control extends the Brainstorming Pro workflow-owned design review runtime so full design review can be executed with a user-selected full reviewer subset, recover from partial reviewer failures, retry failed reviewers, and record explicit user acceptance of an incomplete review when safe. It solves the reliability problem where one transient reviewer failure currently causes the whole full review to fail closed even though successful reviewer findings may still be useful.

The system operates inside the existing `/brainstorm-pro` workflow, design review panel, review ledger, event log, and artifact binding model. It is in scope to define runtime-owned reviewer selection, coverage, partial aggregation, retry attempts, accept-incomplete gating, ledger/event persistence, and resume/status recovery contracts. It is out of scope to implement reviewer prompts or role registration, advanced triage, design revision loops, plan review, design approval automation, or polished public UX beyond the recovery contract.

## Glossary

- **Accept-incomplete gate**: A runtime-owned decision gate that records a user's explicit choice to proceed from a partial full design review to the separate design approval gate when safety conditions are satisfied.
- **Design artifact binding**: The exact `design.md` artifact reference, version, and checksum attached to a review decision, review run, retry, or accept-incomplete decision.
- **Design review decision**: The workflow record that captures the user's review mode choice and, for full review, the selected full reviewer roles bound to the exact design artifact.
- **Full reviewer**: One of the package-owned design review roles: Product, Architecture, Risk / Security, Testing, or Scope / Simplicity.
- **Full reviewer subset**: One or more selected full reviewers chosen by the user for a full design review instead of the default complete five-reviewer set.
- **Incomplete review**: A partial full design review with at least one succeeded selected reviewer and at least one failed selected reviewer.
- **Partial aggregation**: Aggregation of normalized findings from successful reviewers only, while failed reviewer diagnostics remain separate from findings.
- **Readiness**: The review-derived status that describes whether design approval can be requested, is blocked, failed, skipped, not ready, or incomplete.
- **Recovery action**: A resume/status action exposed by the runtime, such as retrying failed reviewers, accepting an incomplete review, replacing reviewer selection, or viewing the ledger.
- **Review coverage**: The selected, unselected, succeeded, failed, and pending-retry reviewer sets for a design review run.
- **Review ledger**: Durable files under `specs/<topic>/.workflow/reviews/design/<review-run-id>/` containing review run metadata, attempts, reviewer results, coverage, aggregates, readiness, and accept-incomplete decisions.
- **Workflow runtime authority**: The invariant that the orchestrator, not reviewer output, the review panel, or a parent LLM implication, owns workflow state transitions, approvals, review decisions, and artifact mutation.

## Requirements

### Requirement 1: Full Reviewer Selection Decision Model

**User Story:** As a workflow user, I want full design review to support a selected reviewer subset, so that I can focus review effort while preserving exact artifact binding and auditability.

#### Acceptance Criteria

1. WHEN the user selects `full` design review without `selectedReviewerRoles`, THEN the system SHALL resolve the selection to all five registered full reviewers.
2. WHEN the user selects `full` design review with one or more valid full reviewer roles, THEN the system SHALL bind exactly that ordered subset to the review decision and the current design artifact version/checksum.
3. WHEN the review mode is `skip` or `minimal`, THEN the system SHALL reject any full reviewer selection fields on the decision.
4. IF the selected reviewer list is empty, contains duplicates, contains an unknown role, contains `minimal-reviewer`, references an unregistered role, or references a role not allowed for the `design-review` phase, THEN the system SHALL reject the decision before creating a review run.
5. IF the bound design artifact version or checksum changes after reviewer selection is recorded, THEN the system SHALL treat the selection as stale and require a new review decision for the latest design artifact.
6. WHEN a selection is resolved, THEN the system SHALL record selected and unselected reviewer roles deterministically for ledger output and status/resume recovery.

### Requirement 2: Stable Review Coverage Model

**User Story:** As a maintainer, I want durable reviewer coverage for each review run, so that partial results, retries, and status displays have unambiguous semantics.

#### Acceptance Criteria

1. WHEN a full review run starts, THEN the system SHALL initialize coverage with all available reviewers, selected reviewers, unselected reviewers, and empty succeeded, failed, and pending-retry sets.
2. WHEN selected reviewers complete, THEN the system SHALL update coverage so succeeded reviewers are selected reviewers with latest effective successful results and failed reviewers are selected reviewers with latest effective failed results.
3. WHEN a selected reviewer fails and remains retryable, THEN the system SHALL include that reviewer in `pendingRetryReviewers` unless runtime policy says retry is no longer available.
4. WHEN a reviewer is unselected, THEN the system SHALL record the reviewer as unselected and SHALL NOT count it as failed, succeeded, pending retry, or missing coverage.
5. IF coverage input attempts to mark a role outside the stable selected reviewer set as succeeded, failed, or pending retry, THEN the system SHALL reject the coverage update.
6. WHEN coverage is written to the ledger or aggregate, THEN reviewer role ordering SHALL be deterministic and stable across status/resume reads.

### Requirement 3: Partial Review Status and Readiness

**User Story:** As a security or reliability reviewer, I want partial reviews to be clearly different from passed reviews, so that incomplete review cannot be mistaken for approval readiness.

#### Acceptance Criteria

1. WHEN all selected reviewers succeed and no blocking findings exist, THEN the system SHALL set review status to `passed` and readiness to `ready-for-user-approval`.
2. WHEN all selected reviewers succeed and one or more blocking findings exist, THEN the system SHALL set review status to `blocked` and readiness to `blocked`.
3. WHEN at least one selected reviewer succeeds, at least one selected reviewer fails, and successful reviewer findings contain no blocking findings, THEN the system SHALL set review status to `partial` and readiness to `incomplete-review`.
4. WHEN at least one selected reviewer succeeds, at least one selected reviewer fails, and any successful reviewer finding is blocking, THEN the system SHALL set review status to `blocked` and readiness to `blocked`.
5. WHEN all selected reviewers fail, THEN the system SHALL set review status to `failed` and readiness to `failed`.
6. IF the runtime cannot determine the selected/succeeded/failed reviewer sets consistently, THEN the system SHALL fail closed and SHALL NOT produce `ready-for-user-approval`.

### Requirement 4: Partial-Success Aggregation

**User Story:** As a workflow user, I want findings from successful reviewers preserved when other reviewers fail, so that useful feedback is not discarded while failures remain visible.

#### Acceptance Criteria

1. WHEN some selected reviewers succeed and some selected reviewers fail, THEN the system SHALL aggregate normalized findings from successful reviewer results only.
2. WHEN a reviewer fails, THEN the system SHALL write its diagnostics separately and SHALL NOT convert diagnostics into review findings.
3. WHEN an aggregate is produced for a partial review, THEN the system SHALL include review coverage, counts by severity/category/reviewer, findings, summary, status, design reference, and readiness.
4. WHEN no successful reviewer returns findings in a partial review, THEN the system SHALL write an aggregate with empty findings and accurate coverage/counts instead of dropping the partial result.
5. IF a reviewer result fails schema validation or normalization, THEN the system SHALL treat that reviewer as failed and exclude its output from aggregate findings.
6. IF aggregate writing or readiness writing fails, THEN the system SHALL not treat the partial result as durable and SHALL keep the previous effective review state.

### Requirement 5: Retry Failed Reviewers

**User Story:** As a workflow user, I want to retry only failed reviewers, so that transient failures can be recovered without rerunning successful reviewers.

#### Acceptance Criteria

1. WHEN a review run has failed selected reviewers, THEN the system SHALL expose a retry action targeting the current failed reviewers by default.
2. WHEN retry begins, THEN the system SHALL preserve the original `reviewRunId`, stable selected reviewer set, and exact design artifact version/checksum binding.
3. WHEN retry executes, THEN the system SHALL create a new attempt record and run only the targeted failed reviewers by default.
4. WHEN a retry succeeds for a reviewer, THEN the system SHALL update the top-level latest effective reviewer result, recompute coverage, aggregate, and readiness.
5. WHEN a retry fails again for a reviewer, THEN the system SHALL update failed diagnostics, preserve successful effective results, and keep retry available if runtime policy allows.
6. IF the design artifact version/checksum is stale at retry time, THEN the system SHALL reject retry, run no reviewers, and require a new review decision.
7. IF retry ledger persistence or event append fails, THEN the system SHALL not treat retry results as durable and SHALL not advance to approval readiness based on those results.

### Requirement 6: Accept Incomplete Gate

**User Story:** As a workflow user, I want to explicitly accept a safe incomplete full review, so that I can proceed to design approval when retry is unnecessary or unavailable without bypassing audit controls.

#### Acceptance Criteria

1. WHEN readiness is `incomplete-review`, at least one selected reviewer succeeded, at least one selected reviewer failed, no aggregated finding is blocking, the mode is `full`, the design binding is current, and the user explicitly confirms acceptance, THEN the system SHALL write an accept-incomplete decision record and append a corresponding event.
2. WHEN accept incomplete succeeds, THEN the system SHALL keep the review marked incomplete/accepted and may move the workflow only to `awaiting-design-approval`.
3. WHEN accept incomplete succeeds, THEN the system SHALL still require a separate explicit design approval before planning can begin.
4. IF all selected reviewers failed, any aggregated successful finding is blocking, the design artifact is stale, the ledger is missing or corrupted, durable writes fail, the mode is `skip` or `minimal`, or explicit user confirmation is absent, THEN the system SHALL reject accept incomplete.
5. IF accept incomplete is implied or requested by reviewer output, review panel output, parent LLM text, or missing user input, THEN the system SHALL reject it and SHALL NOT write an accept-incomplete decision.
6. WHEN an accept-incomplete decision is written, THEN it SHALL include decision id, review run id, design ref, accepted coverage, successful result references, failed diagnostic references, aggregate reference, `decidedBy: "user"`, optional reason, and timestamp.

### Requirement 7: Review Ledger and Attempt Persistence

**User Story:** As a maintainer, I want review execution control persisted durably, so that audit, status, resume, and tests can reconstruct what happened.

#### Acceptance Criteria

1. WHEN a design review run is created, THEN the system SHALL keep ledger files constrained under `specs/<topic>/.workflow/reviews/design/<review-run-id>/`.
2. WHEN an initial run or retry attempt starts, THEN the system SHALL write an attempt record under `attempts/<attempt-id>/attempt.json` with review run id, design ref, reviewer roles, reason, timestamps, status, succeeded roles, and failed roles.
3. WHEN attempt-level reviewer results are produced, THEN the system SHALL write them under `attempts/<attempt-id>/reviewer-results/<role>.json` and update top-level `reviewer-results/<role>.json` only for latest effective selected reviewer results.
4. WHEN coverage, aggregate, readiness, or accept-incomplete decisions change, THEN the system SHALL write `coverage.json`, `aggregated-findings.json`, `readiness.json`, and `accept-incomplete-decision.json` as applicable.
5. IF any ledger path would escape the workflow directory or expected review ledger layout, THEN the system SHALL reject the operation.
6. IF existing ledger files are missing, corrupted, or inconsistent with state/event data, THEN the system SHALL fail closed and SHALL NOT retry or accept incomplete based on incomplete evidence.

### Requirement 8: Event Log Audit Trail

**User Story:** As a maintainer, I want execution-control actions in the append-only event log, so that mutable ledger files are not the sole source of audit history.

#### Acceptance Criteria

1. WHEN reviewer selection is recorded, THEN the system SHALL append a `design-review-reviewer-selection-recorded` event with decision id, design ref, selected roles, unselected roles, and timestamp.
2. WHEN an attempt starts or completes, THEN the system SHALL append `design-review-attempt-started` and `design-review-attempt-completed` events with review run id, attempt id, reviewer roles, succeeded roles, failed roles, and timestamps as applicable.
3. WHEN a partial result is aggregated, THEN the system SHALL append `design-review-partial-aggregated` with review run id, coverage, readiness status, and timestamp.
4. WHEN failed reviewers are retried, THEN the system SHALL append `design-review-failed-reviewers-retried` with review run id, attempt id, reviewer roles, and timestamp.
5. WHEN incomplete review is accepted, THEN the system SHALL append `design-review-incomplete-accepted` with decision id, review run id, design ref, accepted coverage, and timestamp.
6. IF event append fails for retry or accept incomplete, THEN the system SHALL fail closed and SHALL NOT rely only on mutable ledger files to advance workflow recovery.

### Requirement 9: Resume and Status Recovery Contract

**User Story:** As a future UX/TUI implementer, I want stable recovery actions and status fields, so that `/brainstorm-pro --resume` can guide users through incomplete design reviews.

#### Acceptance Criteria

1. WHEN review readiness is `incomplete-review`, THEN the system SHALL expose selected reviewers, unselected reviewers, succeeded reviewers, failed reviewers, failed diagnostics summary, aggregate counts, and available recovery actions.
2. WHEN failed reviewers exist, THEN the system SHALL expose a `retry-failed-reviewers` recovery action containing review run id and failed reviewer roles.
3. WHEN incomplete review is safe to accept, THEN the system SHALL expose an `accept-incomplete-review` recovery action containing review run id, design ref, and coverage.
4. WHEN selection is stale or the user needs to change reviewer coverage, THEN the system SHALL expose a `replace-review-selection` recovery action with current design ref and available full reviewer roles.
5. WHEN a review ledger exists, THEN the system SHALL expose a `view-review-ledger` recovery action with review run id and ledger path.
6. IF readiness is blocked by blocking findings, all reviewers failed, stale artifact binding, or corrupted ledger evidence, THEN the system SHALL omit unsafe accept-incomplete actions and surface blocker diagnostics instead.

### Requirement 10: Runtime Authority and Security Boundaries

**User Story:** As a security reviewer, I want reviewer output and recovery payloads to remain untrusted, so that execution control cannot bypass workflow gates or mutate protected state.

#### Acceptance Criteria

1. WHEN reviewer output includes fields that attempt to mutate workflow state, approvals, review decisions, artifact refs, coverage, or accept-incomplete decisions, THEN the system SHALL reject or ignore those untrusted fields and keep orchestrator authority.
2. WHEN crafted reviewer results, aggregates, events, or decisions claim failed reviewers succeeded or hide blocking findings, THEN the system SHALL validate against effective reviewer results and fail closed on inconsistency.
3. WHEN accept incomplete completes, THEN the system SHALL move at most to the design approval gate and SHALL NOT approve design, start planning, or mark review as fully passed.
4. WHEN a review panel, reviewer, or parent LLM attempts to automatically approve design or bypass the accept-incomplete gate, THEN the system SHALL reject the transition.
5. IF path traversal, spoofed design refs, checksum mismatch, unregistered roles, or corrupted evidence is detected, THEN the system SHALL fail closed with diagnostics and SHALL NOT create approval readiness.
6. WHEN runtime state transitions occur after retry or accept incomplete, THEN the system SHALL use existing state-machine authorization and explicit user decisions rather than reviewer-provided instructions.
