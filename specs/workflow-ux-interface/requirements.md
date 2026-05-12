# Requirements Document: Workflow UX Interface

## Introduction

Workflow UX Interface provides the user-facing command and status presentation layer for Brainstorming Pro's durable workflow runtime. It keeps `/brainstorm-pro` as the single default workflow entrypoint, makes `--resume` the state-aware recovery and decision path, and makes `--status` the read-only diagnostic path for runtime-managed workflows. The interface translates user intent into runtime-owned decisions and renders workflow state, artifact bindings, review coverage, triage/readiness, revision handoff, plan review readiness, approval gates, and blocked/failed recovery hints in a deterministic, testable format.

The system boundary is deliberately narrow: UX code parses commands, calls the existing workflow runtime APIs, and renders safe text output plus next-command hints. It does not own lifecycle transitions, artifact commits, review ledgers, approvals, retries, accept-incomplete decisions, revision authorization, plan review execution, live TUI widgets, or generic subagent orchestration. All consequential decisions remain validated by the runtime against exact artifact/review bindings.

## Glossary

- **Workflow UX Interface**: The `/brainstorm-pro` command parsing, runtime invocation, and user-facing rendering layer defined by this spec.
- **Runtime**: The workflow runtime orchestrator that owns state transitions, artifact refs, review decisions, approval gates, and fail-closed validation.
- **Resume**: The state-aware `/brainstorm-pro --resume [topic]` path used to continue a workflow or present the next pending decision.
- **Status**: The read-only `/brainstorm-pro --status [topic]` path used to inspect workflow state and diagnostics without advancing the workflow.
- **Artifact Ref**: A versioned artifact reference containing kind, version, relative path, created timestamp, and checksum.
- **Pending Decision**: A runtime-declared decision request such as design review choice, design approval, or plan approval.
- **Design Review Mode**: The user-selected design review depth: `skip`, `minimal`, or `full`.
- **Full Reviewer Role**: One of the package-owned full design reviewers: `product-reviewer`, `architecture-reviewer`, `risk-security-reviewer`, `testing-reviewer`, or `scope-simplicity-reviewer`.
- **Reviewer Coverage**: The selected, unselected, succeeded, failed, and retryable reviewer state for a full design review run.
- **Accept Incomplete**: A user decision that accepts incomplete design review coverage for an exact review/design binding and only allows transition to the design approval gate.
- **Readiness**: Runtime/review assessment of whether a review or plan is ready for the next gate; readiness is not approval.
- **Revision Handoff**: Runtime status describing a design revision transaction, revised design ref, and post-revision review result.
- **Automatic Plan Review**: The fixed runtime-owned plan review panel that runs after planning and does not expose user-selected modes.
- **Helper Flag**: An advanced or test-oriented command flag such as `--choose-review` or `--decision`; helper flags are not the default UX path and cannot bypass runtime validation.

## Requirements

### Requirement 1: Unified Command Surface

**User Story:** As a workflow user, I want one stable `/brainstorm-pro` command surface, so that I can start, resume, and inspect workflows without learning separate subcommands for every gate.

#### Acceptance Criteria

1. WHEN a user runs `/brainstorm-pro "<request>"`, THEN the command handler SHALL start a new runtime-managed workflow through the runtime start path.
2. WHEN a user runs `/brainstorm-pro "<request>" --topic <existing-topic>`, THEN the command handler SHALL augment the existing topic through the runtime augment path after topic validation.
3. WHEN a user runs `/brainstorm-pro --topic <existing-topic>` without a request, THEN the command handler SHALL treat it as a resume intent for that topic.
4. WHEN a user runs `/brainstorm-pro --resume [topic]`, THEN the command handler SHALL call the runtime resume path and render the returned state or selection requirement.
5. WHEN a user runs `/brainstorm-pro --status [topic]`, THEN the command handler SHALL call the runtime status path and render a read-only status view.
6. IF a user supplies an unknown option, THEN the parser SHALL reject it with a clear error and SHALL NOT call runtime mutation paths.
7. IF `--resume` and `--status` are supplied together, THEN the parser SHALL reject the invocation before calling the runtime.

### Requirement 2: Helper Flag Guardrails

**User Story:** As a maintainer, I want helper flags to remain constrained shortcuts, so that they cannot become alternate lifecycle paths or bypass runtime gates.

#### Acceptance Criteria

1. WHEN a helper flag representing a runtime decision is supplied without `--resume`, THEN the parser SHALL reject the invocation.
2. WHEN `--choose-review` is supplied, THEN the parser SHALL accept only `skip`, `minimal`, or `full` as syntactically valid values.
3. WHEN `--decision` is supplied, THEN the parser SHALL accept only `approve`, `revise`, `status`, or `exit` as syntactically valid values.
4. WHEN both review-mode and approval helper decisions are supplied in one invocation, THEN the parser SHALL reject the invocation.
5. IF future reviewer selection, retry, accept-incomplete, or revision helper flags are introduced, THEN they SHALL map to runtime-owned decision types and SHALL be rejected unless used with `--resume`.
6. IF a helper flag attempts to supply a plan review mode, THEN the parser or decision layer SHALL reject it and explain that plan review is automatic and fixed.

### Requirement 3: Runtime Authority Boundary

**User Story:** As a security reviewer, I want the UX layer to be a thin facade over runtime validation, so that user-facing convenience cannot compromise lifecycle integrity.

#### Acceptance Criteria

1. WHEN the command handler receives a start, augment, resume, or status intent, THEN it SHALL call the corresponding runtime API instead of directly editing runtime files.
2. WHEN a user makes a consequential decision, THEN the UX layer SHALL pass the intent to the runtime for phase, artifact, review, and approval validation.
3. WHEN rendering workflow output, THEN the UX layer SHALL use runtime-returned state/status contracts rather than privately mutating review ledgers, approvals, artifacts, or event logs.
4. IF runtime rejects or ignores a decision because it is invalid for the current phase, THEN the UX output SHALL show the current phase and allowed pending decision rather than claiming the decision succeeded.
5. IF a workflow is `blocked` or `failed`, THEN ordinary resume output SHALL NOT auto-advance the workflow and SHALL instead render diagnostics and recovery hints.
6. IF renderer input contains an unknown status shape, THEN the renderer SHALL use safe fallback output and SHALL NOT label the workflow as ready, passed, or approved unless that status is explicitly present.

### Requirement 4: Workflow Selection and Phase Summary Rendering

**User Story:** As a workflow user, I want resume/status output to identify the selected workflow and its current gate, so that I can choose the correct topic and next action.

#### Acceptance Criteria

1. WHEN runtime returns multiple selectable workflow topics, THEN UX SHALL render a selection view listing topics and next commands without advancing any workflow.
2. WHEN runtime returns no selectable workflows, THEN UX SHALL render a clear empty-state message.
3. WHEN runtime returns one workflow state or status, THEN UX SHALL render workflow topic, run id, phase, and pending decision type when present.
4. WHEN artifact refs are present, THEN UX SHALL render artifact kind, version, relative path, and checksum or checksum prefix.
5. WHEN a last error is present, THEN UX SHALL render the error message, originating phase, recoverability, and available diagnostic details.
6. IF a phase has no pending user action, THEN UX SHALL render an appropriate status or next-command hint without inventing a decision.

### Requirement 5: Design Review Decision Rendering

**User Story:** As a design review operator, I want the design review decision gate to clearly show choices and bindings, so that I can select an appropriate review mode safely.

#### Acceptance Criteria

1. WHEN workflow phase is `awaiting-design-review-decision`, THEN UX SHALL render the current design artifact ref including version, path, and checksum.
2. WHEN rendering the design review decision gate, THEN UX SHALL show the available choices `skip`, `minimal`, `full`, `revise`, and `exit` when present in the runtime pending decision.
3. WHEN rendering `skip`, THEN UX SHALL explain that skip is an explicit user-selected review decision and not an implicit no-op.
4. WHEN rendering `minimal`, THEN UX SHALL explain that minimal runs a workflow-owned lightweight review.
5. WHEN rendering `full`, THEN UX SHALL explain that full review defaults to the five package-owned full reviewer roles.
6. WHEN full review is presented, THEN UX SHALL show role descriptions for `product-reviewer`, `architecture-reviewer`, `risk-security-reviewer`, `testing-reviewer`, and `scope-simplicity-reviewer`.
7. WHEN reviewer selection is available, THEN UX SHALL state that the selection binds to the exact current design version/checksum and becomes stale if the design changes.

### Requirement 6: Design Review Recovery Rendering

**User Story:** As a workflow user, I want partial, failed, blocked, or unavailable design reviews to show coverage and safe recovery options, so that I can decide whether to retry, revise, or inspect the ledger.

#### Acceptance Criteria

1. WHEN design review status includes reviewer coverage, THEN UX SHALL render selected, unselected, succeeded, and failed reviewer groups when available.
2. WHEN design review status is `partial` or readiness is `incomplete-review`, THEN UX SHALL explicitly state that partial review is not a passed review.
3. WHEN failed reviewers are present, THEN UX SHALL render retry-related recovery actions only if those actions are present in the runtime status contract.
4. WHEN a review ledger path or review run id is present, THEN UX SHALL render it for inspection.
5. WHEN blocking findings, triage summary, conflicts, or unresolved questions are present, THEN UX SHALL include them in the recovery summary without treating them as approval.
6. IF runtime does not expose a recovery action, THEN UX SHALL NOT show that action as executable.

### Requirement 7: Accept Incomplete Confirmation Rendering

**User Story:** As a workflow user, I want accept-incomplete review to be clearly separated from approval, so that I understand the risk and consequence of accepting missing reviewer coverage.

#### Acceptance Criteria

1. WHEN runtime exposes accept-incomplete as an available recovery action, THEN UX SHALL render a distinct accept-incomplete confirmation view or warning section.
2. WHEN rendering accept-incomplete, THEN UX SHALL show incomplete coverage, failed reviewers, succeeded reviewers, aggregated findings summary when available, and the exact design artifact ref.
3. WHEN rendering accept-incomplete, THEN UX SHALL state that accepting incomplete coverage does not approve the design.
4. WHEN rendering accept-incomplete, THEN UX SHALL state that it only allows the workflow to proceed to the design approval gate.
5. IF blocking findings are present, no reviewer succeeded, the artifact is stale, or runtime did not expose accept-incomplete, THEN UX SHALL NOT present accept-incomplete as an executable next action.

### Requirement 8: Design Approval and Revision Handoff Rendering

**User Story:** As a workflow user, I want the design approval gate to summarize review evidence and revision handoff clearly, so that I can approve or revise the exact design artifact intentionally.

#### Acceptance Criteria

1. WHEN workflow phase is `awaiting-design-approval`, THEN UX SHALL render the current design artifact ref and approval choices from the runtime pending decision.
2. WHEN review status is available, THEN UX SHALL render review mode, status, readiness status, triage summary, and must-fix/should-fix/note/conflict/unresolved-question counts when available.
3. WHEN design review was skipped, THEN UX SHALL render a warning that review was explicitly skipped and approval is still required.
4. WHEN incomplete review coverage was accepted, THEN UX SHALL render a warning that approval remains a separate explicit user gate.
5. WHEN revision handoff exists, THEN UX SHALL render revision id, revised design ref, post-revision review run id, post-review readiness, blocking question ids, and next recovery actions when available.
6. WHEN rendering revision handoff, THEN UX SHALL state that old review/triage evidence is provenance only and cannot approve the revised design ref.
7. IF post-revision review passed, THEN UX SHALL still render the explicit design approval gate instead of implying automatic approval.

### Requirement 9: Automatic Plan Review and Plan Approval Rendering

**User Story:** As a workflow user, I want plan review and approval output to distinguish automatic document validation from explicit plan approval, so that I do not try to choose unsupported plan review modes.

#### Acceptance Criteria

1. WHEN plan review status is present, THEN UX SHALL render the approved design ref, current requirements ref, current tasks ref, plan review run id, ledger path, and readiness when available.
2. WHEN rendering plan review, THEN UX SHALL identify the fixed reviewer set: `requirements-coverage-reviewer`, `task-coverage-reviewer`, and `dependency-order-reviewer`.
3. WHEN rendering plan review, THEN UX SHALL state that plan review is automatic and fixed and has no `skip`, `minimal`, or `full` user mode.
4. WHEN automatic plan revision attempt status is present, THEN UX SHALL render whether a revision was attempted and the post-revision review status when available.
5. WHEN workflow phase is `awaiting-plan-approval`, THEN UX SHALL render reviewed requirements/tasks refs, latest requirements/tasks refs, plan review readiness, and approval choices from runtime.
6. WHEN rendering plan approval, THEN UX SHALL state that runtime will validate approval against the latest ready automatic plan review binding.
7. IF plan review readiness is blocked, failed, or stale, THEN UX SHALL render diagnostics and SHALL NOT present plan approval as an executable next action unless runtime phase/pending decision explicitly allows it.

### Requirement 10: Terminal, Blocked, Failed, and Future Interface Handling

**User Story:** As a maintainer and future integrator, I want terminal/error views and future tool boundaries to be explicit, so that users and automation receive safe status without accidental workflow advancement.

#### Acceptance Criteria

1. WHEN workflow phase is `blocked`, THEN UX SHALL render last error, recoverability, diagnostics, recovery actions, and safe next-command hints without auto-advancing.
2. WHEN workflow phase is `failed`, THEN UX SHALL render failure details and SHALL NOT offer retry, approval, or recovery actions unless runtime status explicitly exposes them.
3. WHEN workflow phase is `done`, THEN UX SHALL render terminal status, final artifact paths/refs, and no resume-next-action that would imply further advancement.
4. WHEN optional future tool input is implemented, THEN it SHALL express only `start`, `augment`, `resume`, or `status` intent and call the same runtime paths as the command handler.
5. WHEN optional future tool input includes a decision, THEN runtime SHALL remain responsible for validating artifact, review, accept-incomplete, and approval gates.
6. IF future tool or UX extensions are added, THEN they SHALL NOT expose generic subagent orchestration, arbitrary chain execution, or background async runner behavior.
