# Requirements Document: Plan Review Panel

## Introduction

Plan Review Panel adds an automatic, runtime-owned document validation phase between planning and plan approval in Brainstorming Pro. After an approved design produces `requirements.md` and `tasks.md`, the workflow must automatically validate that the requirements faithfully cover the approved design, that the tasks cover the requirements, and that task order is suitable for the controlled execution loop. This solves the quality gap where an approved design can be translated into an incomplete, inconsistent, or non-executable plan before the user approves execution.

The system is implemented as a fixed, parallel, read-only reviewer panel plus deterministic aggregation, readiness, ledger, and one-shot plan revision control. It is scoped to plan documents only: reviewers and revisers cannot change approved `design.md`, cannot approve plans, cannot execute tasks, and cannot bypass runtime gates. The approved design remains the source of truth, `requirements.md` remains the execution acceptance source of truth, and `tasks.md` remains the controlled execution plan.

## Glossary

- **Approved design**: The exact versioned `design.md` artifact referenced by the design approval gate.
- **Automatic plan review**: The runtime-owned `plan-review` phase that runs after planning without asking the user to choose a review mode.
- **Automatic-once plan revision**: A single runtime-triggered plan revision attempt allowed only for plan-level blockers and only for `requirements.md` / `tasks.md`.
- **Finding**: A normalized, schema-validated issue emitted by a shape validator or plan reviewer.
- **Plan artifact binding**: The version, path, and checksum binding for approved design, current requirements, and current tasks.
- **Plan readiness**: Deterministic status that indicates whether the current plan can proceed to plan approval, needs plan revision, needs design revision, failed, or is stale.
- **Plan reviewer**: A read-only agent role that validates one aspect of the plan and emits findings only.
- **Plan reviser**: A controlled agent role that may produce revised `requirements.md` and `tasks.md` content from aggregate findings.
- **Review ledger**: Durable plan review records under `.workflow/reviews/plan/<review-run-id>/`.
- **Revision ledger**: Durable plan revision records under `.workflow/revisions/plan/<revision-id>/`.
- **Stale review**: A review whose source artifact binding no longer matches the current or approvable artifacts.

## Requirements

### Requirement 1: Automatic Plan Review Lifecycle

**User Story:** As a workflow user, I want plan review to run automatically after planning, so that plan quality is checked without another review-mode decision step.

#### Acceptance Criteria

1. WHEN `SpecPlanPhaseAdapter` commits `requirements.md` and `tasks.md`, THEN the runtime SHALL enter `plan-review` automatically without presenting a plan review mode choice.
2. WHEN plan review starts, THEN the system SHALL not accept or require `skip`, `minimal`, or `full` plan review modes.
3. WHEN plan review returns ready, THEN the runtime SHALL enter `awaiting-plan-approval` and SHALL NOT enter `executing`.
4. WHEN plan review returns blocked or failed after all allowed automatic handling, THEN the runtime SHALL stop in `blocked` or `failed` with diagnostics.
5. IF plan review has not completed for the current requirements/tasks artifacts, THEN the runtime SHALL reject transition to execution even if plan approval is requested.

### Requirement 2: Exact Plan Artifact Binding

**User Story:** As a security reviewer, I want plan review bound to exact artifact versions, so that stale or forged reviews cannot approve the wrong plan.

#### Acceptance Criteria

1. WHEN plan review runs, THEN the system SHALL bind the approved design artifact ref, current requirements artifact ref, current tasks artifact ref, paths, and checksums.
2. WHEN binding is created, THEN the system SHALL verify the design ref is exactly the ref approved by the design approval gate.
3. WHEN binding is created, THEN the system SHALL verify all artifact paths remain topic-scoped and checksum-valid.
4. IF any bound artifact changes before plan approval, THEN the system SHALL mark the previous plan review stale for approval purposes.
5. IF design approval is missing or does not match the design ref, THEN plan review SHALL fail closed before reviewer execution.

### Requirement 3: Plan Shape Validation

**User Story:** As a maintainer, I want malformed plan artifacts rejected before reviewer execution, so that agents do not guess around invalid documents.

#### Acceptance Criteria

1. WHEN plan review starts, THEN the system SHALL validate that `requirements.md` exists and contains required requirements structure.
2. WHEN plan review starts, THEN the system SHALL validate that `tasks.md` exists and contains a parseable `## Tasks` section.
3. WHEN validating tasks, THEN the system SHALL reuse or align with the controlled spec-exec task parser for task numbering, checkbox, optional marker, checkpoint, and requirement-reference semantics.
4. IF task structure is malformed but safely repairable through requirements/tasks revision, THEN the system SHALL produce plan-level findings that can trigger automatic plan revision.
5. IF task structure is too malformed to safely revise, THEN the system SHALL fail closed with diagnostics instead of invoking reviewer agents to guess.

### Requirement 4: Fixed Parallel Reviewer Panel

**User Story:** As a workflow user, I want the core plan checks to run consistently and quickly, so that every plan receives the same required validation coverage.

#### Acceptance Criteria

1. WHEN automatic plan review runs, THEN the system SHALL execute exactly these reviewer roles: `requirements-coverage-reviewer`, `task-coverage-reviewer`, and `dependency-order-reviewer`.
2. WHEN reviewer roles are resolved, THEN the system SHALL NOT allow user, runtime input, or project-local config to add, remove, or replace reviewer roles for Spec 6.
3. WHEN reviewer execution begins, THEN the system SHALL run the three reviewers concurrently where the agent execution runtime supports concurrency.
4. WHEN reviewers run, THEN each reviewer SHALL receive the same artifact binding and read-only artifact contents.
5. IF any reviewer times out, fails, or returns invalid structured output, THEN the whole plan review SHALL fail; partial accept and per-reviewer retry SHALL NOT be supported.

### Requirement 5: Reviewer Role Boundaries and Coverage

**User Story:** As a maintainer, I want reviewer responsibilities separated and read-only, so that findings are focused without allowing agents to mutate workflow truth.

#### Acceptance Criteria

1. WHEN `requirements-coverage-reviewer` runs, THEN it SHALL validate approved design to requirements coverage, non-goal preservation, constraints, scope decisions, error handling expectations, testing expectations, and scope creep.
2. WHEN `task-coverage-reviewer` runs, THEN it SHALL validate requirements to tasks coverage, missing tasks, orphan tasks, task granularity, missing test tasks, missing validation tasks, and checkpoint coverage.
3. WHEN `dependency-order-reviewer` runs, THEN it SHALL validate task order, prerequisites, checkpoint placement, sequential execution compatibility, and execution-order risks.
4. WHEN any reviewer produces output, THEN it SHALL produce findings only and SHALL NOT approve plans, request execution, update artifacts, or mutate workflow state.
5. IF a reviewer identifies a problem that cannot be solved by changing requirements/tasks alone, THEN it SHALL mark the finding as requiring design revision.

### Requirement 6: Plan Finding Schema and Normalization

**User Story:** As a runtime maintainer, I want reviewer outputs normalized into a strict finding schema, so that readiness and revision decisions are deterministic.

#### Acceptance Criteria

1. WHEN reviewer or shape-validator output is accepted, THEN the system SHALL normalize it into `PlanReviewFinding` records with id, role, severity, category, title, description, affected artifacts, affected sections, recommendation, revision flags, and optional evidence.
2. WHEN a finding has `requiresDesignRevision=true`, THEN the system SHALL treat it as ineligible for automatic plan revision.
3. WHEN a finding severity is `blocking`, THEN the system SHALL require a concrete recommendation.
4. IF reviewer output contains approval directives, execution directives, workflow-state mutation claims, or artifact mutation instructions, THEN the system SHALL reject the output as invalid.
5. IF a finding references artifacts outside design, requirements, or tasks, THEN the system SHALL reject or sanitize the finding before aggregation.

### Requirement 7: Deterministic Aggregation and Readiness

**User Story:** As a workflow user, I want a clear readiness result after plan review, so that I know whether the plan can be approved or why it is blocked.

#### Acceptance Criteria

1. WHEN all validation and reviewer results are available, THEN the system SHALL aggregate findings without relying on an LLM for readiness truth.
2. WHEN any finding requires design revision, THEN readiness SHALL be `blocked-needs-design-revision` and automatic plan revision SHALL be disabled.
3. WHEN any blocking or major finding requires plan revision, THEN readiness SHALL be `blocked-needs-plan-revision` unless design revision is required.
4. WHEN reviewer execution or schema validation fails, THEN readiness SHALL be `failed`.
5. WHEN artifact binding no longer matches source artifacts, THEN readiness SHALL be `stale`.
6. WHEN all required reviewers succeed and no blocking plan/design revision findings exist, THEN readiness SHALL be `ready-for-plan-approval`.
7. WHEN readiness is `ready-for-plan-approval`, THEN the system SHALL still require explicit user plan approval before execution.

### Requirement 8: Plan Review Ledger

**User Story:** As a maintainer, I want durable plan review records, so that review outcomes are auditable and resumable.

#### Acceptance Criteria

1. WHEN a plan review run starts, THEN the system SHALL create a ledger under `specs/<topic>/.workflow/reviews/plan/<review-run-id>/`.
2. WHEN the review run starts, THEN the system SHALL persist metadata and artifact binding before reviewer execution.
3. WHEN each reviewer completes, THEN the system SHALL persist that reviewer result independently.
4. WHEN aggregation completes, THEN the system SHALL persist findings, aggregate, readiness, and review events.
5. IF the workflow is resumed, THEN status/resume logic SHALL be able to read the ledger and report current review status without relying on conversation context.

### Requirement 9: Automatic-Once Plan Revision

**User Story:** As a workflow user, I want plan-level issues fixed automatically once, so that simple document gaps do not require manual intervention while avoiding infinite revision loops.

#### Acceptance Criteria

1. WHEN readiness is `blocked-needs-plan-revision` and no automatic plan revision has been used for the current plan cycle, THEN the runtime SHALL invoke one automatic plan revision attempt.
2. WHEN automatic plan revision is invoked, THEN the system SHALL pass approved design, current requirements, current tasks, aggregate findings, readiness, and source artifact refs to `plan-reviser`.
3. WHEN `plan-reviser` returns revised content, THEN the runtime SHALL validate and commit new requirements/tasks artifact versions through the artifact store.
4. WHEN revised requirements/tasks are committed, THEN the system SHALL mark the source review stale for approval purposes.
5. WHEN automatic revision has already been used for the current plan cycle, THEN the system SHALL NOT run another automatic revision and SHALL stop blocked if plan review remains blocked.

### Requirement 10: Plan Reviser Boundaries

**User Story:** As a security reviewer, I want the automatic reviser tightly constrained, so that it cannot change approved design or bypass approval gates.

#### Acceptance Criteria

1. WHEN `plan-reviser` runs, THEN it SHALL only be allowed to produce revised `requirements.md` and `tasks.md` content plus structured revision metadata.
2. WHEN `plan-reviser` output is validated, THEN the system SHALL reject any attempt to modify approved `design.md`, approval records, review decisions, workflow state, source files, or execution progress.
3. WHEN `plan-reviser` output is validated, THEN the system SHALL reject outputs that omit either revised requirements or revised tasks when status is `revised`.
4. WHEN `plan-reviser` reports a blocker requiring design revision, THEN the system SHALL stop automatic plan revision and surface a design-level blocker.
5. WHEN `plan-reviser` changes task checkbox completion markers as execution progress, THEN the system SHALL reject the output.

### Requirement 11: Post-Revision Re-Review

**User Story:** As a workflow user, I want revised plans reviewed again, so that automatic revision is verified before plan approval.

#### Acceptance Criteria

1. WHEN automatic plan revision commits new requirements/tasks artifacts, THEN the runtime SHALL immediately run plan review again against approved design and the new artifact versions.
2. WHEN post-revision review runs, THEN it SHALL use a new review run id and a new artifact binding.
3. WHEN post-revision review returns ready, THEN the runtime SHALL enter `awaiting-plan-approval`.
4. WHEN post-revision review returns blocked or failed, THEN the runtime SHALL stop blocked or failed and SHALL NOT run another automatic revision.
5. IF a user attempts to approve the pre-revision requirements/tasks, THEN the runtime SHALL reject approval as stale.

### Requirement 12: Workflow Gate Integration

**User Story:** As a workflow user, I want plan review integrated with runtime gates, so that execution cannot start before the reviewed plan is explicitly approved.

#### Acceptance Criteria

1. WHEN design approval is absent, THEN planning and plan review SHALL NOT proceed to execution.
2. WHEN plan review is ready but plan approval is absent, THEN runtime SHALL remain at `awaiting-plan-approval`.
3. WHEN plan approval is recorded, THEN it SHALL bind the exact reviewed requirements/tasks artifact versions.
4. IF plan approval references artifacts not covered by the latest ready plan review, THEN the runtime SHALL reject approval or execution.
5. WHEN plan approval succeeds, THEN the controlled spec-exec adapter MAY execute the approved tasks according to its own gates.

### Requirement 13: Trust Boundary and Agent Execution Safety

**User Story:** As a security reviewer, I want plan review agents isolated and schema-validated, so that untrusted agent output cannot compromise workflow authority.

#### Acceptance Criteria

1. WHEN reviewer or reviser agents run, THEN they SHALL use Agent Execution Runtime isolation including role policy, no-session/no-skills boundaries, timeout, output limit, and structured output validation.
2. WHEN project-local agents/tools/config are present, THEN plan review SHALL NOT implicitly trust or load them outside the approved agent execution boundary.
3. WHEN agent output is parsed, THEN schema validation SHALL occur before writing findings, readiness, revision output, or ledger records.
4. IF agent output attempts command registration, generic subagent orchestration, background execution, or workflow gate bypass, THEN the system SHALL fail closed.
5. WHEN errors are reported, THEN diagnostics SHALL avoid leaking sensitive local configuration or credentials.

### Requirement 14: Runtime Status, Resume, and Events

**User Story:** As a workflow user, I want status and resume to reflect automatic plan review and revision, so that I can understand what happened and what action is needed.

#### Acceptance Criteria

1. WHEN plan review starts, completes, blocks, fails, revises, or re-reviews, THEN the runtime SHALL append durable events.
2. WHEN `/brainstorm-pro --status` is requested, THEN it SHALL report plan review readiness, ledger path, reviewer status, revision attempt status, and next action where available.
3. WHEN `/brainstorm-pro --resume` is requested during automatic plan review or revision, THEN it SHALL recover from persisted state and ledger rather than conversation context.
4. WHEN automatic review/revision completes ready, THEN resume SHALL present plan approval as the next user decision.
5. WHEN automatic review/revision remains blocked or failed, THEN resume/status SHALL present diagnostics and recovery hints without automatically approving or executing.
