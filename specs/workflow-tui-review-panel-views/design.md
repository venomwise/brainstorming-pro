# Workflow TUI Review Panel Views Design

## Summary

Spec 8.2 adds **Workflow TUI Review Panel Views** for Brainstorming Pro. It introduces a read-only `ReviewPanelViewModelBuilder` and expanded/fallback TUI renderers that make design review, design revision, stale review evidence, fixed plan review, and automatic plan revision evidence understandable to users. The TUI consumes runtime/status-provided review summaries plus the current `WorkflowLiveSnapshot`, but it does not execute reviewers, read/write review ledgers directly, recompute triage/readiness, approve gates, retry reviewers, accept incomplete reviews, authorize revision, or mutate workflow artifacts.

## Goals

- Render detailed design review and plan review evidence in expanded TUI views.
- Keep review panel views read-only and presentation-only.
- Introduce a `ReviewPanelViewModelBuilder` that adapts runtime/status review summaries and `WorkflowLiveSnapshot` into stable display models.
- Show full design reviewer coverage, including selected, unselected, succeeded, blocked, failed, invalid-output, timed-out, partial, incomplete, and stale states.
- Clearly distinguish incomplete/partial review, passed review, readiness, and user approval.
- Render triage tiers from runtime-produced triage evidence: must-fix, should-fix, and notes.
- Render conflicts and unresolved user questions without resolving or answering them in TUI code.
- Render design revision handoff, post-revision review, and stale evidence provenance.
- Render fixed three-reviewer plan review and exact approved design / requirements / tasks artifact bindings.
- Render automatic-once plan revision attempt and post-revision review state.
- Provide deterministic non-TUI fallback and narrow-terminal rendering.
- Fail soft when summaries are missing, stale, malformed, or partially unavailable.
- Preserve the runtime-first security boundary: TUI displays evidence and safe next-action hints only.

## Primary Users / Roles

- **Workflow user**: needs to understand what multi-agent review found, which reviewers participated, what must be fixed, and why the workflow is ready, blocked, incomplete, or stale.
- **Design review operator**: needs coverage, triage, conflict, unresolved-question, retry/accept context, and stale evidence visibility before choosing a runtime-gated next action.
- **Plan approval reviewer**: needs to see whether fixed plan reviewers validated approved design → requirements → tasks, and whether automatic plan revision was already used.
- **Brainstorming Pro maintainer**: needs a testable presentation layer that does not duplicate review algorithms or bypass runtime gates.
- **Security / reliability reviewer**: needs confidence that TUI review detail cannot approve artifacts, accept incomplete evidence, mutate ledgers, or use stale evidence as current approval basis.
- **Future TUI implementer**: needs stable view models that can coexist with Spec 8.1 interactive controls and Spec 8.3 execution views.

## Non-Goals

- Do not implement reviewer roles, reviewer prompts, reviewer execution, or reviewer retry mechanics.
- Do not implement finding normalization, aggregation, triage classification, conflict detection, unresolved-question extraction, or readiness algorithms.
- Do not allow TUI modules to directly read or write `.workflow/reviews/*`, `.workflow/revisions/*`, `.workflow/approvals/*`, `.workflow/decisions/*`, `state.json`, `events.jsonl`, `design.md`, `requirements.md`, or `tasks.md`.
- Do not approve design or plan from Spec 8.2 views.
- Do not retry failed reviewers, accept incomplete review, request/authorize design revision, or submit any decision from Spec 8.2 views.
- Do not expose plan review `skip | minimal | full`, plan reviewer subset selection, plan partial accept, or per-plan-reviewer retry controls.
- Do not change design review panel, design revision loop, or plan review panel runtime behavior.
- Do not introduce background dashboards, detached runners, generic subagent UI, intercom, or arbitrary orchestration.
- Do not make TUI-rendered evidence authoritative for workflow transitions.

## Context

Brainstorming Pro follows a runtime-first workflow architecture. `/brainstorm-pro` is the public workflow intent interface; runtime owns phases, artifact commits, event logs, review decisions, approval gates, design revision, plan review, plan revision, and controlled execution. Spec 8 added a snapshot-first live progress foundation through `WorkflowLiveSnapshot`, `WorkflowProgressController`, compact/expanded TUI rendering, gate cards, and fallback output. Spec 8.1 adds interactive controls that can collect user intent but must submit decisions through runtime-owned validation.

The existing expanded widget can already render generic reviewer progress from `WorkflowLiveSnapshot.reviewers`, but review evidence is richer than a flat list. Design review includes reviewer selection/coverage, partial or incomplete states, triage tiers, conflicts, unresolved user questions, stale evidence, and revision handoff. Plan review includes fixed reviewer identity, exact approved design / requirements / tasks binding, automatic-once plan revision, and plan approval readiness. Rendering these directly from low-level progress rows would either lose important meaning or tempt TUI code to infer runtime truth.

Spec 8.2 therefore introduces a dedicated presentation adapter:

```text
WorkflowRuntimeStatus
  + WorkflowLiveSnapshot
  + runtime-exposed review summaries
  + triage/readiness summaries
  + revision summaries
        ↓
ReviewPanelViewModelBuilder
        ↓
ReviewPanelViewModel
        ↓
TUI Review Panel Views / deterministic fallback
```

Relevant existing modules include:

- `extensions/clarification-orchestrator/workflow/progress-types.ts` for `WorkflowLiveSnapshot` and reviewer progress snapshots.
- `extensions/clarification-orchestrator/workflow/live-snapshot-store.ts` for foreground live progress snapshot construction.
- `extensions/clarification-orchestrator/tui/workflow-widget.ts` for compact/expanded widget rendering.
- `extensions/clarification-orchestrator/tui/workflow-result.ts` for fallback rendering.
- `extensions/clarification-orchestrator/workflow/adapters/design-review/*` for durable design review, triage, readiness, coverage, retry, and accept-incomplete runtime data.
- `extensions/clarification-orchestrator/workflow/adapters/design-revision/*` for design revision handoff, stale source binding, and post-revision review records.
- `extensions/clarification-orchestrator/workflow/adapters/plan-review/*` for fixed plan review, readiness, and automatic-once plan revision records.

## Discovery

### Key Discoveries

- Review detail is too semantically dense for the base `reviewers[]` progress list. Users need coverage, tiers, conflicts, readiness, and stale evidence context.
- TUI should not scan review ledger directories directly. Runtime/status should expose summary-level evidence, and TUI should adapt that evidence for display.
- The safest boundary is a read-only view model layer: it can shape runtime-owned evidence for rendering but cannot recompute review truth or submit decisions.
- Partial/incomplete review wording is safety-critical. The UI must state that incomplete coverage is not a passed review and not design approval.
- Stale review evidence should remain visible as provenance, especially after design revision, but must never appear as current approval evidence.
- Plan review must be visually distinct from design review. It is automatic, fixed, has exactly three reviewers, has no mode/subset controls, and may run one automatic requirements/tasks revision.
- Runtime-produced triage/readiness is the source of truth. Spec 8.2 must not classify findings or decide readiness based on rendered text.
- Narrow-terminal and non-TUI fallback are not secondary output paths; they are required for deterministic review understanding in non-interactive contexts.

### Scope Decisions

Included:

- Runtime/status summary contract for review panel presentation data.
- `ReviewPanelViewModelBuilder`.
- Design review overview and reviewer coverage grid.
- Partial/incomplete warning card.
- Triage tier summary rendering.
- Conflict and unresolved-question rendering.
- Design revision handoff and stale evidence rendering.
- Fixed plan review panel rendering.
- Automatic plan revision attempt rendering.
- Deterministic fallback rendering.
- Security tests for TUI mutation boundary.

Excluded:

- New review/revision/plan algorithms.
- Direct ledger reads/writes by TUI.
- Any decision authority in Spec 8.2 views.
- Plan review controls or mode selection.
- Execution task detail views, which belong to Spec 8.3.

## Proposed Solution

Implement a **runtime-summary-to-view-model review presentation layer**. Runtime/status exposes summary-level design review, design revision, plan review, plan revision, readiness, and stale evidence data. `ReviewPanelViewModelBuilder` combines those summaries with the current `WorkflowLiveSnapshot` to produce a `ReviewPanelViewModel`. The expanded `WorkflowLiveWidget` renders this view model under a review panel section, and a fallback renderer emits deterministic text for non-TUI or narrow terminals.

Core principles:

```text
Runtime owns evidence and readiness.
Runtime/status exposes summaries.
ViewModelBuilder adapts summaries for display.
TUI renders only.
TUI does not read ledgers directly.
TUI does not recompute review truth.
TUI does not approve, retry, accept, revise, or mutate.
```

### Architecture

```text
Workflow Runtime / Status
  ├─ current WorkflowRuntimeStatus
  ├─ current WorkflowLiveSnapshot
  ├─ design review summary
  ├─ design triage/readiness summary
  ├─ design revision summary
  ├─ plan review summary
  └─ plan revision summary
        ↓
ReviewPanelViewModelBuilder
  ├─ validates display-level shape
  ├─ preserves runtime stale/readiness states
  ├─ merges live reviewer progress where safe
  ├─ adds presentation diagnostics
  └─ never reads/writes workflow files
        ↓
ReviewPanelViewModel
        ↓
TUI renderers
  ├─ DesignReviewOverviewView
  ├─ ReviewerCoverageGridView
  ├─ TriageSummaryView
  ├─ ConflictAndQuestionView
  ├─ DesignRevisionHandoffView
  ├─ StaleEvidenceView
  ├─ PlanReviewPanelView
  ├─ PlanRevisionAttemptView
  └─ ReviewPanelFallbackRenderer
```

The command/session layer should pass a runtime/status-derived review summary provider into the widget. The widget remains generic and does not acquire file-system or workflow mutation authority.

### Components

#### 1. Runtime Review Panel Summary Contract

Suggested module ownership:

```text
extensions/clarification-orchestrator/workflow/review-panel-summary.ts
```

This contract is runtime/status-owned, not TUI-owned. It should expose display-safe summary data derived from durable review/revision ledgers and runtime state.

Representative shape:

```ts
export type WorkflowReviewPanelSummary = {
  topic: string;
  runId: string;
  generatedAt: string;
  designReview?: DesignReviewSummary;
  designRevision?: DesignRevisionSummary;
  planReview?: PlanReviewSummary;
  staleEvidence: StaleEvidenceSummary[];
  diagnostics: ReviewPanelSummaryDiagnostic[];
};
```

Rules:

- Summary data must be derived by runtime/status code that is allowed to read durable workflow evidence.
- Summary records must carry artifact refs, checksums, review run ids, and stale markers when available.
- Summary records must not expose writer handles, mutation callbacks, or direct approval/retry/revision functions.
- Missing summaries should be represented explicitly, not inferred by TUI from file paths.

#### 2. `ReviewPanelViewModelBuilder`

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel-view-model.ts
```

Input:

```ts
export type ReviewPanelViewModelInput = {
  snapshot: WorkflowLiveSnapshot;
  summary?: WorkflowReviewPanelSummary;
};
```

Output:

```ts
export type ReviewPanelViewModel = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  designReview?: DesignReviewPanelViewModel;
  designRevision?: DesignRevisionPanelViewModel;
  planReview?: PlanReviewPanelViewModel;
  staleEvidence: StaleEvidenceViewModel[];
  diagnostics: ReviewPanelDiagnostic[];
};
```

Responsibilities:

- Convert runtime/status summaries into display-oriented models.
- Preserve runtime-provided statuses such as `passed`, `blocked`, `failed`, `partial`, `incomplete`, and `stale`.
- Preserve runtime-provided triage tiers, conflicts, unresolved questions, readiness status, and stale evidence markers.
- Merge live reviewer progress from `WorkflowLiveSnapshot.reviewers` only as presentation hints when summary state is absent or running; live progress must not override durable summary status.
- Add diagnostics for missing summary, missing triage, missing readiness, stale evidence, checksum mismatch, or inconsistent display input.
- Never classify findings, decide readiness, approve, retry, accept incomplete, authorize revision, or write files.

#### 3. `DesignReviewPanelViewModel`

Represents current design review evidence:

```ts
export type DesignReviewPanelViewModel = {
  reviewRunId: string;
  designRef: ArtifactDisplayRef;
  mode: "skip" | "minimal" | "full";
  status: "running" | "passed" | "blocked" | "failed" | "partial" | "incomplete" | "stale";
  coverage: ReviewerCoverageViewModel;
  findings?: FindingTierSummaryViewModel;
  conflicts: ConflictViewModel[];
  unresolvedQuestions: UnresolvedQuestionViewModel[];
  readiness?: ReadinessViewModel;
  ledgerLinks: LedgerLinkViewModel[];
};
```

Rendering must emphasize:

- Review mode.
- Exact design artifact binding.
- Reviewer coverage.
- Finding tier counts and details.
- Conflicts and unresolved user questions.
- Readiness is not approval.
- Incomplete review is not passed review.

#### 4. Reviewer Coverage Grid

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel/design-review-view.ts
```

Renderer responsibilities:

- Show each known full design reviewer role.
- Show whether the reviewer was selected or unselected.
- Show reviewer status: `passed`, `blocked`, `failed`, `invalid-output`, `timed-out`, `running`, `unselected`, or `stale`.
- Show finding count and output/ledger path when provided.
- Show partial/incomplete warning card when coverage is not complete.
- Avoid wide tables on narrow terminals by switching to one-reviewer-per-line summaries.

Required warning wording for incomplete coverage:

```text
Incomplete coverage is not a passed review.
This is not design approval.
Use /brainstorm-pro --resume or runtime-gated TUI controls for safe recovery actions.
```

#### 5. Triage Summary View

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel/triage-view.ts
```

Renders runtime-produced triage tiers:

```ts
export type FindingTierSummaryViewModel = {
  mustFix: FindingClusterViewModel[];
  shouldFix: FindingClusterViewModel[];
  notes: FindingClusterViewModel[];
};
```

Rules:

- Render the tiers exactly as supplied by summary data.
- Do not promote or demote findings in TUI code.
- If triage is absent, show an unavailable diagnostic rather than classifying raw findings.
- Include source reviewer/finding ids and affected sections when provided.

#### 6. Conflict and Unresolved Question Views

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel/conflict-question-view.ts
```

Responsibilities:

- Render severity disagreement, recommendation conflict, scope conflict, readiness disagreement, or other runtime-produced conflict categories.
- Render unresolved user questions with ids, prompts, source findings, and blocking/non-blocking status when provided.
- State that unresolved questions must be handled through runtime-gated resume/decision paths, not by TUI rendering.

#### 7. Design Revision Handoff View

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel/design-revision-view.ts
```

Representative model:

```ts
export type DesignRevisionPanelViewModel = {
  currentDesignRef: ArtifactDisplayRef;
  latestRevision?: {
    revisionId: string;
    sourceDesignRef: ArtifactDisplayRef;
    revisedDesignRef?: ArtifactDisplayRef;
    sourceReviewRunId: string;
    sourceTriageRef?: LedgerLinkViewModel;
    status: "authorized" | "running" | "committed" | "failed" | "stale";
    postRevisionReviewRunId?: string;
  };
  staleEvidence: StaleEvidenceViewModel[];
};
```

Rendering must show:

- Source design ref/checksum.
- Revised design ref/checksum when committed.
- Source review and triage refs.
- Post-revision review run id when present.
- Stale source evidence as provenance only.

Required stale wording:

```text
Old review evidence is provenance only.
It cannot approve the current design artifact.
```

#### 8. Plan Review Panel View

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel/plan-review-view.ts
```

Representative model:

```ts
export type PlanReviewPanelViewModel = {
  reviewRunId: string;
  status: "running" | "passed" | "blocked" | "failed" | "stale";
  bindings: {
    approvedDesign: ArtifactDisplayRef;
    requirements: ArtifactDisplayRef;
    tasks: ArtifactDisplayRef;
  };
  reviewers: FixedPlanReviewerViewModel[];
  readiness?: ReadinessViewModel;
  automaticRevision?: PlanRevisionAttemptViewModel;
  ledgerLinks: LedgerLinkViewModel[];
};
```

Plan review rendering must always state:

```text
Plan review is automatic and fixed.
There is no skip/minimal/full mode and no reviewer subset selection.
Readiness is not plan approval.
```

The fixed reviewer list is exactly:

- `requirements-coverage-reviewer`
- `task-coverage-reviewer`
- `dependency-order-reviewer`

No plan reviewer controls are rendered by Spec 8.2.

#### 9. Plan Revision Attempt View

Representative model:

```ts
export type PlanRevisionAttemptViewModel = {
  attemptNumber: 1;
  maxAttempts: 1;
  status: "not-needed" | "running" | "committed" | "failed" | "exhausted";
  sourceRequirementsRef?: ArtifactDisplayRef;
  sourceTasksRef?: ArtifactDisplayRef;
  revisedRequirementsRef?: ArtifactDisplayRef;
  revisedTasksRef?: ArtifactDisplayRef;
  reason?: string;
  postRevisionReviewRunId?: string;
};
```

Rendering must show whether the single automatic plan revision attempt was used and whether blockers remain. If exhausted, it must direct the user to runtime-gated recovery through `/brainstorm-pro --resume`.

#### 10. Stale Evidence View

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel/stale-evidence-view.ts
```

Representative model:

```ts
export type StaleEvidenceViewModel = {
  kind: "design-review" | "design-triage" | "design-readiness" | "design-revision" | "plan-review" | "plan-readiness" | "plan-revision";
  ref: LedgerLinkViewModel;
  reason: string;
  currentArtifactRefs: ArtifactDisplayRef[];
  staleArtifactRefs: ArtifactDisplayRef[];
  provenanceOnly: true;
};
```

Rules:

- Stale evidence is rendered under a separate provenance section.
- Stale evidence is never rendered as current readiness or approval evidence.
- Any checksum mismatch or artifact mismatch should be shown as warning-level diagnostic.

#### 11. Review Panel Fallback Renderer

Suggested path:

```text
extensions/clarification-orchestrator/tui/review-panel-fallback.ts
```

Responsibilities:

- Render deterministic text from `ReviewPanelViewModel`.
- Respect width constraints.
- Prefer summary-first rendering for narrow terminals.
- Avoid ANSI-dependent meaning.
- Include safe next-action hints, normally `/brainstorm-pro --resume` and `/brainstorm-pro --status`.

Example narrow fallback:

```text
Review summary:
Design review incomplete: 3/5 reviewers succeeded, 1 failed, 1 unselected.
Findings: 2 must-fix, 1 should-fix, 3 notes.
Conflicts: 1. Unresolved questions: 1.
This is not design approval. Use /brainstorm-pro --resume for safe next actions.
```

#### 12. Workflow Widget Integration

Extend widget options without giving the widget workflow authority:

```ts
export type WorkflowLiveWidgetOptions = {
  getSnapshot: () => WorkflowLiveSnapshot;
  getReviewPanelViewModel?: (snapshot: WorkflowLiveSnapshot) => ReviewPanelViewModel | undefined;
  // existing options...
};
```

Expanded rendering can append:

```ts
const reviewPanel = this.getReviewPanelViewModel?.(snapshot);
if (reviewPanel) {
  section(lines, "Review panel", renderReviewPanelView(reviewPanel, safeWidth));
}
```

The widget should not receive raw ledger paths that it must load itself. It receives already-summarized evidence and renders it.

### Data Flow

#### Design Review Detail Rendering

```text
Design review panel / triage / readiness writes durable evidence
  ↓
Runtime/status builds WorkflowReviewPanelSummary
  ↓
WorkflowProgressController builds current WorkflowLiveSnapshot
  ↓
ReviewPanelViewModelBuilder combines summary + snapshot
  ↓
Expanded TUI renders coverage, findings, conflicts, questions, readiness
```

Durable summary wins over live progress. Live reviewer events may show current activity for running reviewers, but cannot override completed durable review state.

#### Partial or Incomplete Design Review Rendering

```text
Runtime summary marks coverage partial/incomplete
  ↓
View model preserves incomplete status and coverage counts
  ↓
TUI renders warning card
  ↓
Safe next action points to /brainstorm-pro --resume or Spec 8.1 runtime-gated controls
```

The TUI does not choose retry, accept incomplete, or approve. It only explains the state.

#### Design Revision and Stale Evidence Rendering

```text
Design revision commits design vN+1
  ↓
Runtime marks old review/triage/readiness stale for approval
  ↓
Runtime/status exposes current review evidence plus stale provenance records
  ↓
View model separates current evidence from stale evidence
  ↓
TUI renders stale evidence under provenance only
```

Old evidence must never appear in current approval/readiness cards.

#### Plan Review Rendering

```text
Planning commits requirements/tasks
  ↓
Runtime automatically runs fixed three-reviewer plan review
  ↓
Runtime/status exposes plan review summary, bindings, readiness, and optional revision attempt
  ↓
View model builds PlanReviewPanelViewModel
  ↓
TUI renders fixed reviewers, exact bindings, readiness, and automatic revision status
```

Plan review has no user-selected mode or subset.

## Error Handling

- **Missing review summary**: render `Review panel unavailable: runtime did not provide review summary.` and suggest `/brainstorm-pro --status`.
- **Missing triage report**: render reviewer coverage and a warning that finding tiers are unavailable; do not classify raw findings.
- **Missing readiness report**: render evidence and state that readiness is unavailable; do not imply approval eligibility.
- **Malformed summary data**: omit malformed section, add diagnostic, and continue rendering other sections.
- **Checksum or artifact mismatch**: render warning that runtime will reject decisions depending on mismatched evidence; mark evidence stale/provenance-only when summary says so.
- **Stale evidence**: render under stale/provenance section only, with explicit wording that it cannot approve current artifacts.
- **Unknown reviewer id**: render as unknown reviewer with diagnostic; do not crash.
- **Narrow terminal**: switch from table-like output to compact bullet summaries.
- **Renderer failure**: fail soft using existing workflow live progress fallback behavior; never mutate workflow state or mark workflow failed because of TUI rendering.

## Testing

Unit tests should focus on view model construction and rendering behavior, not review algorithms.

Suggested tests:

```text
tests/unit/workflow-tui-review-panel-views.test.ts
tests/unit/workflow-tui-review-panel-fallback.test.ts
tests/security/tui-review-panel-boundary.test.ts
```

Critical cases:

- Renders full design reviewer grid with selected/unselected/succeeded/blocked/failed reviewers.
- Incomplete review warning explicitly says it is not passed review and not design approval.
- Triage tiers render from supplied summary data.
- Missing triage does not trigger TUI-side classification.
- Conflicts and unresolved questions render with source context.
- Design revision handoff renders source design, revised design, source review, and post-revision review.
- Stale design review evidence renders as provenance only and not current readiness.
- Plan review renders exactly the fixed three reviewers.
- Plan review output never renders skip/minimal/full or reviewer subset selection.
- Automatic plan revision attempt renders `1/1`, committed/failed/exhausted status, and post-revision review when available.
- Narrow fallback respects width constraints.
- Missing/malformed summary fails soft with diagnostics.
- Widget integration remains optional: no summary provider means no review panel section, not a crash.
- Security test verifies TUI review panel modules do not import approval writers, review ledger writers, revision ledger writers, artifact commit helpers, state transition helpers, or direct file mutation APIs.
- Security test verifies TUI review panel modules do not write `.workflow/*`, `design.md`, `requirements.md`, or `tasks.md`.

## Open Questions

1. Should `WorkflowReviewPanelSummary` live in `workflow/review-panel-summary.ts`, or should it be exported from `workflow/runtime.ts` as part of the existing status contract?
2. Should the first implementation populate summaries only for the current active review run, or also include a bounded history of recent stale/provenance review runs?
3. Should compact mode include a one-line review panel summary, or should Spec 8.2 detail remain expanded/fallback only?
4. What is the exact maximum number of finding clusters to render before truncating with a `+N more` line in narrow terminals?
