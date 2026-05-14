# Implementation Plan: Workflow TUI Review Panel Views

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is organized into seven phases. The first phases define the runtime/status review panel summary contract and TUI view-model builder because all review panel rendering depends on typed, read-only presentation data. Middle phases add design review, triage, revision, stale evidence, fixed plan review, automatic plan revision, fallback, and widget integration renderers. Final phases add resilience, security boundary tests, documentation, and validation. All implementation uses TypeScript ES modules under `extensions/clarification-orchestrator/`, keeps TUI review panel modules presentation-only, and preserves runtime authority for evidence, readiness, decisions, approvals, ledgers, artifacts, and workflow state.

## Tasks

- [✅] 1. Phase 1: Define runtime/status review panel summary contract
  - [✅] 1.1 Create review panel summary types
    - Create `extensions/clarification-orchestrator/workflow/review-panel-summary.ts` with `WorkflowReviewPanelSummary`, `DesignReviewSummary`, `DesignRevisionSummary`, `PlanReviewSummary`, `StaleEvidenceSummary`, `ReviewPanelSummaryDiagnostic`, `ArtifactDisplayRef`, `LedgerLinkSummary`, and reviewer/finding/readiness summary types
    - Include topic, run id, generated timestamp, review run ids, artifact refs, versions, paths, checksums, statuses, readiness evidence, stale markers, diagnostics, and display ledger links where available
    - Keep the module type-focused and free of TUI rendering dependencies
    - _Requirements: 1.1, 1.2, 1.4_
  - [✅] 1.2 Add safe summary construction helpers
    - Implement pure helper functions in `workflow/review-panel-summary.ts` such as `createEmptyWorkflowReviewPanelSummary()`, `normalizeReviewPanelDiagnostic()`, and artifact/link formatting helpers needed by status code
    - Represent absent design review, design revision, plan review, or stale evidence sections explicitly through omitted optional fields and diagnostics rather than TUI file discovery
    - Preserve stale, missing, and checksum-mismatched evidence as diagnostics or stale evidence summaries
    - _Requirements: 1.3, 1.5, 1.6_
  - [✅] 1.3 Integrate review panel summary as an optional runtime/status surface
    - Extend `extensions/clarification-orchestrator/workflow/runtime.ts` status result types or a narrow adjacent status helper to optionally expose `WorkflowReviewPanelSummary`
    - Populate at least safe empty summaries and diagnostics for states without review detail, without changing workflow phase or decision semantics
    - Ensure exposed summaries contain no writer handles, mutation callbacks, approval functions, retry functions, revision functions, artifact commit functions, or state transition helpers
    - _Requirements: 1.1, 1.3, 1.4, 9.1_
  - [✅]* 1.4 Write unit tests for summary contract shape
    - Create `tests/unit/workflow-review-panel-summary.test.ts`
    - Test empty summary construction, diagnostic preservation, artifact display refs, stale evidence summary shape, and absence of mutation-like fields
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6_

- [✅] 2. Phase 2: Implement ReviewPanelViewModelBuilder
  - [✅] 2.1 Create TUI review panel view model module
    - Create `extensions/clarification-orchestrator/tui/review-panel-view-model.ts`
    - Define `ReviewPanelViewModel`, `DesignReviewPanelViewModel`, `DesignRevisionPanelViewModel`, `PlanReviewPanelViewModel`, `StaleEvidenceViewModel`, `ReviewPanelDiagnostic`, and related display model types
    - Import only read-only types from `workflow/progress-types.ts`, `workflow/review-panel-summary.ts`, and `workflow/types.ts`
    - _Requirements: 2.1, 9.1_
  - [✅] 2.2 Implement `buildReviewPanelViewModel()`
    - Implement `buildReviewPanelViewModel(input)` that accepts `WorkflowLiveSnapshot` and optional `WorkflowReviewPanelSummary`
    - Preserve topic, run id, phase, optional design review, optional design revision, optional plan review, stale evidence, and diagnostics
    - Return a diagnostic-only view model when no summary is supplied instead of throwing
    - _Requirements: 2.1, 2.4, 8.1_
  - [✅] 2.3 Enforce durable-summary precedence over live progress
    - In the builder, preserve durable summary status for design review, plan review, readiness, and stale evidence when live `snapshot.reviewers` or diagnostics disagree
    - Use live reviewer progress only as presentation hints for running or absent summary data
    - Add diagnostics for summary/snapshot topic or run id mismatch and avoid presenting mismatched evidence as current
    - _Requirements: 2.2, 2.5, 7.3, 8.7_
  - [✅] 2.4 Preserve triage/readiness semantics without recomputation
    - Copy supplied must-fix, should-fix, note, conflict, unresolved question, readiness, and stale markers into the view model without reclassifying or recalculating them
    - Add diagnostics when triage or readiness is missing, malformed, or partially unavailable
    - Omit malformed subsections while continuing to build valid sections
    - _Requirements: 2.3, 2.6, 4.1, 4.3, 7.3, 8.2, 8.3, 8.4_
  - [✅]* 2.5 Write unit tests for view model building
    - Create `tests/unit/workflow-tui-review-panel-view-model.test.ts`
    - Test normal summary mapping, no-summary diagnostic, durable status precedence over live reviewer progress, topic/run mismatch handling, missing triage/readiness diagnostics, malformed subsection omission, and stale evidence preservation
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.4_

- [✅] 3. Phase 3: Add design review, triage, conflict, and readiness renderers
  - [✅] 3.1 Create review panel renderer entrypoint
    - Create `extensions/clarification-orchestrator/tui/review-panel/index.ts` or `extensions/clarification-orchestrator/tui/review-panel-view.ts` with `renderReviewPanelView(viewModel, width)`
    - Compose design review, design revision, stale evidence, plan review, diagnostics, and safe next-action sections while omitting absent sections safely
    - Use existing `extensions/clarification-orchestrator/tui/render-helpers.ts` and `formatters.ts` for width-safe output
    - _Requirements: 7.1, 7.5, 8.4_
  - [✅] 3.2 Implement design review overview and coverage grid rendering
    - Create `extensions/clarification-orchestrator/tui/review-panel/design-review-view.ts`
    - Render review mode, review run id, exact design artifact ref/checksum prefix, review status, selected/unselected reviewer states, reviewer outcomes, finding counts, and output/ledger links
    - Switch from grid-like output to one-reviewer-per-line summaries on narrow widths
    - _Requirements: 3.1, 3.2, 3.3, 3.6_
  - [✅] 3.3 Add partial/incomplete and passed-review warning copy
    - In `design-review-view.ts`, render required warning text for partial/incomplete coverage: incomplete coverage is not a passed review and is not design approval
    - Ensure passed design review output still distinguishes passed review from design approval
    - Render unknown reviewer ids with safe labels and diagnostics
    - _Requirements: 3.4, 3.5, 3.7, 8.6_
  - [✅] 3.4 Implement triage, conflict, unresolved question, and readiness renderers
    - Create `extensions/clarification-orchestrator/tui/review-panel/triage-view.ts` and `extensions/clarification-orchestrator/tui/review-panel/conflict-question-view.ts`
    - Render must-fix, should-fix, and note sections exactly from supplied tier data, including source reviewer/finding ids, affected sections, and ledger links when available
    - Render conflicts, unresolved user questions, blocking markers, source context, and runtime-gated resolution hints
    - Render readiness status/evidence with explicit readiness-is-not-approval wording
    - _Requirements: 4.1, 4.2, 4.4, 4.5, 4.6, 4.7_
  - [✅] 3.5 Render missing triage/readiness diagnostics without inference
    - Ensure absent triage produces a triage-unavailable diagnostic instead of classifying raw findings
    - Ensure absent readiness renders available evidence without implying approval eligibility
    - Add diagnostic rendering in the review panel entrypoint
    - _Requirements: 4.3, 8.2, 8.3, 8.4_
  - [✅]* 3.6 Write unit tests for design review and triage rendering
    - Create `tests/unit/workflow-tui-review-panel-views.test.ts`
    - Test full reviewer grid, narrow reviewer summaries, selected/unselected/succeeded/blocked/failed statuses, incomplete warning text, passed-review-not-approval text, unknown reviewer diagnostics, triage tier rendering, no TUI-side classification when triage is absent, conflicts, unresolved questions, and readiness-is-not-approval text
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.3, 4.7_

- [✅] 4. Phase 4: Add design revision, stale evidence, plan review, and automatic plan revision renderers
  - [✅] 4.1 Implement design revision handoff rendering
    - Create `extensions/clarification-orchestrator/tui/review-panel/design-revision-view.ts`
    - Render current design ref, latest revision id, source design ref, revised design ref when available, source review run id, source triage link, revision status, and post-revision review run id
    - Ensure authorized/running revision states do not imply approval or multi-round authorization
    - _Requirements: 5.1, 5.2_
  - [✅] 4.2 Implement stale evidence rendering
    - Create `extensions/clarification-orchestrator/tui/review-panel/stale-evidence-view.ts`
    - Render stale design review, design triage, design readiness, design revision, plan review, plan readiness, and plan revision evidence in a separate provenance section
    - Include required wording that old review evidence is provenance only and cannot approve the current design artifact
    - Render current and stale artifact refs/checksum prefixes and checksum/artifact mismatch warnings when supplied
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 8.7, 9.4_
  - [✅] 4.3 Implement fixed plan review rendering
    - Create `extensions/clarification-orchestrator/tui/review-panel/plan-review-view.ts`
    - Render plan review run id, status, approved design ref, requirements ref, tasks ref, readiness, ledger links, fixed reviewer identities, reviewer statuses, finding counts, blockers, notes, and output links where available
    - Include required wording that plan review is automatic and fixed, has no skip/minimal/full mode, has no reviewer subset selection, and readiness is not plan approval
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  - [✅] 4.4 Implement automatic plan revision attempt rendering
    - In `plan-review-view.ts`, render automatic plan revision attempt number, max attempts, status, source requirements/tasks refs, revised requirements/tasks refs, reason, and post-revision review run id
    - When revision is exhausted or failed with blockers remaining, direct the user to `/brainstorm-pro --resume` or runtime-gated recovery without presenting plan review controls
    - Ignore unsupported plan review controls from malformed summaries and render diagnostics
    - _Requirements: 6.5, 6.6, 6.7_
  - [✅]* 4.5 Write unit tests for revision, stale evidence, and plan review rendering
    - Extend `tests/unit/workflow-tui-review-panel-views.test.ts`
    - Test design revision source/revised/post-review handoff, authorized/running warning text, stale evidence provenance-only rendering, stale/current artifact refs, fixed three plan reviewers, no plan review mode/subset controls, automatic plan revision `1/1`, exhausted/failed recovery hints, and unsupported control diagnostics
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.4, 6.5, 6.6, 6.7_

- [✅] 5. Phase 5: Integrate review panel views with widget and fallback output
  - [✅] 5.1 Extend `WorkflowLiveWidget` with optional review panel provider
    - Modify `extensions/clarification-orchestrator/tui/workflow-widget.ts` to accept optional `getReviewPanelViewModel?: (snapshot: WorkflowLiveSnapshot) => ReviewPanelViewModel | undefined`
    - Render a `Review panel` section in expanded mode when the provider returns a model
    - Preserve existing Spec 8 read-only behavior and Spec 8.1 interactive behavior when the provider is absent
    - _Requirements: 7.1, 7.2, 9.2_
  - [✅] 5.2 Add deterministic review panel fallback renderer
    - Create `extensions/clarification-orchestrator/tui/review-panel-fallback.ts`
    - Implement `renderReviewPanelFallback(viewModel, options)` for non-TUI and narrow output including concise design review, stale evidence, plan review, automatic revision, diagnostics, and safe next-action hints
    - Prefer `/brainstorm-pro --resume` and `/brainstorm-pro --status` hints without adding public command surfaces
    - _Requirements: 7.3, 7.4, 7.5, 7.7_
  - [✅] 5.3 Wire review panel fallback into existing workflow fallback surfaces
    - Integrate review panel fallback with `extensions/clarification-orchestrator/tui/workflow-result.ts` or command/session presentation boundaries where a `ReviewPanelViewModel` is available
    - Ensure compact mode may remain summary-only while expanded and fallback provide detailed review sections
    - Ensure render failures fall back to existing fail-soft workflow live progress behavior
    - _Requirements: 7.3, 7.4, 7.6, 8.5_
  - [✅]* 5.4 Write widget and fallback tests
    - Create `tests/unit/workflow-tui-review-panel-fallback.test.ts` and extend `tests/unit/workflow-tui-widget.test.ts`
    - Test optional provider integration, absence of provider preserving old output, expanded review panel section, deterministic fallback content, narrow width truncation, safe command hints, and render-failure fail-soft behavior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 8.5_

- [✅] 6. Checkpoint - Verify review panel rendering and fail-soft behavior
  - Run `npm run typecheck`
  - Run `node --test tests/unit/workflow-review-panel-summary.test.ts tests/unit/workflow-tui-review-panel-view-model.test.ts tests/unit/workflow-tui-review-panel-views.test.ts tests/unit/workflow-tui-review-panel-fallback.test.ts tests/unit/workflow-tui-widget.test.ts`
  - Inspect `extensions/clarification-orchestrator/tui/review-panel-view-model.ts`, `extensions/clarification-orchestrator/tui/review-panel/`, `extensions/clarification-orchestrator/tui/review-panel-fallback.ts`, and `extensions/clarification-orchestrator/tui/workflow-widget.ts` to confirm renderers preserve runtime-provided statuses and do not classify findings or decide readiness
  - Confirm requirements 1.1-1.6, 2.1-2.6, 3.1-3.7, 4.1-4.7, 5.1-5.6, 6.1-6.7, 7.1-7.7, and 8.1-8.7 are covered
  - Stop only if typecheck fails, required warning wording is missing, stale evidence appears as current readiness, plan review controls appear, or render failures can affect workflow state

- [✅] 7. Phase 6: Add security boundaries, documentation, and final validation
  - [✅] 7.1 Add static boundary tests for review panel TUI modules
    - Create `tests/security/tui-review-panel-boundary.test.ts`
    - Assert `extensions/clarification-orchestrator/tui/review-panel-view-model.ts`, `extensions/clarification-orchestrator/tui/review-panel/`, and `extensions/clarification-orchestrator/tui/review-panel-fallback.ts` do not import approval writers, review decision writers, review ledger writers, revision ledger writers, artifact commit helpers, state transition helpers, task checkbox writers, or direct workflow file mutation APIs
    - _Requirements: 9.1, 9.2, 9.5_
  - [✅] 7.2 Add product-boundary and plan-control security tests
    - Extend `tests/security/tui-review-panel-boundary.test.ts` or create focused tests
    - Assert review panel renderers do not expose retry, accept-incomplete, approve, revision authorization, plan approval submission, plan review mode/subset, plan partial accept, or per-plan-reviewer retry controls
    - Assert no generic subagent orchestration, background runner, intercom, arbitrary chains, or builtin agent discovery is exposed by Spec 8.2 modules
    - _Requirements: 6.7, 9.2, 9.3, 9.6_
  - [✅] 7.3 Add stale evidence mutation boundary tests
    - Add tests that render stale evidence and verify no workflow files are written and no gate/readiness/update APIs are called
    - Verify stale evidence remains provenance-only in rendered output
    - _Requirements: 5.4, 8.7, 9.4, 9.5_
  - [✅]* 7.4 Update TUI documentation
    - Update `extensions/clarification-orchestrator/tui/README.md` to describe review panel views, runtime/status summary input, view model boundary, stale evidence provenance, fixed plan review display, fallback behavior, and non-goals
    - Update `README.md` only if user-visible TUI behavior needs public documentation
    - _Requirements: 7.7, 9.2, 9.3_
  - [✅]* 7.5 Add documentation alignment tests
    - Update docs tests under `tests/unit/docs/` so docs state review panel views are read-only, stale evidence is provenance only, incomplete review is not approval, and plan review has no mode/subset controls
    - _Requirements: 3.4, 5.4, 6.4, 9.3_
  - [✅]* 7.6 Update pi-subagents reuse inventory if derived helper code is added
    - If any new code is derived from `nicobailon/pi-subagents`, update `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json` and `NOTICE.md`
    - Ensure attribution headers are present where required
    - _Requirements: 9.7_
  - [✅]* 7.7 Run final validation
    - Run `npm run typecheck`
    - Run `npm test`
    - Run `npm run validate-package`
    - Confirm Spec 8.2 files do not change workflow phase semantics, decision semantics, review algorithms, plan review algorithms, public command surface, or runtime authority
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 5.1, 6.1, 7.1, 8.1, 9.1_

## Notes

- Tasks marked with `*` are optional and can be skipped for a minimal implementation, but boundary, warning, stale evidence, and fail-soft behavior should not be skipped in a production PR.
- Spec 8.2 is presentation-only. Runtime/status owns review evidence and readiness, Spec 8.1 owns runtime-gated decisions, and Spec 8.3 owns controlled execution detail views.
- Use existing TypeScript ES module style with explicit `.ts` relative imports, two-space indentation, double quotes, and strict typing.
- Prefer runtime/status summary data over direct ledger reads from TUI modules.
- Preserve the pi-subagents infrastructure-only reuse policy and update attribution if any additional derived helper code is introduced.
