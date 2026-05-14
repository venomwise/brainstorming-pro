# Requirements Document: Workflow TUI Review Panel Views

## Introduction

Workflow TUI Review Panel Views adds read-only expanded and fallback review detail rendering to Brainstorming Pro's snapshot-first TUI. It helps workflow users, design review operators, plan approval reviewers, and maintainers understand design review coverage, triage tiers, conflicts, unresolved questions, design revision handoff, stale evidence provenance, fixed plan review, and automatic plan revision state without turning the TUI into workflow authority.

The system is built around a runtime/status-owned review panel summary contract, a presentation-only `ReviewPanelViewModelBuilder`, width-safe TUI renderers, deterministic fallback output, and strict mutation-boundary tests. Runtime remains the source of truth for review evidence, artifact bindings, stale markers, readiness, decisions, approvals, review ledgers, revision ledgers, and workflow transitions. TUI code renders summaries and safe next-action hints only; it does not execute reviewers, scan or mutate ledgers directly, recompute triage/readiness, approve gates, retry reviewers, accept incomplete reviews, authorize revision, or expose plan review controls.

## Glossary

- **Workflow Runtime**: The Brainstorming Pro runtime that owns workflow state, artifact refs, review evidence, revision records, approval gates, events, ledgers, and transitions.
- **WorkflowLiveSnapshot**: The read-only presentation object from Spec 8 that combines durable workflow state with foreground progress events for live rendering.
- **WorkflowReviewPanelSummary**: A runtime/status-owned display-safe summary of design review, design revision, plan review, plan revision, stale evidence, and diagnostics.
- **ReviewPanelViewModel**: A TUI-owned read-only display model derived from `WorkflowLiveSnapshot` and `WorkflowReviewPanelSummary`.
- **ReviewPanelViewModelBuilder**: The presentation adapter that converts runtime/status summaries into `ReviewPanelViewModel` instances without reading or writing workflow files.
- **Design Review Coverage**: The reviewer participation and outcome summary for selected, unselected, succeeded, blocked, failed, invalid-output, timed-out, running, partial, incomplete, or stale design reviewers.
- **Triage Tiers**: Runtime-produced finding groups classified as must-fix, should-fix, and notes.
- **Readiness**: Runtime-produced evidence that an artifact may be ready for a user approval gate; readiness is not approval.
- **Stale Evidence**: Review, triage, readiness, or revision evidence bound to old artifact refs/checksums and usable only as provenance.
- **Fixed Plan Review**: The automatic plan review that always uses `requirements-coverage-reviewer`, `task-coverage-reviewer`, and `dependency-order-reviewer` with no user-selected mode or subset.
- **Automatic Plan Revision**: The runtime-owned, at-most-once requirements/tasks revision attempt after plan-only blockers.
- **Deterministic Fallback**: Width-safe, non-TUI text rendering that preserves review meaning in unsupported, non-interactive, narrow, or failed render contexts.

## Requirements

### Requirement 1: Runtime review panel summary contract

**User Story:** As a TUI implementer, I want runtime/status to expose display-safe review summaries, so that TUI code can render review detail without scanning durable workflow files or inferring workflow truth.

#### Acceptance Criteria

1. WHEN Spec 8.2 is implemented, THEN the system SHALL define a typed `WorkflowReviewPanelSummary` contract for topic, run id, generation timestamp, design review summary, design revision summary, plan review summary, stale evidence, and diagnostics.
2. WHEN runtime/status provides review panel data, THEN each summary SHALL carry relevant review run ids, artifact refs, artifact versions, paths, checksums, status values, readiness evidence, stale markers, and ledger display links where available.
3. WHEN no review, revision, or plan evidence exists for the current workflow state, THEN the summary contract SHALL represent the missing section explicitly or omit it safely without requiring TUI file-system discovery.
4. WHEN summary data is exposed to TUI code, THEN it SHALL NOT expose writer handles, mutation callbacks, approval functions, retry functions, revision functions, artifact commit functions, or state transition helpers.
5. IF durable review evidence is stale, missing, or checksum-mismatched, THEN the summary SHALL preserve that stale or diagnostic state for presentation rather than normalizing it into current readiness.
6. IF summary construction cannot load optional evidence, THEN runtime/status SHALL provide a diagnostic summary item without changing workflow state.

### Requirement 2: Review panel view model builder

**User Story:** As a maintainer, I want a presentation-only builder to adapt runtime summaries into TUI models, so that rendering stays testable and does not duplicate review algorithms.

#### Acceptance Criteria

1. WHEN given a `WorkflowLiveSnapshot` and optional `WorkflowReviewPanelSummary`, THEN `ReviewPanelViewModelBuilder` SHALL produce a `ReviewPanelViewModel` containing topic, run id, phase, optional design review, optional design revision, optional plan review, stale evidence, and diagnostics.
2. WHEN durable summary status and live progress disagree, THEN the builder SHALL preserve durable summary status as authoritative and use live progress only as a presentation hint for running or absent summary sections.
3. WHEN triage tiers, conflicts, unresolved questions, readiness, or stale markers are supplied by the summary, THEN the builder SHALL copy them into the view model without reclassifying findings or recalculating readiness.
4. WHEN no summary is supplied, THEN the builder SHALL return a view model with a diagnostic explaining that review panel detail is unavailable, without throwing.
5. WHEN summary topic or run id differs from the snapshot, THEN the builder SHALL mark the view model diagnostic as context mismatch and avoid presenting mismatched evidence as current.
6. IF malformed or partially missing summary fields are encountered, THEN the builder SHALL omit only the malformed subsection, add diagnostics, and continue building safe remaining sections.

### Requirement 3: Design review overview and coverage rendering

**User Story:** As a design review operator, I want to see reviewer coverage and outcomes clearly, so that I understand whether a design review is passed, blocked, partial, incomplete, failed, or stale before choosing a safe next action.

#### Acceptance Criteria

1. WHEN design review summary exists, THEN the TUI SHALL render review mode, review run id, exact design artifact ref/checksum, review status, and reviewer coverage.
2. WHEN rendering full design reviewer coverage, THEN the TUI SHALL distinguish selected, unselected, passed, blocked, failed, invalid-output, timed-out, running, and stale reviewer rows where supplied.
3. WHEN reviewer finding counts or output/ledger links are supplied, THEN the coverage view SHALL render them without requiring direct ledger reads.
4. WHEN review coverage is partial or incomplete, THEN the TUI SHALL display warning text that incomplete coverage is not a passed review and is not design approval.
5. WHEN review status is passed, THEN the TUI SHALL still distinguish passed review from design approval and SHALL NOT imply that approval has occurred.
6. WHEN terminal width is too narrow for a grid, THEN the TUI SHALL render one-reviewer-per-line summaries that preserve status, selection, and finding count meaning.
7. IF an unknown reviewer id appears, THEN the TUI SHALL render it as an unknown reviewer with a diagnostic instead of failing.

### Requirement 4: Triage, conflict, unresolved question, and readiness rendering

**User Story:** As a workflow user, I want review findings and review disagreements summarized from runtime-produced triage, so that I can understand what must be fixed, what should be considered, and what questions remain unresolved.

#### Acceptance Criteria

1. WHEN triage tiers are supplied, THEN the TUI SHALL render must-fix, should-fix, and note sections using the supplied tier membership.
2. WHEN source reviewer ids, finding ids, affected sections, or ledger links are supplied for finding clusters, THEN the TUI SHALL render those provenance details in a compact, width-safe form.
3. WHEN triage tiers are absent, THEN the TUI SHALL show that triage is unavailable and SHALL NOT classify raw findings into tiers.
4. WHEN conflict summaries are supplied, THEN the TUI SHALL render conflict category, description, involved reviewers/findings, and consequence where available.
5. WHEN unresolved user questions are supplied, THEN the TUI SHALL render question ids, prompts, blocking status, and source context where available.
6. WHEN unresolved questions are rendered, THEN the TUI SHALL state or imply only runtime-gated resume/decision paths can answer or resolve them, not the renderer itself.
7. WHEN readiness is supplied, THEN the TUI SHALL render readiness status and evidence links while stating that readiness is not approval.

### Requirement 5: Design revision handoff and stale evidence views

**User Story:** As a workflow user, I want design revision and stale review evidence shown as provenance, so that I can understand why a design changed without accidentally relying on old evidence for current approval.

#### Acceptance Criteria

1. WHEN design revision summary exists, THEN the TUI SHALL render current design ref, latest revision id, source design ref, revised design ref when available, source review run id, source triage link when available, revision status, and post-revision review run id when available.
2. WHEN a design revision is authorized or running, THEN the TUI SHALL render the revision status without implying that the design has been approved or that multi-round revision is authorized.
3. WHEN stale design review, triage, readiness, or revision evidence is supplied, THEN the TUI SHALL render it in a separate stale evidence or provenance section.
4. WHEN stale evidence is rendered, THEN the TUI SHALL explicitly state that old review evidence is provenance only and cannot approve the current design artifact.
5. WHEN current and stale artifact refs are supplied, THEN the TUI SHALL render both current and stale refs/checksum prefixes in width-safe form.
6. IF stale evidence has checksum or artifact mismatch diagnostics, THEN the TUI SHALL render them as warnings and SHALL NOT render that evidence as current readiness.

### Requirement 6: Fixed plan review and automatic plan revision rendering

**User Story:** As a plan approval reviewer, I want fixed plan review and automatic plan revision state shown clearly, so that I can verify approved design, requirements, and tasks were reviewed without seeing unsupported plan review controls.

#### Acceptance Criteria

1. WHEN plan review summary exists, THEN the TUI SHALL render plan review run id, status, approved design ref, requirements ref, tasks ref, readiness, and ledger links where available.
2. WHEN rendering plan reviewers, THEN the TUI SHALL render exactly the fixed reviewer identities supplied from the fixed set: `requirements-coverage-reviewer`, `task-coverage-reviewer`, and `dependency-order-reviewer`.
3. WHEN fixed reviewer status, finding counts, blockers, notes, or output links are supplied, THEN the TUI SHALL render them in the plan review panel.
4. WHEN plan review is rendered, THEN the TUI SHALL state that plan review is automatic and fixed, has no skip/minimal/full mode, has no reviewer subset selection, and readiness is not plan approval.
5. WHEN automatic plan revision summary exists, THEN the TUI SHALL render attempt number, max attempts, status, source requirements/tasks refs, revised requirements/tasks refs when available, reason, and post-revision review run id when available.
6. WHEN automatic plan revision is exhausted or failed and blockers remain, THEN the TUI SHALL direct the user to `/brainstorm-pro --resume` or runtime-gated recovery without presenting plan review controls.
7. IF a summary attempts to expose plan review mode/subset/partial accept/per-reviewer retry controls, THEN the TUI SHALL ignore those unsupported controls and render a diagnostic.

### Requirement 7: Widget integration and deterministic fallback rendering

**User Story:** As a terminal user, I want review panel details integrated into expanded TUI and fallback output, so that review evidence remains understandable across terminal capabilities.

#### Acceptance Criteria

1. WHEN `WorkflowLiveWidget` is configured with a review panel view model provider, THEN expanded rendering SHALL include a Review panel section built from the returned view model.
2. WHEN no review panel provider is configured, THEN existing Spec 8 and Spec 8.1 widget behavior SHALL remain unchanged.
3. WHEN review panel rendering is unavailable, unsupported, or fails, THEN the system SHALL fall back to deterministic text output without changing workflow state.
4. WHEN fallback rendering is used, THEN it SHALL include concise design review, stale evidence, plan review, automatic revision, diagnostics, and safe next-action hints when available.
5. WHEN terminal width is narrow, THEN both TUI and fallback renderers SHALL truncate or summarize lines using existing width-aware helpers and SHALL preserve critical warning wording.
6. WHEN compact mode is used, THEN the implementation MAY omit detailed review panel sections, but expanded mode and fallback SHALL remain available for review detail.
7. WHEN rendering safe next actions, THEN the TUI SHALL prefer `/brainstorm-pro --resume` and `/brainstorm-pro --status` hints and SHALL NOT invent new public command surfaces.

### Requirement 8: Fail-soft diagnostics and resilience

**User Story:** As a workflow user, I want missing or inconsistent review detail to degrade safely, so that UI issues do not corrupt or fail the workflow.

#### Acceptance Criteria

1. WHEN review summary is missing, THEN the TUI SHALL render a diagnostic such as review panel detail unavailable and suggest `/brainstorm-pro --status` or `/brainstorm-pro --resume`.
2. WHEN triage summary is missing but coverage exists, THEN the TUI SHALL render coverage and a triage-unavailable diagnostic.
3. WHEN readiness is missing, THEN the TUI SHALL render available evidence and state that readiness is unavailable without implying approval eligibility.
4. WHEN malformed summary data is encountered, THEN the TUI SHALL omit the malformed section, render diagnostics, and continue rendering valid sections.
5. WHEN renderer exceptions occur, THEN the TUI SHALL use existing fail-soft fallback behavior and SHALL NOT mark the workflow failed solely due to UI rendering failure.
6. WHEN unknown status values or reviewer ids appear, THEN the TUI SHALL render safe unknown labels and diagnostics instead of throwing.
7. WHEN stale or checksum-mismatched evidence is encountered, THEN the TUI SHALL render warnings and SHALL NOT present it as current approval evidence.

### Requirement 9: Runtime authority and TUI boundary enforcement

**User Story:** As a security reviewer, I want review panel TUI code to remain read-only, so that it cannot mutate workflow evidence, decisions, approvals, artifacts, or execution state.

#### Acceptance Criteria

1. WHEN Spec 8.2 TUI modules are implemented, THEN they SHALL NOT import approval writers, review decision writers, review ledger writers, revision ledger writers, artifact commit helpers, state transition helpers, task checkbox writers, or direct workflow file mutation APIs.
2. WHEN review panel views render design review recovery context, THEN they SHALL NOT submit retry, accept-incomplete, approval, revision, or plan approval decisions.
3. WHEN plan review is rendered, THEN TUI review panel modules SHALL NOT expose plan review mode, reviewer subset, partial accept, or per-reviewer retry controls.
4. WHEN stale evidence is rendered, THEN TUI modules SHALL NOT use it to update gates, approvals, readiness, or runtime state.
5. WHEN workflow files are inspected during tests, THEN Spec 8.2 TUI rendering SHALL NOT write `.workflow/*`, `design.md`, `requirements.md`, or `tasks.md`.
6. WHEN implementing Spec 8.2, THEN the package SHALL NOT expose generic subagent orchestration, background runner, intercom, arbitrary chains, or builtin agent discovery.
7. IF new code is derived from `nicobailon/pi-subagents`, THEN reuse inventory and attribution SHALL be updated according to repository policy.
