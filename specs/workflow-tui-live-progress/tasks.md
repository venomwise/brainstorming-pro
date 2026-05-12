# Implementation Plan: Workflow TUI Live Progress

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is organized into seven phases. The first phases establish typed progress/snapshot contracts and a command-scoped controller, because all rendering depends on a stable presentation model. Middle phases add fallback, compact/expanded TUI rendering, and session lifecycle integration. Final phases add read-only runtime integration, safety documentation, and validation tests. The implementation uses TypeScript ES modules under `extensions/clarification-orchestrator/`, reuses existing width-aware helpers in `tui/render-helpers.ts`, and keeps all TUI modules presentation-only.

## Tasks

- [✅] 1. Phase 1: Define progress and snapshot contracts
  - [✅] 1.1 Create workflow progress event types
    - Create `extensions/clarification-orchestrator/workflow/progress-types.ts` with `WorkflowProgressEvent`, `PhaseProgressEvent`, `ReviewerProgressEvent`, `PlanReviewProgressEvent`, `ExecutionTaskProgressEvent`, and `ArtifactProgressEvent`
    - Re-export or import existing `AgentProgressEvent` from `runtime/agent-execution/types.ts` without duplicating agent runtime semantics
    - Include required topic, run id, phase/target identity, timestamp, status, and optional output/finding/evidence fields as described in `design.md`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [✅] 1.2 Define live snapshot presentation types
    - Add `WorkflowLiveSnapshot`, `WorkflowPhaseSnapshot`, `WorkflowActivitySnapshot`, `ArtifactSnapshot`, `AgentRunSnapshot`, `ReviewerRunSnapshot`, `TaskProgressSnapshot`, `GateCardSnapshot`, and `DiagnosticSnapshot` in `workflow/progress-types.ts`
    - Ensure snapshot fields include topic, run id, phase, phase status, version, timestamps, stale marker, stale reason, fallback text, and typed arrays for timeline/artifacts/agents/reviewers/tasks/gates/diagnostics
    - Avoid `any`; use `unknown` only for explicitly opaque runtime extension data with diagnostics
    - _Requirements: 2.1, 2.5, 12.1, 12.2, 12.3_
  - [✅] 1.3 Add event validation and identity helpers
    - Implement helper functions in `workflow/progress-types.ts` such as `isWorkflowProgressEventForRun()`, `progressEventTimestamp()`, and `progressEventKey()`
    - Reject or classify progress events missing topic/run identity so the controller can record diagnostics safely
    - _Requirements: 1.5, 1.6, 3.2_
  - [✅]* 1.4 Write unit tests for progress and snapshot types
    - Create `tests/unit/workflow-tui-progress-types.test.ts`
    - Test required event identity handling, event key stability, unknown/malformed event classification, and snapshot shape construction helpers
    - _Requirements: 1.1, 1.5, 1.6, 2.1_

- [✅] 2. Phase 2: Implement the workflow progress controller and snapshot builder
  - [✅] 2.1 Create command-scoped controller module
    - Create `extensions/clarification-orchestrator/workflow/live-snapshot-store.ts` with `WorkflowProgressController`
    - Implement `emit(event)`, `getSnapshot(runtimeStateOrStatus)`, `subscribe(listener)`, `close()`, and `dispose()` or equivalent typed methods
    - Store events in memory only and mark late events after close as ignored or diagnostic data
    - _Requirements: 3.1, 3.2, 3.4, 3.5_
  - [✅] 2.2 Implement durable-state-first snapshot construction
    - In `live-snapshot-store.ts`, build snapshots from `WorkflowState` or runtime status-like input plus in-memory progress events
    - Derive phase, phase status, pending gate cards, artifact refs, review status, and last error from durable state/status first
    - Use live progress only for current activity, durations, aggregate counts, output summaries, and reviewer/task details
    - _Requirements: 2.2, 2.3, 4.1, 4.2, 4.3_
  - [✅] 2.3 Implement stale and diagnostic handling
    - Mark snapshots stale for topic/run mismatch, old artifact/gate references, closed-controller late progress, or corrupt live progress
    - Add diagnostics without throwing when enrichment fails
    - Ensure stale snapshots never expose stale readiness or approval evidence
    - _Requirements: 2.4, 2.6, 4.4, 7.7, 11.3_
  - [✅] 2.4 Implement update throttling/coalescing
    - Add controller notification throttling for high-frequency events such as output byte updates
    - Coalesce repeated output/activity events where possible while preserving final status events
    - _Requirements: 3.3, 9.2_
  - [✅] 2.5 Create progress adapter helpers
    - Create `extensions/clarification-orchestrator/workflow/progress-adapters.ts`
    - Implement `agentProgressToWorkflowProgress()` and helper emitters for phase/reviewer/task/artifact progress
    - Preserve fail-soft semantics by returning diagnostics or callback-safe wrappers rather than throwing during progress emission
    - _Requirements: 1.2, 3.6, 4.3_
  - [✅]* 2.6 Write controller and snapshot unit tests
    - Create `tests/unit/workflow-live-snapshot-store.test.ts`
    - Test durable state precedence over conflicting live progress, snapshot version increments, stale markers, late progress after close, throttled notifications, and minimal fallback snapshot on malformed progress
    - _Requirements: 2.2, 2.3, 2.4, 2.6, 3.2, 3.3, 3.5, 4.1_

- [✅] 3. Phase 3: Implement fallback and width-safe formatting foundations
  - [✅] 3.1 Add workflow TUI formatters
    - Create or extend `extensions/clarification-orchestrator/tui/formatters.ts` with helpers for duration, count, status glyphs, checksum prefixes, artifact labels, path shortening, and safe command hints
    - Reuse existing `tui/render-helpers.ts` for width calculations and truncation
    - _Requirements: 5.4, 8.4, 10.1, 10.2, 10.5_
  - [✅] 3.2 Implement deterministic fallback renderer
    - Create `extensions/clarification-orchestrator/tui/workflow-result.ts`
    - Implement `renderWorkflowLiveSnapshotFallback(snapshot, options)` for markdown/plain-text output
    - Include phase summary, artifacts, gate cards, diagnostics, stale warning, and safe next commands
    - Align wording with `workflow/ux-renderer.ts` without making TUI fallback authoritative
    - _Requirements: 2.5, 8.1, 8.3, 8.4, 8.5_
  - [✅] 3.3 Implement stale/corrupt fallback behavior
    - Ensure fallback renderer clearly marks stale snapshots and degraded snapshot diagnostics
    - Ensure fallback output remains useful when only durable state-derived minimal data exists
    - _Requirements: 2.4, 2.6, 7.7, 8.3_
  - [✅]* 3.4 Write fallback and formatter unit tests
    - Create `tests/unit/workflow-tui-fallback.test.ts`
    - Test ANSI-free plain output, deterministic text, checksum/path formatting, stale warnings, gate cards, and narrow-width-safe summaries
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 10.1, 10.2_

- [✅] 4. Phase 4: Implement compact and expanded TUI widget rendering
  - [✅] 4.1 Create the workflow live widget component
    - Create `extensions/clarification-orchestrator/tui/workflow-widget.ts`
    - Implement `WorkflowLiveWidget` with `render(width)`, `handleInput(data)`, and `invalidate()` compatible with Pi TUI component expectations
    - Accept `getSnapshot`, `initialMode`, and optional close callback as read-only inputs
    - _Requirements: 5.1, 6.1, 9.1, 10.4, 12.4_
  - [✅] 4.2 Implement compact renderer
    - In `workflow-widget.ts` or a helper module, implement compact rendering for topic, phase, current activity/status, aggregate agent/reviewer/task counts, elapsed duration, artifact summary, and safe status/resume hint
    - Ensure compact gate/blocked/failed/done summaries are read-only and concise
    - _Requirements: 5.1, 5.2, 5.3, 5.4_
  - [✅] 4.3 Implement expanded renderer sections
    - Implement expanded rendering sections for summary, phase timeline, current activity, agents, reviewers, tasks, artifacts, gate card, diagnostics, and safe next commands
    - Omit sections with no data rather than displaying misleading empty success states
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_
  - [✅] 4.4 Implement read-only gate and diagnostic cards
    - Add rendering helpers for design review decision, design approval, plan approval, blocked, failed, done, and stale cards
    - Include exact artifact refs/checksum prefixes and warnings that readiness is not approval
    - Do not attach decision callbacks or state mutation behavior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 11.2_
  - [✅] 4.5 Implement keyboard behavior limited to presentation
    - Support compact/expanded toggle, scroll metadata if needed, close/hide, and re-render only
    - Ensure keyboard handling cannot approve, retry, accept incomplete, choose review mode, select reviewers, authorize revision, select tasks, write checkboxes, or validate evidence
    - _Requirements: 11.1, 11.2, 12.4_
  - [✅]* 4.6 Write widget renderer unit tests
    - Create `tests/unit/workflow-tui-widget.test.ts`
    - Test compact and expanded output for running, gate, blocked, failed, done, stale, reviewer, agent, and task snapshots
    - Assert every rendered line respects supplied width for narrow and wide terminal cases
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.6, 7.1, 10.1_

- [✅] 5. Checkpoint - Verify snapshot and renderer foundation
  - Run `npm run typecheck`
  - Run `node --test tests/unit/workflow-tui-progress-types.test.ts tests/unit/workflow-live-snapshot-store.test.ts tests/unit/workflow-tui-fallback.test.ts tests/unit/workflow-tui-widget.test.ts`
  - Inspect `extensions/clarification-orchestrator/workflow/progress-types.ts`, `workflow/live-snapshot-store.ts`, `tui/workflow-result.ts`, and `tui/workflow-widget.ts` to confirm no runtime mutation helpers are imported
  - Confirm requirements 1.1-1.6, 2.1-2.6, 3.1-3.6, 5.1-5.4, 6.1-6.7, 7.1-7.7, 8.1-8.5, 10.1-10.6, and 11.1-11.3 are covered
  - Stop only if typecheck fails, width-safe rendering fails, stale snapshot precedence fails, or TUI modules mutate workflow authority

- [✅] 6. Phase 5: Add TUI session lifecycle and optional command/runtime integration
  - [✅] 6.1 Implement TUI session helper
    - Create `extensions/clarification-orchestrator/tui/workflow-session.ts`
    - Implement a helper that opens `ctx.ui.custom()` when available, connects controller updates to `requestRender()`, and closes/hides the component in `finally` paths
    - Ensure session setup failure falls back to text output without affecting runtime execution
    - _Requirements: 8.2, 8.5, 9.1, 9.2, 9.3, 9.5, 9.6_
  - [✅] 6.2 Add TUI availability and fallback policy
    - Add a small policy helper for non-interactive/CI/unsupported/narrow-terminal cases, using existing package option patterns if applicable
    - Ensure fallback renderer is used when TUI is disabled or unavailable
    - _Requirements: 8.1, 8.2, 8.5, 9.6_
  - [✅] 6.3 Wire progress controller into `/brainstorm-pro` foreground resume path as optional presentation
    - Modify `extensions/clarification-orchestrator/commands/brainstorm-pro.ts` only at the presentation boundary to create a controller/session for long-running foreground runtime calls when supported
    - Do not change runtime decision semantics or public command surface
    - Ensure final status/fallback summary is rendered after widget cleanup
    - _Requirements: 3.1, 8.5, 9.1, 9.3, 11.1, 12.5_
  - [✅] 6.4 Pass progress callbacks to agent-backed phase/review integrations where already supported
    - Update adapter/review invocation boundaries only where a progress callback is already accepted or can be added without changing workflow authority
    - Use `progress-adapters.ts` to convert `AgentProgressEvent` values into workflow progress
    - Keep progress callback failures diagnostic-only
    - _Requirements: 1.2, 3.6, 4.3, 6.3, 6.4_
  - [✅]* 6.5 Write integration tests for session lifecycle and fallback
    - Create `tests/integration/workflow-tui-live-progress.test.ts`
    - Test TUI session open/close around a simulated long-running step, fallback when TUI unavailable, cleanup on runtime error, and identical runtime final state with and without TUI
    - _Requirements: 8.5, 9.1, 9.2, 9.3, 9.5, 9.6_

- [✅] 7. Phase 6: Enforce safety and product boundaries
  - [✅] 7.1 Add static boundary tests for TUI modules
    - Create `tests/security/workflow-tui-boundary.test.ts`
    - Assert `extensions/clarification-orchestrator/tui/*.ts` and workflow progress presentation modules do not import approval writers, decision writers, gate mutation helpers, state transition helpers, artifact commit helpers, or review ledger mutation helpers except approved read-only types/helpers
    - _Requirements: 11.1, 11.2, 11.5_
  - [✅] 7.2 Add product-boundary tests for generic subagent concepts
    - Extend existing pi-subagents reuse validation tests or create `tests/security/workflow-tui-product-boundary.test.ts`
    - Assert no public generic subagent UI, arbitrary `single`/`parallel`/`chain`/`async` orchestration, intercom, background runner, or builtin agent discovery is exposed by Spec 8 TUI modules
    - _Requirements: 11.4_
  - [✅] 7.3 Add plan review UI boundary tests
    - Add unit/security coverage ensuring plan review snapshots/cards never render skip/minimal/full mode, reviewer subset selection, partial accept, or per-reviewer retry controls
    - _Requirements: 4.5, 11.2_
  - [✅] 7.4 Add execution authority boundary tests
    - Add coverage ensuring task snapshots/cards never select tasks, write checkboxes, validate evidence, or advance execution state
    - _Requirements: 11.2, 12.3_
  - [✅]* 7.5 Update reuse inventory if new derived TUI helper code is added
    - If any new code is derived from `nicobailon/pi-subagents`, update `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json` and `NOTICE.md`
    - Ensure required attribution headers are present
    - _Requirements: 11.4_

- [✅] 8. Phase 7: Documentation and final validation
  - [✅] 8.1 Update TUI scaffold documentation
    - Update `extensions/clarification-orchestrator/tui/README.md` to describe implemented live snapshot, widget, fallback renderer, session helper, and non-goals
    - Mention that Spec 8.1 is responsible for interactive runtime-gated decisions
    - _Requirements: 8.1, 11.5, 12.5_
  - [✅] 8.2 Update public README/status documentation if user-visible output changes
    - Update `README.md` testing/development or runtime UX sections only as needed to mention live progress and non-TUI fallback
    - Keep public command surface unchanged
    - _Requirements: 8.1, 8.5, 12.5_
  - [✅] 8.3 Add documentation alignment tests
    - Add or update docs tests under `tests/unit/docs/` to keep README/roadmap/TUI docs aligned with snapshot-first foundation and 8.1 interactive decision boundary
    - _Requirements: 11.5, 12.5_
  - [✅] 8.4 Run full validation
    - Run `npm run typecheck`
    - Run `npm test`
    - Run `npm run validate-package`
    - Confirm Spec 8 files do not alter runtime gate semantics or public command surface
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for a minimal implementation, but boundary and fallback behavior should not be skipped in a production PR.
- Spec 8 intentionally implements presentation-only live progress. Interactive controls belong to Spec 8.1 and must submit runtime-owned decision intent through the same validation path as CLI decisions.
- Use existing TypeScript ES module style with explicit `.ts` relative imports, two-space indentation, double quotes, and strict typing.
- Preserve the pi-subagents infrastructure-only reuse policy and update attribution if any additional derived helper code is introduced.
