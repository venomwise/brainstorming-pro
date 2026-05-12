# Requirements Document: Workflow TUI Live Progress

## Introduction

Workflow TUI Live Progress provides a snapshot-first, fail-soft live progress presentation layer for Brainstorming Pro foreground `/brainstorm-pro` workflow steps. It helps workflow users, maintainers, and reviewers observe long-running design, review, planning, plan review, and controlled execution phases without compromising the runtime-first lifecycle model.

The system defines typed workflow progress events, a `WorkflowLiveSnapshot` presentation contract, a command-scoped progress controller, compact and expanded Pi TUI renderers, read-only gate/diagnostic cards, and deterministic non-TUI fallback output. It is explicitly presentation-only: durable workflow state, artifact refs, review decisions, approvals, and lifecycle transitions remain owned by the workflow runtime. Interactive decision controls, detailed review browsers, controlled execution detail browsers, and background dashboards are out of scope for this spec and are reserved for follow-up 8.x specs.

## Glossary

- **Workflow Runtime**: The Brainstorming Pro runtime that owns workflow phases, artifact refs, review decisions, approval gates, events, and state transitions.
- **WorkflowLiveSnapshot**: A read-only presentation object derived from durable workflow state, durable event summaries, and command-scoped progress events.
- **WorkflowProgressEvent**: A normalized event representing phase, agent, reviewer, plan review, task, or artifact progress for live presentation.
- **WorkflowProgressController**: A command-scoped in-memory collector that accepts progress events, builds snapshots, throttles updates, and cleans up stale contexts.
- **Durable State**: Runtime-owned persisted data such as `state.json`, artifact refs, review status, pending decisions, and last error snapshots.
- **Live Progress**: In-memory progress emitted by the currently running foreground runtime step; it can enrich but never override durable state.
- **TUI**: Terminal User Interface rendered through Pi custom components.
- **Compact View**: A low-noise TUI view summarizing topic, phase, current activity, aggregate progress, duration, and safe status hints.
- **Expanded View**: A richer TUI view with sections such as timeline, agents, reviewers, tasks, artifacts, gates, diagnostics, and safe next commands.
- **Gate Card**: A read-only presentation of a pending review/approval gate, exact artifact binding, readiness summary, and safe next command.
- **Fallback Renderer**: Deterministic markdown/plain-text output used when TUI rendering is unavailable, disabled, unsafe, stale, or failed.
- **R2-Split**: The roadmap route where Spec 8 implements live progress foundation and later 8.x specs add runtime-gated interactivity and deeper detail views.

## Requirements

### Requirement 1: Workflow progress event contract

**User Story:** As an implementation agent, I want a typed progress event contract, so that runtime phases, agents, reviewers, plan review, and controlled execution can report live activity consistently.

#### Acceptance Criteria

1. WHEN implementing Spec 8 progress support, THEN the system SHALL define `WorkflowProgressEvent` types for phase progress, agent progress, reviewer progress, plan review progress, task progress, and artifact progress.
2. WHEN existing `AgentProgressEvent` values are received, THEN the system SHALL normalize them into workflow-scoped progress data with topic, run id, and phase context.
3. WHEN reviewer progress is emitted, THEN the event contract SHALL include review run id, review target, reviewer id, status, timestamp, and optional finding count or failure reason.
4. WHEN task progress is emitted, THEN the event contract SHALL include task id, title or activity, status, timestamp, and optional evidence/output path.
5. IF an event is missing required topic/run/phase identity, THEN the controller SHALL reject it or record a diagnostic rather than using it as authoritative progress.
6. IF future event variants are introduced, THEN existing snapshot construction SHALL ignore unknown variants safely or surface typed diagnostics without throwing during normal rendering.

### Requirement 2: Workflow live snapshot contract

**User Story:** As a TUI implementer, I want a stable `WorkflowLiveSnapshot` contract, so that compact, expanded, and fallback renderers can share one presentation model.

#### Acceptance Criteria

1. WHEN a snapshot is built, THEN it SHALL include topic, run id, phase, phase status, version, timestamps, stale marker, timeline, current activity, artifacts, agents, reviewers, tasks, gates, diagnostics, and fallback text.
2. WHEN durable workflow state provides phase, pending decision, artifact refs, gates, review status, or last error, THEN the snapshot SHALL derive those authoritative fields from durable state rather than live progress.
3. WHEN live progress conflicts with durable state, THEN the snapshot SHALL prefer durable state and record a diagnostic or stale marker when appropriate.
4. WHEN a snapshot references stale topic/run/artifact/gate context, THEN it SHALL set `stale = true` and include a clear stale reason.
5. WHEN snapshot data is insufficient for a rich view, THEN it SHALL still provide a minimal fallback text summary derived from durable state where possible.
6. IF snapshot construction encounters malformed live progress, THEN it SHALL degrade to a minimal snapshot or fallback diagnostic without mutating workflow state.

### Requirement 3: Command-scoped progress controller

**User Story:** As a maintainer, I want a command-scoped progress controller, so that foreground runtime steps can be observed without introducing background async semantics.

#### Acceptance Criteria

1. WHEN a foreground runtime step starts, THEN the command handler or runtime integration SHALL be able to create a `WorkflowProgressController` for that topic/run invocation.
2. WHEN progress events arrive, THEN the controller SHALL store them in memory, update derived snapshot data, and increment snapshot version for visible changes.
3. WHEN high-frequency events arrive, THEN the controller SHALL coalesce or throttle render notifications to avoid excessive TUI redraws.
4. WHEN the foreground command finishes, fails, or is cancelled, THEN the controller SHALL close or dispose itself and stop treating later progress as current.
5. IF late progress arrives after close, THEN the controller SHALL ignore it or record a stale diagnostic without reopening the workflow context.
6. IF the controller fails to process a progress callback, THEN the failure SHALL be recorded as a diagnostic and SHALL NOT cause workflow phase failure by itself.

### Requirement 4: Snapshot builder state precedence and aggregation

**User Story:** As a reliability reviewer, I want snapshot building to prefer runtime-owned data, so that live UI cannot misrepresent lifecycle state or gate readiness.

#### Acceptance Criteria

1. WHEN building a snapshot, THEN durable workflow state SHALL be the source of truth for phase, phase status, pending decision, artifact refs, review status, gates, and last error.
2. WHEN durable events are available, THEN the builder MAY use them to enrich timeline history without overriding current durable state.
3. WHEN in-memory progress is available, THEN the builder MAY use it for current activity, durations, byte/token/output summaries, reviewer/task status, and spinner state.
4. WHEN review progress is partial or failed, THEN the snapshot SHALL NOT render it as passed or approval-ready unless durable runtime review status says so.
5. WHEN plan review progress is shown, THEN the snapshot SHALL preserve the fixed automatic plan review model and SHALL NOT expose user-selectable mode, subset, partial accept, or per-reviewer retry controls.
6. IF snapshot enrichment fails, THEN the builder SHALL return durable-state-derived summary data instead of throwing when possible.

### Requirement 5: Compact live TUI rendering

**User Story:** As a workflow user, I want a compact live progress view, so that I can monitor long-running steps without excessive terminal noise.

#### Acceptance Criteria

1. WHEN compact rendering is enabled, THEN the TUI SHALL show topic, phase, current activity or phase status, elapsed duration, and a concise artifact or safe command hint.
2. WHEN reviewer, agent, or task progress exists, THEN the compact view SHALL show aggregate counts such as completed/running/failed where relevant.
3. WHEN the workflow is at a gate, blocked, failed, or done, THEN the compact view SHALL show the corresponding read-only state and a safe status/resume hint where applicable.
4. WHEN the terminal width is constrained, THEN every rendered line SHALL be truncated or adapted so it does not exceed the provided width.
5. IF the compact renderer cannot safely render the snapshot, THEN the system SHALL fall back to deterministic text output rather than corrupting TUI output or workflow state.

### Requirement 6: Expanded live TUI rendering

**User Story:** As a review operator, I want an expanded live progress view, so that I can inspect timeline, agents, reviewers, tasks, artifacts, diagnostics, and safe next commands during a workflow run.

#### Acceptance Criteria

1. WHEN expanded rendering is enabled, THEN the TUI SHALL render sections for summary, timeline, current activity, agents, reviewers, tasks, artifacts, gate cards, diagnostics, and safe next commands when data exists.
2. WHEN phase timeline data is available, THEN the expanded view SHALL show completed, current, pending, blocked, failed, and done phases with clear glyphs or labels.
3. WHEN agent snapshots exist, THEN the expanded view SHALL show role, status, duration, retry/output summary, and output path when available.
4. WHEN reviewer snapshots exist, THEN the expanded view SHALL show reviewer id, target, status, duration, findings count or failure reason, and review run context when available.
5. WHEN task snapshots exist, THEN the expanded view SHALL show task id/title, status, current activity, duration, and evidence/output path when available.
6. WHEN content exceeds visible space, THEN the renderer SHALL support bounded output through truncation, scroll metadata, or fallback text without exceeding line width.
7. IF an expanded section has no data, THEN the renderer SHALL omit that section rather than displaying misleading empty success states.

### Requirement 7: Read-only gate and diagnostic cards

**User Story:** As a workflow user, I want gate and diagnostic cards to show exact bindings and next safe actions, so that I understand what is pending without accidentally approving or advancing the workflow.

#### Acceptance Criteria

1. WHEN the workflow is awaiting design review decision, THEN the gate card SHALL show the current design artifact ref/checksum and available runtime-gated choices as read-only information.
2. WHEN the workflow is awaiting design approval, THEN the gate card SHALL show the exact design ref/checksum, review status/readiness summary, and a warning that readiness is not approval.
3. WHEN the workflow is awaiting plan approval, THEN the gate card SHALL show reviewed/latest requirements and tasks refs when available, plan review readiness, and a warning that runtime will validate approval binding.
4. WHEN the workflow is blocked, THEN the diagnostic card SHALL show phase, error message, recoverable flag, known recovery hints, and safe next commands without auto-advancing.
5. WHEN the workflow is failed, THEN the diagnostic card SHALL show failure phase, message, recoverable flag, and diagnostics without showing unauthorized retry/approval actions.
6. WHEN the workflow is done, THEN the card SHALL show terminal status and final artifact/report summaries where available without suggesting resume-next action.
7. IF a snapshot is stale, THEN all gate and diagnostic cards SHALL clearly mark stale status and SHALL NOT present stale readiness as executable approval evidence.

### Requirement 8: Deterministic non-TUI fallback

**User Story:** As a user in non-interactive terminals or CI, I want readable fallback output, so that workflow progress and diagnostics remain understandable without TUI support.

#### Acceptance Criteria

1. WHEN TUI support is unavailable, disabled, or unsafe, THEN the system SHALL render deterministic markdown/plain-text fallback from `WorkflowLiveSnapshot`.
2. WHEN the terminal is too narrow or non-interactive, THEN the system SHALL skip custom TUI rendering and use fallback output.
3. WHEN snapshot building or TUI rendering fails, THEN fallback output SHALL include available durable state, artifacts, diagnostics, and safe next commands.
4. WHEN fallback output is requested in plain mode, THEN it SHALL avoid ANSI styling and animation artifacts.
5. WHEN compared with TUI-enabled execution, THEN fallback execution SHALL preserve the same runtime behavior and differ only in presentation.

### Requirement 9: TUI session lifecycle and cleanup

**User Story:** As a maintainer, I want TUI sessions to open and close safely around foreground runtime steps, so that stale UI handles do not leak across commands.

#### Acceptance Criteria

1. WHEN a long-running foreground step begins and TUI is available, THEN the command path SHALL be able to open a `WorkflowLiveWidget` through Pi custom component support.
2. WHEN snapshots update, THEN the TUI session SHALL request re-render through the component handle using throttled update notifications.
3. WHEN the runtime step completes, blocks, fails, or throws, THEN the TUI session SHALL close or hide the component in a `finally`-safe cleanup path.
4. WHEN an overlay/component has been disposed, THEN the implementation SHALL NOT reuse stale component references.
5. IF TUI session setup fails, THEN the workflow step SHALL continue with fallback output and no runtime state mutation caused by the UI failure.
6. IF command execution is non-interactive, THEN the session helper SHALL not attempt to open a TUI component.

### Requirement 10: Rendering safety and width-aware formatting

**User Story:** As a Pi TUI user, I want rendering to respect terminal constraints, so that the UI remains stable across widths, themes, and Unicode content.

#### Acceptance Criteria

1. WHEN rendering any TUI line, THEN the implementation SHALL ensure the visible width does not exceed the `render(width)` argument.
2. WHEN rendering long paths, checksums, findings, diagnostics, or activity messages, THEN the implementation SHALL truncate, wrap, or summarize them safely.
3. WHEN rendering ANSI-styled content, THEN the implementation SHALL preserve visible width calculations and avoid style leakage across lines.
4. WHEN the theme changes or the component invalidates, THEN cached render state SHALL be cleared so future renders use current theme/state.
5. WHEN Unicode or wide characters appear in text, THEN width-aware helpers SHALL handle them without overflowing rows.
6. IF width-safe rendering cannot be guaranteed for a snapshot, THEN the renderer SHALL degrade to compact or fallback output.

### Requirement 11: Runtime authority and product-boundary enforcement

**User Story:** As a security reviewer, I want the TUI to remain presentation-only, so that workflow gates and product boundaries cannot be bypassed.

#### Acceptance Criteria

1. WHEN TUI modules are implemented, THEN they SHALL NOT directly import or call workflow gate mutation helpers, approval writers, review decision writers, artifact writers, or state transition helpers.
2. WHEN TUI renders gate cards, THEN it SHALL NOT approve design, approve plan, choose review mode, retry reviewers, accept incomplete review, authorize revision, select tasks, write checkboxes, or validate evidence.
3. WHEN progress/snapshot data is stale or malformed, THEN the TUI SHALL mark it stale or fallback rather than converting it into readiness or approval evidence.
4. WHEN adapting pi-subagents-derived helpers, THEN the implementation SHALL preserve attribution and SHALL NOT expose generic subagent command/tool, arbitrary orchestration, intercom, background async runner, or builtin agent discovery.
5. IF a future interactive TUI is added, THEN Spec 8 components SHALL provide only presentation foundation; decision submission SHALL be implemented through a runtime-owned validation path in a follow-up spec.

### Requirement 12: Integration extension points for follow-up TUI specs

**User Story:** As a future TUI interaction designer, I want stable extension points, so that interactive decisions, review detail views, and execution detail views can be added without rewriting the live progress foundation.

#### Acceptance Criteria

1. WHEN defining snapshot gate data, THEN it SHALL include enough exact artifact/gate context for future runtime-gated interactive controls without making Spec 8 controls interactive.
2. WHEN defining reviewer snapshots, THEN they SHALL carry reviewer identity, target, run context, status, and paths needed by future review detail views.
3. WHEN defining task snapshots, THEN they SHALL carry task identity, status, activity, and evidence/output path needed by future controlled execution views.
4. WHEN rendering cards or sections, THEN the implementation SHALL keep presentation components decoupled from decision persistence APIs.
5. IF follow-up specs add interactive controls, THEN existing Spec 8 fallback and read-only rendering SHALL remain usable for non-interactive environments.
