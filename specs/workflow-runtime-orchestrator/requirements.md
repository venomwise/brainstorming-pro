# Requirements Document: Workflow Runtime Orchestrator

## Introduction

The Workflow Runtime Orchestrator is a durable top-level workflow engine for Brainstorming Pro. It coordinates the existing brainstorming, spec-plan, and spec-exec capabilities through a persisted state machine, versioned artifacts, append-only events, explicit review decisions, and explicit approval gates so that complex requests can move from clarification to planning to execution with minimal manual glue work.

This spec covers the runtime orchestration layer, artifact storage and versioning, review decision gating, approval gating, status and resume behavior, phase adapter interfaces, and security/error boundaries. It does not define a full multi-agent review panel, background execution, or the internal prompts and strategies of the existing skills; those remain separate concerns for later expansion.

## Glossary

- **Workflow Runtime Orchestrator**: The top-level engine that owns workflow state, phase progression, review decisions, approvals, and recovery behavior.
- **Phase Adapter**: A thin integration layer that executes one workflow phase and returns validated outputs without mutating the workflow state directly.
- **Review Decision Gate**: A mandatory pause point where the user reviews the latest candidate artifact and chooses the review depth for that exact artifact version: `skip`, `minimal`, or future `full`.
- **Review Mode**: The selected review depth. `skip` explicitly records that automated review was skipped by user choice, `minimal` runs lightweight validation, and `full` is reserved for future multi-agent review panels.
- **Approval Gate**: A mandatory pause point where the user must approve the latest candidate artifact version before the workflow can continue to planning or execution.
- **Resume Entry Point**: The primary state-aware command path, `/brainstorm-pro --resume`, that selects a resumable workflow if needed and then displays the next valid user decision or resumes a non-decision phase.
- **Artifact Mirror**: The top-level `design.md`, `requirements.md`, or `tasks.md` file that always points to the latest candidate or approved content for a topic.
- **Append-only Event Log**: A JSONL event stream used for audit, recovery, and status reconstruction without rewriting prior events.
- **Topic Slug**: The validated English kebab-case topic identifier used to scope all workflow files under `specs/<topic>/`.
- **Blocked State**: A safe stopped state entered when workflow execution cannot continue because of missing, corrupted, or mismatched artifacts.
- **Candidate Version**: A versioned artifact snapshot such as `v1` or `v2` that can be reviewed and approved before becoming the active workflow input.

## Requirements

### Requirement 1: Workflow Start and Run Initialization

**User Story:** As a workflow user, I want to start a runtime-managed workflow from a request, so that the system can create isolated state and begin the clarification process without manual setup.

#### Acceptance Criteria

1. WHEN a user starts a workflow with a request, THEN the system SHALL validate the request and topic, create a new workflow state under `specs/<topic>/.workflow/`, append a `workflow.started` event, and enter the initial design phase.
2. IF the request is empty, the topic is missing, or the topic slug is unsafe, THEN the system SHALL reject the start request without creating or overwriting workflow artifacts.
3. WHEN a workflow already exists for the topic, THEN the system SHALL create a new run or versioned state for the new execution rather than mutating prior approved artifacts in place.
4. WHEN the start flow receives a topic that already has artifacts, THEN the system SHALL preserve prior versions and initialize the new run with explicit references to the current candidate context.

### Requirement 2: State Machine and Resume Semantics

**User Story:** As a maintainer, I want workflow transitions to be code-enforced and resumed through one state-aware entry point, so that illegal phase changes cannot happen through prompt drift, adapter mistakes, or user command confusion.

#### Acceptance Criteria

1. WHEN the runtime evaluates a transition, THEN it SHALL allow only transitions defined in the state machine table and SHALL reject all others.
2. WHEN design generation completes, THEN the workflow SHALL enter `awaiting-design-review-decision` rather than immediately running review or asking for design approval.
3. WHEN planning completes, THEN the workflow SHALL enter `awaiting-plan-review-decision` rather than immediately running review or asking for plan approval.
4. WHEN the user runs `/brainstorm-pro --resume` and multiple resumable workflows exist, THEN the system SHALL ask the user to select which workflow topic to resume before taking workflow-specific action.
5. WHEN the user runs `/brainstorm-pro --resume` for a workflow in an active non-decision phase, THEN the system MAY continue that phase according to the state machine and adapter policy.
6. WHEN the user runs `/brainstorm-pro --resume` for a workflow at a review decision gate, THEN the system SHALL display the candidate artifact paths, exact candidate versions, and valid review choices, and SHALL NOT silently choose a review mode.
7. WHEN the user runs `/brainstorm-pro --resume` for a workflow at an approval gate, THEN the system SHALL display the pending approval decision and SHALL NOT auto-approve or skip the gate.
8. WHEN the workflow is in `blocked` or `failed`, THEN `/brainstorm-pro --resume` SHALL remain fail-closed unless an explicit recovery path is available and valid for the current state.
9. WHEN the workflow is already in a terminal state such as `done`, THEN `/brainstorm-pro --resume` SHALL not advance the workflow and SHALL return the current status unchanged.

### Requirement 3: Artifact Versioning and Mirrors

**User Story:** As a reviewer or operator, I want every important artifact to be versioned and mirrored, so that I can inspect the latest approved content while preserving history.

#### Acceptance Criteria

1. WHEN the runtime writes `design`, `requirements`, or `tasks` artifacts, THEN it SHALL store versioned copies under `.workflow/artifacts/<kind>/vN.md` and update the top-level mirror file for that kind.
2. WHEN a new version is created, THEN the system SHALL increment the version number monotonically and SHALL keep prior versions accessible for audit and rollback.
3. IF a required artifact file is missing, unreadable, or corrupted, THEN the system SHALL treat the workflow as unsafe and SHALL block progression rather than silently regenerating or guessing content.
4. WHEN the workflow is at the first version or a later version boundary, THEN the versioning logic SHALL behave consistently and SHALL not overwrite unrelated artifact kinds.

### Requirement 4: Review Decision Gate Enforcement

**User Story:** As a workflow user, I want to inspect the first design or plan draft before choosing the amount of automated review, so that review effort matches the complexity of the request without increasing command complexity.

#### Acceptance Criteria

1. WHEN the workflow reaches `awaiting-design-review-decision`, THEN the system SHALL require the latest design artifact version to exist and SHALL ask the user through `/brainstorm-pro --resume` to choose `skip`, `minimal`, or `full` for that exact design version.
2. WHEN the workflow reaches `awaiting-plan-review-decision`, THEN the system SHALL require the latest requirements and tasks artifact versions to exist and SHALL ask the user through `/brainstorm-pro --resume` to choose `skip`, `minimal`, or `full` for those exact versions.
3. WHEN the user selects `skip`, THEN the system SHALL record a review decision and review status with `reason = "user-selected-skip"` and SHALL NOT treat the skip as an implicit no-op.
4. WHEN the user selects `minimal`, THEN the system SHALL record the review decision and run the corresponding minimal review adapter before the artifact can become approval-ready.
5. WHEN the user selects `full` and full review is unavailable in the current implementation, THEN the system SHALL report that full review is unavailable, keep the workflow at the review decision gate, and SHALL NOT silently downgrade to `minimal` or `skip`.
6. IF a review decision references a stale, missing, or mismatched artifact version, THEN the system SHALL reject the decision and SHALL leave or return the workflow to the appropriate review decision gate.
7. WHEN a review decision is recorded successfully, THEN the system SHALL persist the target, mode, exact artifact versions, selecting user identity, decision timestamp, and decision artifact path.

### Requirement 5: Approval Gate Enforcement

**User Story:** As a security and reliability reviewer, I want explicit approval gates before planning and execution, so that the workflow cannot bypass human confirmation.

#### Acceptance Criteria

1. WHEN the workflow reaches design approval, THEN it SHALL require the latest design artifact version to exist, require a completed or explicitly skipped review decision for that exact version, and record user approval for that exact version before planning can begin.
2. WHEN the workflow reaches plan approval, THEN it SHALL require the latest requirements and tasks artifact versions to exist, require a completed or explicitly skipped review decision for those exact versions, and record user approval for those exact versions before execution can begin.
3. IF an approval references a stale, missing, or mismatched artifact version, THEN the system SHALL reject the approval and SHALL leave the workflow at the current gate or return it to the appropriate review decision gate when re-review is required.
4. WHEN an approval is recorded successfully, THEN the system SHALL persist the gate type, approved artifact versions, approver identity, and approval timestamp.

### Requirement 6: Phase Adapter Registry and Runtime Orchestration

**User Story:** As a future extension implementer, I want phase adapters to be isolated behind a registry, so that workflow execution remains decoupled from the underlying skill implementations.

#### Acceptance Criteria

1. WHEN the runtime invokes a phase, THEN it SHALL do so through a typed `PhaseAdapter` interface that declares `allowedFrom`, `requiredArtifacts`, `run`, `validate`, and `commit` behavior.
2. WHEN the workflow uses brainstorming, spec-plan, or spec-exec phases, THEN the adapter registry SHALL resolve the correct adapter without the runtime directly embedding skill logic.
3. WHEN review stages are implemented only as first-version placeholders, THEN the system SHALL represent them explicitly in workflow state and SHALL record user-selected skipped or minimal review status rather than omitting them.
4. IF an adapter is missing, returns invalid output, or fails during commit, THEN the runtime SHALL not advance the state machine and SHALL surface a recoverable workflow error.
5. WHEN a phase adapter requests state progression, THEN the runtime SHALL enforce review decision and approval gates before committing a later phase.

### Requirement 7: Event Log, Status, and Audit Output

**User Story:** As an operator, I want an append-only event log and clear status output, so that I can understand what happened, where the workflow stopped, and how to resume it.

#### Acceptance Criteria

1. WHEN the workflow starts, changes phase, writes an artifact, awaits review decision, records a review decision, completes review, awaits approval, or records an approval, THEN the system SHALL append a structured event to `events.jsonl`.
2. WHEN a user requests status, THEN the system SHALL report the current phase, pending decision or gate if any, latest artifact paths, latest review status, and the last recorded error if present.
3. IF event appending fails, THEN the system SHALL fail closed and SHALL not silently continue as if the event were persisted.
4. WHEN events accumulate over time, THEN the log SHALL remain append-only and SHALL preserve earlier records for audit and debugging.

### Requirement 8: Fail-Closed Error Handling and Recovery States

**User Story:** As a reliability reviewer, I want workflow failures to stop safely, so that corrupted state or missing files do not produce incorrect approvals or execution.

#### Acceptance Criteria

1. WHEN state schema validation fails or state content is corrupted, THEN the system SHALL refuse to resume and SHALL provide recovery guidance rather than guessing a repair.
2. WHEN a phase adapter or storage operation fails recoverably, THEN the system SHALL capture the error in state and SHALL move only to a safe blocked or failed state.
3. IF the workflow detects a missing artifact, a checksum mismatch, a stale review decision, a stale approval, or an invalid transition, THEN it SHALL not mutate the workflow into a later phase and SHALL surface a recoverable error.
4. WHEN recovery is possible, THEN the system SHALL require an explicit user action through `/brainstorm-pro --resume` and SHALL never auto-advance on failure alone.

### Requirement 9: Topic and Path Safety Boundaries

**User Story:** As a security reviewer, I want all workflow files constrained to the topic directory, so that the runtime cannot read or write outside the intended project boundary.

#### Acceptance Criteria

1. WHEN the runtime resolves workflow paths, THEN it SHALL keep all files under `specs/<topic>/` and its `.workflow/` subtree.
2. IF a topic, artifact path, review decision reference, or approval reference attempts path traversal, uses an absolute path, or escapes the topic directory, THEN the system SHALL reject it.
3. WHEN review decision or approval artifacts reference versioned files, THEN the referenced files SHALL belong to the same validated topic and SHALL not point outside the workflow area.
4. WHEN the workflow is given a boundary case such as an empty topic, hidden-directory hop, or malformed slug, THEN it SHALL fail closed before any artifact write occurs.
