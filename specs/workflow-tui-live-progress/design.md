# Workflow TUI Live Progress Design

## Summary

This spec adds the **Workflow TUI Live Progress** foundation for Brainstorming Pro. It introduces a snapshot-first, fail-soft, foreground live progress UI that renders workflow phase timeline, agent/reviewer/task progress, artifact refs, approval/blocked/failed cards, and non-TUI fallback output while preserving the runtime-first lifecycle model. Spec 8 is the foundation of the R2-Split TUI route: it does not make decisions in the TUI, but it defines the presentation and progress substrate that later Spec 8.1 interactive controls will use to submit runtime-owned decision intent safely.

## Goals

- Provide observable live progress for long-running foreground `/brainstorm-pro` runtime steps.
- Define a stable `WorkflowLiveSnapshot` presentation contract derived from durable workflow state plus in-memory progress events.
- Normalize phase, agent, reviewer, plan-review, and controlled-execution progress into a single read-only snapshot model.
- Render compact and expanded TUI views for current workflow activity.
- Show phase timeline, current activity, durations, token/byte/output-path summaries, artifact refs, and review/task progress.
- Show read-only approval gate, blocked, failed, done, and stale-snapshot cards.
- Provide deterministic markdown/plain-text fallback for non-interactive environments, narrow terminals, stale/corrupt snapshots, or render failures.
- Reuse approved `pi-subagents` infrastructure patterns for width-aware rendering, snapshot-driven updates, spinner lifecycle, and stale context cleanup without inheriting its generic subagent product model.
- Keep TUI rendering isolated from runtime authority: no state mutation, no approval, no review decision writes, no artifact writes, and no lifecycle transitions.
- Establish extension points for Spec 8.1 interactive decisions, Spec 8.2 review detail views, and Spec 8.3 execution detail views.

## Primary Users / Roles

- **Workflow user**: wants to see what `/brainstorm-pro` is doing during long design, review, planning, plan review, and execution phases.
- **Brainstorming Pro maintainer**: needs an observable UI substrate that does not compromise runtime gates or artifact binding.
- **Review operator**: needs live visibility into reviewer progress, partial/failure states, and next safe recovery hints.
- **Implementation agent**: needs a clear boundary between progress emission, snapshot construction, and TUI rendering.
- **Security / reliability reviewer**: needs assurance that TUI output cannot approve gates, accept incomplete reviews, retry reviewers, or mutate workflow files.
- **Future TUI interaction designer**: needs a stable snapshot and rendering foundation for runtime-gated interactive controls in Spec 8.1.

## Non-Goals

- Do not implement interactive approve/retry/reviewer-selection/accept-incomplete/revision controls in Spec 8.
- Do not replace `/brainstorm-pro --resume` or Spec 7 deterministic UX; Spec 8 adds live presentation and fallback formatting.
- Do not introduce a background async runner, detached dashboard, intercom, or persistent watch mode.
- Do not expose generic `subagent`, arbitrary `single` / `parallel` / `chain` / `async` orchestration, or upstream builtin agent discovery.
- Do not directly write `state.json`, `.workflow/events.jsonl`, `.workflow/approvals/*`, `.workflow/decisions/*`, `.workflow/reviews/*`, or artifact markdown files from TUI code.
- Do not treat live snapshots as authoritative workflow state.
- Do not define reviewer prompts, review aggregation, triage algorithms, plan review algorithms, or controlled execution logic.
- Do not implement detailed review finding browser or task execution browser; those belong to Spec 8.2 and Spec 8.3.
- Do not add plan review mode, subset, partial accept, or per-reviewer retry UI; plan review remains automatic and fixed.

## Context

Brainstorming Pro has already converged on a runtime-first architecture with `/brainstorm-pro` as the public workflow intent interface. The runtime owns state transitions, artifact commits, review decisions, approval gates, plan review, controlled execution, and fail-closed behavior. Spec 7 `workflow-ux-interface` defines deterministic CLI/status rendering and establishes `/brainstorm-pro --resume` as the CLI fallback for state-aware decisions.

Existing code and constraints relevant to Spec 8 include:

- `extensions/clarification-orchestrator/workflow/types.ts` defines workflow phases, artifact refs, review status, pending decisions, and error snapshots.
- `extensions/clarification-orchestrator/workflow/ux-renderer.ts` provides deterministic text rendering for status/resume results.
- `extensions/clarification-orchestrator/runtime/agent-execution/types.ts` defines `AgentProgressEvent` and agent run status.
- `extensions/clarification-orchestrator/runtime/agent-execution/progress.ts` emits agent progress and already treats progress callback failures as diagnostics rather than workflow-authoritative failures.
- `extensions/clarification-orchestrator/tui/README.md` reserves future read-only workflow TUI infrastructure.
- `extensions/clarification-orchestrator/workflow/live-snapshot-policy.md` states that live snapshots are presentation-only and must prefer durable state over live progress conflicts.
- `extensions/clarification-orchestrator/tui/render-helpers.ts` contains approved pi-subagents-derived width-aware helpers.
- Pi TUI supports custom components through `ctx.ui.custom(component)`, where components render width-bounded lines and request re-render through a handle.

Spec 8 follows the updated roadmap R2-Split model:

```text
Spec 8:   live progress foundation
Spec 8.1: interactive runtime-gated decisions
Spec 8.2: review panel detail views
Spec 8.3: controlled execution views
```

Spec 8 therefore intentionally stops short of TUI decisions while ensuring the live snapshot model can later carry exact refs, gate identifiers, and diagnostics needed by Spec 8.1.

## Discovery

### Key Discoveries

- The important boundary is not “CLI vs TUI”; it is “runtime authority vs presentation/input surface”. Spec 8 must keep TUI on the presentation side.
- `--resume` already acts as the CLI fallback for state-aware decision gates, but later TUI controls may collect the same decision intent if they call the same runtime validation path.
- Live progress must be foreground-scoped for now. A detached dashboard would imply background async semantics and should remain out of scope.
- Durable workflow state must always win over live progress. Progress events can be missing, delayed, duplicated, stale, or malformed.
- Snapshot-driven rendering avoids coupling TUI widgets directly to phase adapter internals and makes non-TUI fallback easier to test.
- Review panels and controlled execution need different detail views, but a common snapshot foundation can represent phase, agent, reviewer, task, artifact, gate, and diagnostic summaries.
- Pi TUI line-width requirements and theme invalidation rules must be treated as correctness requirements, not cosmetic concerns.
- UI failure must be fail-soft: rendering issues should never corrupt runtime files or convert a recoverable workflow step into failed state.

### Scope Decisions

Included in Spec 8:

- Presentation types for workflow live progress.
- In-memory progress collection for a foreground runtime step.
- Snapshot builder that merges authoritative state with live events.
- Compact and expanded TUI rendering.
- Read-only gate/blocked/failed/done cards.
- Non-TUI fallback.
- Animation lifecycle and stale context cleanup.
- Integration points for agent runtime progress and future reviewer/task progress.
- Tests for snapshot precedence, rendering safety, product boundary, and fail-soft behavior.

Excluded from Spec 8:

- Interactive gate decisions.
- Detailed triage/finding browser.
- Detailed execution task browser.
- Background dashboard.
- Runtime state mutation from TUI.

## Proposed Solution

Implement a **snapshot-first foreground live progress UI**. Runtime phases, adapters, agent execution, review panels, and controlled execution emit progress events into a command-scoped `WorkflowProgressController`. The controller combines in-memory progress with the latest durable workflow state and artifact/review status to produce a monotonic `WorkflowLiveSnapshot`. A `WorkflowLiveWidget` renders the snapshot as compact or expanded TUI output, while a fallback renderer emits deterministic text when TUI is unavailable or unsafe.

Core principles:

```text
Runtime owns lifecycle.
Adapters and agents emit progress.
Snapshot builder derives presentation data.
TUI renders snapshots.
TUI failures fail soft.
Decisions remain runtime-gated.
```

Spec 8 is read-only by implementation, but not by long-term product direction. It intentionally leaves decision-capable controls to Spec 8.1, where TUI controls must submit `RuntimeUserDecision` intent through the same validation path as CLI decisions.

### Architecture

```text
WorkflowRuntimeOrchestrator
  ├─ durable state.json / review status / artifact refs
  ├─ append-only events.jsonl
  └─ foreground phase execution
       ↓ emits
WorkflowProgressEvent
       ↓
WorkflowProgressController
  ├─ stores command-scoped progress events
  ├─ throttles snapshot updates
  ├─ marks stale/closed contexts
  └─ builds WorkflowLiveSnapshot
       ↓
WorkflowLiveWidget / Fallback Renderer
  ├─ compact view
  ├─ expanded view
  ├─ read-only gate cards
  ├─ blocked/failed/done cards
  └─ non-TUI fallback text
```

Snapshot sources, by authority:

1. Durable `WorkflowState` / runtime status object: phase, pending decision, artifact refs, gates, review status, last error.
2. Durable `events.jsonl`: historical phase timeline when available.
3. In-memory progress events: current activity, spinner state, bytes/tokens/duration, reviewer/task live status.
4. Renderer-local presentation state: compact/expanded preference, scroll offset, animation frame.

Only source 1 and runtime-owned writes are authoritative. Sources 2–4 are presentation aids.

### Components

#### 1. `workflow/progress-types.ts`

Defines workflow-level progress and snapshot types.

Suggested event union:

```ts
export type WorkflowProgressEvent =
  | PhaseProgressEvent
  | AgentProgressEvent
  | ReviewerProgressEvent
  | PlanReviewProgressEvent
  | ExecutionTaskProgressEvent
  | ArtifactProgressEvent;
```

Representative events:

```ts
type PhaseProgressEvent =
  | { type: "phase.started"; topic: string; runId: string; phase: WorkflowPhase; at: string }
  | { type: "phase.activity"; topic: string; runId: string; phase: WorkflowPhase; message: string; at: string }
  | { type: "phase.completed"; topic: string; runId: string; phase: WorkflowPhase; status: "succeeded" | "blocked" | "failed"; at: string };

type ReviewerProgressEvent =
  | { type: "reviewer.started"; topic: string; runId: string; reviewRunId: string; target: "design" | "plan"; reviewer: string; at: string }
  | { type: "reviewer.completed"; topic: string; runId: string; reviewRunId: string; target: "design" | "plan"; reviewer: string; status: "passed" | "blocked" | "failed" | "invalid-output" | "timed-out"; findings?: number; at: string }
  | { type: "reviewer.failed"; topic: string; runId: string; reviewRunId: string; target: "design" | "plan"; reviewer: string; reason: string; at: string };

type ExecutionTaskProgressEvent =
  | { type: "task.started"; topic: string; runId: string; taskId: string; title: string; at: string }
  | { type: "task.activity"; topic: string; runId: string; taskId: string; message: string; at: string }
  | { type: "task.completed"; topic: string; runId: string; taskId: string; status: "completed" | "blocked" | "failed"; evidencePath?: string; at: string };
```

Progress events must be append-to-memory only in Spec 8. If a future component also persists progress summary, it must be explicitly runtime-owned and separate from TUI rendering.

#### 2. `WorkflowLiveSnapshot`

Suggested presentation contract:

```ts
export type WorkflowLiveSnapshot = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  phaseStatus: "idle" | "running" | "awaiting-user" | "blocked" | "failed" | "done";
  version: number;
  createdAt: string;
  updatedAt: string;
  stale: boolean;
  staleReason?: string;

  timeline: WorkflowPhaseSnapshot[];
  currentActivity?: WorkflowActivitySnapshot;
  artifacts: ArtifactSnapshot[];
  agents: AgentRunSnapshot[];
  reviewers: ReviewerRunSnapshot[];
  tasks: TaskProgressSnapshot[];
  gates: GateCardSnapshot[];
  diagnostics: DiagnosticSnapshot[];

  fallbackText: string;
};
```

Important snapshot rules:

- `version` increments for every controller-visible change.
- `phase` and `phaseStatus` are derived from durable state first.
- `stale = true` when progress events refer to a different topic/run, old artifact refs, old gate, or a closed command context.
- `fallbackText` must remain useful without ANSI/TUI support.
- Snapshot schemas must avoid `any`; unknown runtime extensions should be captured as typed diagnostics or ignored safely.

#### 3. `WorkflowProgressController`

Suggested path:

```text
extensions/clarification-orchestrator/workflow/live-snapshot-store.ts
```

Responsibilities:

- Hold command-scoped progress events for one foreground runtime invocation.
- Accept `WorkflowProgressEvent` and existing `AgentProgressEvent` through typed methods.
- Deduplicate repeated events by stable key when possible.
- Track started/completed timestamps and derive durations.
- Build `WorkflowLiveSnapshot` from the latest runtime status/state plus progress events.
- Throttle update notifications to avoid excessive `requestRender()` calls.
- Mark itself closed when the command finishes.
- Expose `dispose()` / `close()` for stale context cleanup.

Non-responsibilities:

- No writes to runtime workflow files.
- No runtime state transitions.
- No decision submission.
- No direct child process management.

#### 4. Progress adapter helpers

Suggested path:

```text
extensions/clarification-orchestrator/workflow/progress-adapters.ts
```

Responsibilities:

- Convert `AgentProgressEvent` into `WorkflowProgressEvent` with topic/run context.
- Provide helper emitters for phase adapters and review panels.
- Preserve progress callback fail-soft behavior: progress callback errors become diagnostics, not workflow gate decisions.

Example:

```ts
function agentProgressToWorkflowProgress(
  context: { topic: string; runId: string; phase: WorkflowPhase },
  event: AgentProgressEvent,
): WorkflowProgressEvent;
```

#### 5. `WorkflowLiveWidget`

Suggested path:

```text
extensions/clarification-orchestrator/tui/workflow-widget.ts
```

Implements a Pi TUI `Component`:

```ts
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
}
```

Spec 8 widget input is read-only:

```ts
type WorkflowLiveWidgetOptions = {
  getSnapshot: () => WorkflowLiveSnapshot;
  initialMode?: "compact" | "expanded";
  onClose?: () => void;
};
```

Allowed keyboard behavior in Spec 8:

- Toggle compact / expanded.
- Scroll expanded view if needed.
- Close/hide the widget.
- Re-render.

Disallowed keyboard behavior in Spec 8:

- Approve.
- Retry.
- Accept incomplete.
- Choose review mode.
- Select reviewer subset.
- Authorize revision.
- Mutate state or artifacts.

Every rendered line must respect the `width` argument. Renderers should use the existing width-aware helpers in `tui/render-helpers.ts` and future helpers in `tui/formatters.ts`.

#### 6. Compact renderer

Compact view is low-noise and should fit into a few lines.

Example:

```text
Brainstorming Pro · topic: payment-flow · phase: design-review
● Design review running · 3/5 reviewers done · 1 failed · 02:14
Design v4 · checksum 9af23c12… · /brainstorm-pro --status payment-flow
```

Compact view must show:

- topic;
- phase;
- current activity or phase status;
- aggregate reviewer/agent/task progress when relevant;
- elapsed duration;
- most important artifact ref;
- safe status/resume hint when at a gate or blocked state.

#### 7. Expanded renderer

Expanded view is still bounded, but shows sections:

```text
Brainstorming Pro Live Progress
Topic: payment-flow
Run: run-2026...
Phase: design-review

Timeline:
✓ designing
✓ awaiting-design-review-decision
● design-review
○ awaiting-design-approval

Reviewers:
✓ product-reviewer              8 findings   00:48
● architecture-reviewer         running      01:31
✗ risk-security-reviewer        timed out    retryable

Artifacts:
- design v4 specs/payment-flow/.workflow/artifacts/design/v4.md checksum 9af23c12…

Diagnostics:
- Partial review is not a passed review.
- Use /brainstorm-pro --resume payment-flow for runtime-gated recovery choices.
```

Expanded view sections are optional and only rendered when data exists:

- Header / summary.
- Phase timeline.
- Current activity.
- Agents.
- Reviewers.
- Tasks.
- Artifacts.
- Gate card.
- Diagnostics.
- Safe next commands.

#### 8. Gate cards

Spec 8 gate cards are read-only. They display exact refs and next safe command hints but cannot execute decisions.

Design review decision card:

```text
Awaiting design review decision
Design: v4 checksum 9af23c12…
Choices are runtime-gated: skip, minimal, full, revise, exit.
Use /brainstorm-pro --resume payment-flow to choose.
```

Design approval card:

```text
Awaiting design approval
Design: v4 checksum 9af23c12…
Review readiness: ready-for-user-approval
Review readiness is not approval.
Use /brainstorm-pro --resume payment-flow to approve or revise.
```

Plan approval card:

```text
Awaiting plan approval
Requirements: v2 checksum ...
Tasks: v2 checksum ...
Plan review readiness: ready-for-plan-approval
Use /brainstorm-pro --resume payment-flow to approve or revise.
```

When Spec 8.1 lands, these cards may become interactive controls, but only by submitting runtime-owned decision intent.

#### 9. Blocked / failed / done cards

Blocked card must include:

- blocking phase;
- last error message;
- recoverable flag;
- known recovery actions from runtime status, if available;
- safe next commands;
- warning that ordinary rendering does not auto-advance.

Failed card must include:

- failure phase;
- error message;
- recoverable flag;
- status/ledger hints;
- no retry/approval option unless runtime status explicitly exposes one.

Done card must include:

- topic;
- run id;
- final artifacts;
- execution report summary when available;
- terminal status.

#### 10. Fallback renderer

Suggested path:

```text
extensions/clarification-orchestrator/tui/workflow-result.ts
```

Responsibilities:

- Render a `WorkflowLiveSnapshot` to deterministic markdown/plain text.
- Reuse or align with `workflow/ux-renderer.ts` for state/status summaries.
- Avoid ANSI if non-TUI mode is selected.
- Include artifact refs, diagnostics, and safe next commands.

Fallback is used when:

- Pi TUI custom component is unavailable.
- Non-interactive/CI mode is detected.
- Terminal width is too narrow for safe widget rendering.
- Snapshot builder reports stale/corrupt data.
- Renderer throws.
- User or command disables TUI.

#### 11. TUI session helper

Suggested path:

```text
extensions/clarification-orchestrator/tui/workflow-session.ts
```

Responsibilities:

- Open a `ctx.ui.custom()` component for foreground long-running steps.
- Connect controller update notifications to `handle.requestRender()`.
- Close/hide the component when the runtime step completes or fails.
- Ensure `close()` is called in `finally` blocks.
- Avoid reusing disposed overlay/component references.

The session helper must be optional. Runtime execution must remain correct if TUI cannot be opened.

### Data Flow

#### Foreground runtime step with live TUI

```text
User runs /brainstorm-pro --resume <topic>
  ↓
command handler creates WorkflowProgressController
  ↓
command handler optionally opens WorkflowLiveWidget
  ↓
runtime executes foreground step
  ↓
adapters/agents/reviewers emit progress events
  ↓
controller updates snapshot version
  ↓
widget requestRender() renders compact/expanded snapshot
  ↓
runtime commits artifacts/state/events through existing authority
  ↓
command closes widget and renders final status/fallback summary
```

#### Snapshot construction

```text
latest runtime status/state
  + durable event summaries where available
  + command-scoped progress events
  + renderer preferences
  → WorkflowLiveSnapshot
```

Conflict rule:

```text
Durable state wins.
Live progress can enrich but not override phase, gate, artifact binding, approval, or review readiness.
```

#### Agent progress merge

```text
runAgent(onProgress)
  ↓
AgentProgressEvent
  ↓
agentProgressToWorkflowProgress(context, event)
  ↓
WorkflowProgressController.emit()
  ↓
snapshot.agents / currentActivity update
```

#### Reviewer progress merge

```text
DesignReviewPanel / PlanReviewPanel starts reviewers
  ↓
reviewer.started/completed/failed events
  ↓
snapshot.reviewers update
  ↓
aggregate counts shown in compact/expanded views
```

#### Gate display

```text
runtime state enters awaiting-design-approval
  ↓
snapshot.gates includes design approval card from pendingDecision + artifacts + reviewStatus
  ↓
TUI renders exact design ref and safe next command
  ↓
no decision is submitted by Spec 8 TUI
```

## Error Handling

### Snapshot build failure

If snapshot construction fails due to malformed progress events or unexpected runtime extension data:

- return a minimal snapshot derived from durable state when possible;
- add a diagnostic explaining snapshot degradation;
- use fallback text;
- do not fail the workflow step solely because the snapshot failed.

### Render failure

If TUI render throws:

- close/hide the widget if safe;
- emit fallback text through normal command notification/output;
- record a UI diagnostic if supported;
- do not mutate workflow state or mark the runtime phase failed because of UI rendering.

### Stale snapshot

A snapshot is stale when:

- its topic/run id no longer matches the loaded runtime state;
- it references old artifact refs/checksums;
- its controller is closed but receives late progress;
- it was built from corrupt live progress.

Handling:

- mark `stale = true`;
- render a stale warning;
- prefer durable status values;
- do not expose stale data as readiness or approval evidence.

### Progress callback failure

Progress callback failures are diagnostics. They must not cause agent output to be considered invalid unless the agent runtime itself fails independently. Existing `emitAgentProgress()` behavior should be preserved.

### Terminal width limits

Renderers must obey Pi TUI width constraints. If width is below a configured minimum, render a very compact one- or two-line summary or fallback text.

### Non-interactive execution

In CI, redirected output, or unsupported TUI contexts, skip `ctx.ui.custom()` and emit fallback text. Runtime behavior must be identical to TUI-enabled execution except for presentation.

### Runtime failure while TUI active

Runtime failure/blocked state should close or update the widget to a failed/blocked card, then render final deterministic diagnostics. UI cleanup must run in `finally`.

## Testing

### Unit tests

- `WorkflowLiveSnapshot` builder derives phase/status from durable state.
- Durable state wins over conflicting live progress.
- Snapshot version increments on accepted progress events.
- Late progress after controller close marks diagnostics or is ignored safely.
- Agent progress events normalize into agent snapshots.
- Reviewer events normalize into reviewer snapshots.
- Task events normalize into task snapshots.
- Gate cards include exact artifact refs/checksum prefixes and never imply approval.
- Blocked/failed/done cards render correct diagnostics.
- Compact and expanded renderers respect width constraints.
- Fallback renderer is deterministic and ANSI-free when requested.

### Integration tests

- Long-running agent-backed phase can emit progress to a controller without changing runtime final state.
- TUI session opens and closes around a foreground command step with cleanup in failure paths.
- Non-TUI fallback path produces useful output for the same snapshot.
- Design review with multiple reviewer progress events renders aggregate progress.
- Plan review renders fixed reviewer set without mode/subset controls.
- Controlled execution progress events render task summary without changing task state.

### Security / product boundary tests

- TUI modules do not import gate mutation helpers or write workflow state/approval/review/artifact paths.
- TUI rendering cannot approve design, approve plan, accept incomplete, retry reviewers, or authorize revision.
- Snapshot builder rejects or marks stale progress for mismatched topic/run/artifact refs.
- No public generic subagent UI, arbitrary chain/parallel/async orchestration, intercom, background runner, or builtin agent discovery is exposed.
- Derived `pi-subagents` helper usage remains covered by reuse inventory/attribution validation.

### Documentation alignment tests

- README and roadmap describe Spec 8 as snapshot-first live progress foundation.
- Docs mention Spec 8.1 for interactive runtime-gated TUI decisions.
- Non-TUI fallback remains documented for users and CI.

## Open Questions

1. Should the controller receive runtime status snapshots directly from `resumeWorkflow()`, or should the command handler call `getStatus()` after each major step for final snapshot reconciliation?
2. What exact capability check should determine TUI availability: command context support only, TTY detection, environment flag, or explicit user/package option?
3. Should compact/expanded mode be toggled only during the current command, or persisted as a user preference later?
4. What is the minimum terminal width before falling back to plain text?
5. Should progress events ever be persisted as a summarized live-progress artifact, or should Spec 8 remain purely in-memory plus durable events?
6. What stable identifiers should reviewer/task progress use before review/task ledgers are fully written?
7. Should Spec 8.1 add a narrower `submitWorkflowDecision()` runtime API, or reuse `resumeWorkflow()` with a decision payload?
8. How should TUI update frequency be bounded for very noisy stdout/token events: fixed throttle, coalescing by event type, or adaptive throttling?

## Follow-up Specs

### Spec 8.1: `workflow-tui-interactive-decisions`

Adds runtime-gated TUI controls for design review mode, reviewer subset selection, approval gates, failed reviewer retry, accept incomplete confirmation, and design revision authorization. TUI submits decision intent; runtime validates and persists.

### Spec 8.2: `workflow-tui-review-panel-views`

Adds deeper design/plan review visualization: reviewer grid, coverage, must-fix/should-fix/note summaries, conflicts, unresolved questions, revision handoff, fixed plan review detail, and stale evidence display.

### Spec 8.3: `workflow-tui-controlled-execution-views`

Adds task-level controlled execution visualization: task timeline, current task, checkpoint-as-task display, evidence paths, blocked task diagnostics, unauthorized mutation warnings, and execution report summary.
