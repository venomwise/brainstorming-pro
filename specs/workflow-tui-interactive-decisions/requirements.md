# Requirements Document: Workflow TUI Interactive Decisions

## Introduction

Workflow TUI Interactive Decisions adds a runtime-gated input layer to Brainstorming Pro's snapshot-first live TUI. It lets workflow users make pending gate decisions from the live terminal UI—such as choosing design review mode, selecting full design reviewers, retrying failed reviewers, accepting incomplete review coverage, authorizing a single design revision transaction, approving design, and approving plan—without turning the TUI into workflow authority.

The system is built around a narrow runtime decision facade, snapshot-derived interactive gate models, decision payload binding, gate nonces, idempotency keys, explicit confirmations, and deterministic CLI fallback. TUI controls collect `RuntimeUserDecision` intent only; the workflow runtime re-reads authoritative state and validates phase, pending gate, artifact refs, checksums, readiness evidence, recovery actions, and duplicate submissions before writing decisions, approvals, events, ledgers, or state transitions. Review details, execution task details, plan review mode/subset controls, and background dashboard behavior are out of scope.

## Glossary

- **Workflow Runtime**: The Brainstorming Pro runtime that owns workflow phases, artifact refs, review decisions, approval gates, events, ledgers, and state transitions.
- **WorkflowLiveSnapshot**: The read-only presentation object produced by Spec 8 from durable workflow state and foreground progress events.
- **Interactive Gate Model**: A TUI view-model derived from `WorkflowLiveSnapshot` that describes one current pending gate and its safe controls.
- **RuntimeUserDecision**: A structured intent submitted by CLI or TUI for runtime validation, such as selecting review mode or approving a gate.
- **Decision Facade**: The package-internal `submitWorkflowDecision()` runtime API that validates and persists user decisions through runtime-owned code paths.
- **WorkflowDecisionBinding**: The submitted gate/artifact/readiness binding attached to a decision payload and treated as untrusted input by runtime.
- **Gate Nonce**: A runtime-owned token generated for each pending gate instance and echoed by clients to detect stale gate submissions.
- **Idempotency Key**: A stable submission key persisted with accepted decisions so duplicate submits can be safely identified.
- **Explicit Confirmation**: A required user confirmation flag for high-impact actions such as skip review, accept incomplete, authorize revision, approve design, and approve plan.
- **CLI Fallback**: The equivalent `/brainstorm-pro --resume` path available for every TUI interactive action.
- **Stale Snapshot**: A TUI snapshot whose topic, run id, gate, artifact refs, checksums, or readiness evidence no longer match runtime state.

## Requirements

### Requirement 1: Runtime decision facade

**User Story:** As a maintainer, I want TUI and CLI decisions to pass through one narrow runtime facade, so that interactive UI cannot bypass workflow validation or persistence rules.

#### Acceptance Criteria

1. WHEN Spec 8.1 is implemented, THEN the system SHALL expose a package-internal `submitWorkflowDecision()` facade for runtime-gated decisions.
2. WHEN CLI helper decisions and TUI decisions are submitted, THEN both paths SHALL convert user intent into `RuntimeUserDecision` and use the same runtime validation and persistence code paths.
3. WHEN `submitWorkflowDecision()` receives a decision, THEN it SHALL reload authoritative workflow state before deciding whether to accept or reject the decision.
4. WHEN a decision is accepted, THEN runtime-owned code SHALL persist the appropriate decision, approval, recovery, event, ledger, and state changes.
5. WHEN a decision is rejected, THEN the facade SHALL return a typed rejection reason and current status where available without writing durable decision state.
6. IF the workflow is blocked or failed and the submitted decision is not an allowed recovery action, THEN the facade SHALL reject it fail-closed.

### Requirement 2: Decision binding and gate nonce validation

**User Story:** As a reliability reviewer, I want each decision to bind to the exact pending gate and artifacts, so that stale TUI snapshots cannot approve or recover the wrong workflow state.

#### Acceptance Criteria

1. WHEN runtime enters a pending user decision gate, THEN it SHALL expose a runtime-owned gate binding containing `gateId`, `gateNonce`, phase, artifact refs, and creation timestamp.
2. WHEN a TUI decision is submitted, THEN the payload SHALL include the displayed `gateId`, `gateNonce`, phase, and applicable artifact refs/checksums.
3. WHEN runtime validates a decision, THEN it SHALL compare submitted gate binding against the current authoritative pending gate.
4. IF the submitted gate nonce differs from current runtime state, THEN runtime SHALL reject the decision as stale gate or stale snapshot.
5. IF submitted artifact refs/checksums differ from current authoritative artifact refs required by the gate, THEN runtime SHALL reject the decision as artifact or checksum mismatch.
6. IF a gate is consumed by an accepted decision, THEN later submissions for the old gate binding SHALL be rejected unless they are idempotent repeats of the same accepted submission.

### Requirement 3: Idempotency and double-submit protection

**User Story:** As a workflow user, I want repeated key presses, redraw glitches, or uncertain retries to be safe, so that a decision is not accidentally recorded twice.

#### Acceptance Criteria

1. WHEN a TUI control submits a decision, THEN it SHALL include an idempotency key unique to that submit attempt.
2. WHEN a decision is accepted, THEN runtime SHALL persist the accepted idempotency key in the durable record for the consumed gate.
3. WHEN the same idempotency key is submitted again for the same accepted gate, THEN runtime SHALL return an idempotent accepted result when possible instead of recording a second decision.
4. WHEN a different idempotency key is submitted after the gate was consumed, THEN runtime SHALL reject it as duplicate decision or stale gate.
5. WHEN a TUI decision is in flight, THEN the TUI SHALL disable the submitting control or otherwise prevent immediate duplicate local submits.
6. IF decision transport fails and acceptance is unknown, THEN the TUI SHALL not assume success and SHALL prompt status refresh or retry using the same idempotency key.

### Requirement 4: Interactive gate model generation

**User Story:** As a TUI implementer, I want typed interactive gate models derived from live snapshots, so that controls are rendered only for currently visible runtime gates.

#### Acceptance Criteria

1. WHEN a `WorkflowLiveSnapshot` contains a non-stale pending decision gate, THEN the TUI layer SHALL build one typed `InteractiveGateModel` for that gate.
2. WHEN a snapshot is stale, corrupt, or lacks a pending gate, THEN the TUI SHALL render no executable decision controls and SHALL show refresh or CLI fallback hints.
3. WHEN an interactive model is built, THEN it SHALL include exact artifact refs/checksums, gate binding, available actions, warnings, and CLI fallback text.
4. WHEN runtime status exposes recovery actions, THEN the interactive model SHALL render only those recovery actions and SHALL NOT invent unavailable actions.
5. IF an unknown gate type appears, THEN the model builder SHALL fall back to a non-interactive status model rather than rendering unsafe controls.
6. IF a model contains plan approval, THEN it SHALL NOT include plan review mode, plan reviewer subset, plan partial accept, or per-plan-reviewer retry controls.

### Requirement 5: Design review mode and reviewer subset controls

**User Story:** As a design review operator, I want to choose design review mode and full reviewer subset from the TUI, so that I can start the correct review for the exact design version.

#### Acceptance Criteria

1. WHEN the workflow is awaiting design review decision, THEN the TUI SHALL render choices for `skip`, `minimal`, `full`, `revise`, and `exit` with the current design ref/checksum.
2. WHEN the user chooses `skip`, THEN the TUI SHALL require explicit confirmation before submitting the decision.
3. WHEN the user chooses `full`, THEN the TUI SHALL render a full design reviewer subset selector before submission.
4. WHEN the full reviewer selector opens, THEN all five full design reviewer roles SHALL be selected by default.
5. WHEN selecting reviewers, THEN the TUI SHALL require at least one valid full design reviewer role and reject duplicate, unknown, minimal, or plan reviewer roles before submission.
6. WHEN the review mode decision is submitted, THEN it SHALL include the exact design ref/checksum, selected reviewer roles if applicable, gate binding, and idempotency key.
7. IF the design ref/checksum changes before runtime validation, THEN runtime SHALL reject the decision as stale rather than starting review.

### Requirement 6: Design review recovery controls

**User Story:** As a review operator, I want TUI recovery controls for partial or failed design reviews, so that I can retry failed reviewers or safely accept incomplete coverage when runtime allows it.

#### Acceptance Criteria

1. WHEN runtime exposes failed reviewer retry as a recovery action, THEN the TUI SHALL show review run id, selected reviewers, succeeded reviewers, failed reviewers, diagnostics summary, and retry action.
2. WHEN retry is submitted, THEN the decision SHALL include review run id, design ref/checksum, runtime-exposed failed reviewer roles, gate binding, and idempotency key.
3. WHEN runtime exposes accept-incomplete as a recovery action, THEN the TUI SHALL render a separate confirmation dialog instead of combining it with approval.
4. WHEN rendering accept-incomplete confirmation, THEN the TUI SHALL state that incomplete review is not passed review and does not approve design.
5. WHEN accept-incomplete is submitted, THEN the decision SHALL include explicit confirmation, review run id, design ref/checksum, coverage evidence or checksum, gate binding, and idempotency key.
6. IF blocking findings exist, no reviewer succeeded, no reviewer failed, coverage changed, readiness is not `incomplete-review`, or design binding is stale, THEN runtime SHALL reject accept-incomplete.
7. WHEN accept-incomplete is accepted, THEN runtime SHALL move only to the design approval gate and SHALL NOT approve design or enter planning.

### Requirement 7: Design approval controls

**User Story:** As a workflow user, I want to approve or revise the exact reviewed design from TUI, so that planning only starts after explicit runtime-validated approval.

#### Acceptance Criteria

1. WHEN the workflow is awaiting design approval, THEN the TUI SHALL show design ref/checksum, review evidence, readiness status, triage summary when available, and any skipped or accepted-incomplete warnings.
2. WHEN rendering design approval, THEN the TUI SHALL state that review readiness is not approval.
3. WHEN the user chooses approve design, THEN the TUI SHALL require explicit confirmation before submission.
4. WHEN approve design is submitted, THEN the decision SHALL include design ref/checksum, review/readiness evidence refs where available, gate binding, idempotency key, and explicit confirmation.
5. IF readiness or design binding changes before runtime validation, THEN runtime SHALL reject approval.
6. WHEN design approval is accepted, THEN runtime SHALL record design approval and transition according to the existing workflow path toward planning.
7. IF runtime exposes design revision as an available action instead of approval, THEN the TUI SHALL route the user to the design revision authorization confirmation rather than directly mutating design.

### Requirement 8: Design revision authorization controls

**User Story:** As a workflow user, I want to authorize exactly one design revision transaction from TUI, so that review findings can be addressed without granting unbounded automatic mutation.

#### Acceptance Criteria

1. WHEN runtime exposes a design revision authorization recovery action, THEN the TUI SHALL show source design ref/checksum, source review run id, source triage/readiness refs, must-fix or unresolved question summary when available, and post-revision review settings.
2. WHEN rendering authorization, THEN the TUI SHALL state that one authorization permits one revision attempt and one post-revision re-review only.
3. WHEN rendering authorization, THEN the TUI SHALL state that authorization does not approve the revised design and does not allow automatic multi-round revision.
4. WHEN authorization is submitted, THEN the decision SHALL include explicit confirmation, source design ref/checksum, source review run id, source triage/readiness refs, post-revision review mode/subset, gate binding, and idempotency key.
5. IF source design, review, triage, readiness, round policy, or required user answers are stale or invalid, THEN runtime SHALL reject or return a needs-user-input result without running the reviser.
6. WHEN authorization is accepted, THEN runtime SHALL own revision ledger writes, artifact commit, stale evidence invalidation, and post-revision re-review scheduling.

### Requirement 9: Plan approval controls

**User Story:** As a workflow user, I want to approve the exact reviewed requirements and tasks from TUI, so that execution starts only after automatic plan review readiness and explicit plan approval.

#### Acceptance Criteria

1. WHEN the workflow is awaiting plan approval, THEN the TUI SHALL show approved design ref, requirements ref, tasks ref, plan review run id, plan readiness status, and automatic plan revision summary when available.
2. WHEN rendering plan approval, THEN the TUI SHALL state that plan review ready is not plan approval.
3. WHEN the user chooses approve plan, THEN the TUI SHALL require explicit confirmation before submission.
4. WHEN approve plan is submitted, THEN the decision SHALL include approved design ref, requirements ref, tasks ref, plan review run id, readiness checksum or evidence, gate binding, idempotency key, and explicit confirmation.
5. IF current requirements/tasks no longer match the latest ready plan review binding, THEN runtime SHALL reject plan approval.
6. WHEN plan approval is accepted, THEN runtime SHALL record plan approval and transition according to the existing workflow path toward execution.
7. WHEN plan approval controls are rendered, THEN the TUI SHALL NOT offer plan review skip/minimal/full mode, reviewer subset, partial accept, or per-reviewer retry.

### Requirement 10: Keyboard, focus, cancel, and fallback behavior

**User Story:** As a terminal user, I want predictable keyboard and fallback behavior, so that interactive decisions are accessible and cancel-safe across terminal environments.

#### Acceptance Criteria

1. WHEN interactive controls are focused, THEN `Tab` and `Shift+Tab` SHALL move between controls.
2. WHEN radio groups or checkbox lists are focused, THEN arrow keys SHALL move within options and `Space` SHALL toggle checkbox options where applicable.
3. WHEN `Enter` is pressed, THEN it SHALL submit only the focused primary action and only after required confirmation is satisfied.
4. WHEN `Esc`, `q`, close, or cancel is pressed, THEN the TUI SHALL exit the current interactive control without submitting a decision.
5. WHEN `Ctrl+C` occurs, THEN command cancellation semantics SHALL apply and no partial decision SHALL be submitted.
6. WHEN a confirmation dialog opens, THEN default focus SHALL be on cancel/no.
7. WHEN text input is needed in the first implementation, THEN it SHALL be limited to narrow optional reason fields and IME input SHALL be accepted only in the active field.
8. WHEN TUI input or rendering is unavailable, unsupported, too narrow, or fails, THEN the system SHALL fall back to deterministic text and `/brainstorm-pro --resume` hints.

### Requirement 11: Rejection display and fail-soft handling

**User Story:** As a workflow user, I want clear rejection messages, so that I know whether a TUI action was recorded and what to do next.

#### Acceptance Criteria

1. WHEN runtime rejects a TUI-submitted decision, THEN the TUI SHALL display the rejection reason and current authoritative status when available.
2. WHEN rejection is due to stale artifact binding, THEN the TUI SHOULD show the snapshot refs and current runtime refs when available.
3. WHEN no decision was recorded, THEN the TUI SHALL explicitly state that no decision was recorded.
4. WHEN runtime returns an idempotent accepted result, THEN the TUI SHALL distinguish it from a rejection.
5. WHEN renderer or input handling fails, THEN the workflow SHALL continue or fall back without marking the workflow failed solely due to UI failure.
6. IF current status cannot be loaded for a rejection, THEN the TUI SHALL show a safe generic rejection and instruct the user to run `/brainstorm-pro --status` or `/brainstorm-pro --resume`.

### Requirement 12: Runtime authority and product-boundary enforcement

**User Story:** As a security reviewer, I want interactive TUI code to remain an input facade, so that it cannot directly mutate workflow artifacts, decisions, approvals, reviews, revisions, or execution state.

#### Acceptance Criteria

1. WHEN TUI interactive modules are implemented, THEN they SHALL NOT import or call low-level approval writers, review decision writers, revision ledger writers, artifact commit helpers, state transition helpers, or task checkbox writers.
2. WHEN a TUI action is performed, THEN durable workflow mutation SHALL occur only through the runtime decision facade.
3. WHEN crafted TUI payloads attempt unsupported actions, THEN runtime SHALL reject them fail-closed.
4. WHEN plan review is displayed, THEN TUI SHALL preserve the automatic fixed plan review boundary and SHALL NOT expose plan review mode/subset/partial retry controls.
5. WHEN execution progress is displayed, THEN TUI SHALL NOT select tasks, write checkboxes, validate evidence, or advance execution state.
6. WHEN implementing interactive TUI, THEN the package SHALL NOT expose generic subagent orchestration, background runner, intercom, arbitrary chains, or builtin agent discovery.
7. IF pi-subagents-derived helper code is added, THEN reuse inventory and attribution SHALL be updated according to repository policy.
