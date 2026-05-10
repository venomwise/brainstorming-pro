# Requirements Document: Design Review Panel

## Introduction

The Design Review Panel is the workflow-owned review subsystem for Brainstorming Pro’s design phase. It turns the first `design.md` draft into a version-bound review run that can be resumed, audited, and safely paused before planning begins. The panel lets the workflow runtime record a user-selected review mode (`skip`, `minimal`, or `full`) for the exact design version, execute lightweight validation for `minimal`, and explicitly report `full` as unavailable until the full reviewer pack is implemented in a later spec.

This spec covers the review panel foundation, artifact binding, review-run persistence, minimal reviewer execution, finding normalization, basic aggregation/readiness, fail-closed behavior, and extension points needed for later full-review, triage, and revision-loop specs. It does not define plan review, execution review, approval gates, or the full multi-reviewer role pack itself.

## Glossary

- **Design Review Panel**: The workflow-owned subsystem that evaluates the latest design draft and produces a version-bound review result.
- **Review Run**: A persisted execution instance for one design review attempt, including mode, exact artifact ref, reviewer outputs, findings, and readiness result.
- **Review Mode**: The user-selected review depth for the exact design version: `skip`, `minimal`, or `full`.
- **Full Review Capability**: The future multi-reviewer implementation that will execute the complete reviewer panel defined by Spec 5.1.
- **Finding**: A structured review issue returned by a reviewer, normalized by the panel into canonical fields and severity categories.
- **Readiness**: The panel’s assessment of whether the reviewed design is ready for user approval, blocked, failed, skipped, or unavailable.
- **Ledger**: The persisted `.workflow/reviews/design/<review-run-id>/` audit record for a review run.
- **Design Artifact Ref**: The exact versioned reference to the design markdown file being reviewed, including path, version, checksum, and timestamp metadata.

## Requirements

### Requirement 1: Review Panel Lifecycle and Mode Handling

**User Story:** As a workflow user, I want the design review panel to handle skip, minimal, and full modes explicitly, so that review depth is recorded for the exact design version and the workflow does not guess my intent.

#### Acceptance Criteria

1. WHEN the workflow enters design review with a recorded user decision, THEN the system SHALL create a persisted review run for that exact design version and review mode.
2. WHEN the selected mode is `skip`, THEN the system SHALL record an explicit skipped review result with reason `user-selected-skip` and SHALL not run automated reviewer execution.
3. WHEN the selected mode is `minimal`, THEN the system SHALL execute the minimal reviewer path and produce a structured review result instead of a placeholder no-op.
4. WHEN the selected mode is `full` and the full reviewer pack is not implemented yet, THEN the system SHALL return an explicit unavailable result with reason `full-review-unavailable` and SHALL not silently downgrade to `minimal` or `skip`.
5. IF the review mode is not one of `skip`, `minimal`, or `full`, THEN the system SHALL fail closed and SHALL not create a passed review result.
6. WHEN a review run completes, THEN the system SHALL persist its final status as one of `skipped`, `passed`, `blocked`, `failed`, or `unavailable`.

### Requirement 2: Exact Artifact Binding and Stale-Artifact Rejection

**User Story:** As a reviewer or operator, I want every review to bind to one exact design artifact version, so that stale decisions and changed drafts cannot be approved accidentally.

#### Acceptance Criteria

1. WHEN a review run starts, THEN the system SHALL bind the review to the exact latest design artifact version, relative path, and checksum recorded in the workflow state.
2. WHEN the stored review decision references a design artifact version or checksum that no longer matches the latest design artifact, THEN the system SHALL reject the review as stale and SHALL not run reviewer execution.
3. IF the design artifact is missing, unreadable, empty, or escapes the topic directory, THEN the system SHALL fail closed and SHALL not produce a passed review result.
4. WHEN a review run is persisted, THEN the system SHALL include the exact design artifact ref in the review-run record and in every normalized finding written for that run.
5. WHEN the design artifact changes after a review decision is recorded but before review execution begins, THEN the system SHALL require a fresh review decision for the new version.

### Requirement 3: Minimal Reviewer Execution and Finding Normalization

**User Story:** As a maintainer, I want the minimal design review path to run through a controlled agent and emit structured findings, so that review quality is testable and not hidden in prompt text.

#### Acceptance Criteria

1. WHEN the review mode is `minimal`, THEN the system SHALL invoke the agent execution runtime using the approved minimal reviewer role and a design-review-specific prompt and output schema.
2. WHEN the minimal reviewer returns output, THEN the system SHALL validate the structured payload before accepting any findings.
3. WHEN reviewer output contains malformed or invalid findings, THEN the system SHALL fail closed rather than partially trusting unvalidated content.
4. WHEN reviewer output is valid, THEN the system SHALL normalize each finding into a canonical schema that includes reviewer role, category, severity, title, description, and revision intent.
5. IF the reviewer attempts to emit approval, workflow-state mutation, or artifact-commit directives, THEN the system SHALL ignore those directives and SHALL treat such output as invalid.
6. WHEN the minimal reviewer path runs successfully, THEN the system SHALL record at least one review summary artifact or ledger entry describing the outcome, even if no blocking findings are produced.

### Requirement 4: Basic Aggregation and Readiness Assessment

**User Story:** As a workflow user, I want the panel to summarize findings and tell me whether the design is ready for approval, so that I can decide the next step without reading every raw reviewer output.

#### Acceptance Criteria

1. WHEN normalized findings are available, THEN the system SHALL aggregate them into a review summary that includes counts by severity and by category.
2. WHEN the aggregate contains one or more blocking findings, THEN the system SHALL mark the review as `blocked` and SHALL mark readiness as not ready for user approval.
3. WHEN the aggregate contains no blocking findings and reviewer execution succeeded, THEN the system SHALL mark the review as `passed` and SHALL mark readiness as ready for user approval.
4. WHEN the selected mode is `skip`, THEN readiness SHALL be recorded as `skipped-by-user` and SHALL not imply that the design has been approved.
5. WHEN the selected mode is `full` but unavailable, THEN readiness SHALL be recorded as `not-ready` and SHALL not be treated as approval-ready.
6. IF reviewer execution fails, times out, or produces invalid output, THEN the system SHALL mark the review as `failed` and SHALL not report approval readiness.

### Requirement 5: Review Ledger and Audit Records

**User Story:** As an operator, I want every design review run to be written to a topic-scoped ledger, so that the workflow can be audited, resumed, and inspected later.

#### Acceptance Criteria

1. WHEN a review run is created, THEN the system SHALL create a topic-scoped ledger directory under `.workflow/reviews/design/<review-run-id>/`.
2. WHEN the review run progresses, THEN the system SHALL persist `review-run.json`, per-reviewer output files, aggregated findings, and readiness records using atomic writes where possible.
3. WHEN the system appends review-related events, THEN it SHALL keep those events append-only and SHALL preserve earlier records for audit.
4. IF ledger persistence fails, THEN the system SHALL fail closed and SHALL not treat the review as durable or passed.
5. WHEN a review run is later inspected through status or resume behavior, THEN the ledger SHALL provide enough information to reconstruct the review mode, exact design ref, reviewer outcome, aggregate result, and final readiness.

### Requirement 6: Fail-Closed Error Handling and Security Boundaries

**User Story:** As a security and reliability reviewer, I want design review failures to stop safely, so that invalid paths, corrupted artifacts, and tool failures cannot bypass the workflow gates.

#### Acceptance Criteria

1. WHEN the review panel encounters a missing artifact, checksum mismatch, stale decision, invalid transition, or path escape, THEN it SHALL fail closed and SHALL not enter a passed state.
2. WHEN the minimal reviewer times out, exits non-zero, or returns invalid output, THEN the review SHALL be marked failed unless a valid retry policy succeeds inside the agent runtime.
3. WHEN the full reviewer pack is unavailable, THEN the system SHALL return `unavailable` and SHALL not silently fallback to a different review mode.
4. IF a reviewer output attempts to reference files outside the topic directory, THEN the system SHALL reject that output or normalize it into a safe failure state.
5. WHEN any write to the review ledger fails partway through, THEN the system SHALL not claim a successful review result for that run.

### Requirement 7: Extensibility for Full Review, Triage, and Revision

**User Story:** As a future extension implementer, I want the panel foundation to expose stable hooks for full review, triage, and revision, so that later specs can add capability without rewriting the runtime contract.

#### Acceptance Criteria

1. WHEN the panel is asked for `full` review in Spec 5, THEN it SHALL expose a stable capability boundary that later specs can replace without changing the review-mode contract.
2. WHEN later specs add the full reviewer pack, THEN they SHALL be able to plug in multiple reviewer roles without redefining the review-run or finding schema.
3. WHEN later specs add triage and readiness refinement, THEN they SHALL be able to consume the canonical findings and ledger records produced by this spec.
4. WHEN later specs add a design revision loop, THEN they SHALL be able to use the review result, blocking findings, and unreadiness diagnostics from this spec as revision input.
5. IF later extension code is absent, THEN the panel foundation SHALL continue to behave deterministically with minimal review and explicit full-review-unavailable semantics.
