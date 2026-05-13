# Workflow TUI Interactive Decisions Design

## Summary

This spec adds **Workflow TUI Interactive Decisions** on top of Spec 8 `workflow-tui-live-progress`. It turns read-only TUI gate cards into runtime-gated interactive controls for design review mode selection, full reviewer subset selection, design approval, failed reviewer retry, accept-incomplete confirmation, design revision authorization, and plan approval. The TUI remains an input surface only: it collects user intent, binds it to the currently displayed gate/artifact snapshot, and submits a `RuntimeUserDecision` through a narrow runtime decision facade. The runtime is still the only authority that can reload workflow state, validate phase/gate/artifact/readiness/checksum/idempotency, write durable decisions/events/ledgers/state, and fail closed when a snapshot is stale.

## Goals

- Add interactive TUI controls for runtime decision gates without giving the TUI workflow authority.
- Support design review mode selection: `skip | minimal | full | revise | exit`.
- Support full design reviewer subset selection for exact design artifact refs/checksums.
- Support design approval and plan approval controls that bind exact artifact refs and readiness evidence.
- Support failed design reviewer retry controls using runtime-exposed recovery actions.
- Support accept-incomplete review as a separate explicit confirmation flow that cannot be confused with passed review or design approval.
- Support single-use design revision authorization confirmation using Spec 5.4 source binding and post-revision review settings.
- Introduce a narrow `submitWorkflowDecision()` runtime facade used by both TUI controls and CLI helper decisions.
- Require every submitted decision to include a gate binding, gate nonce, artifact refs/checksums where applicable, and an idempotency key.
- Make runtime re-read authoritative state before accepting any TUI-submitted decision.
- Display stale snapshot, stale gate, checksum mismatch, readiness mismatch, duplicate decision, blocked, and failed rejections clearly.
- Provide double-submit protection in both TUI state and runtime validation.
- Define keyboard, focus, cancel, confirmation, and IME-safe behavior for interactive controls.
- Preserve `/brainstorm-pro --resume` as the deterministic CLI fallback for every interactive TUI action.

## Primary Users / Roles

- **Workflow user**: wants to make gate decisions in the live TUI without memorizing helper flags, while still having safe CLI fallback.
- **Brainstorming Pro maintainer**: needs decision-capable UI that remains testable, deterministic, and constrained by runtime validation.
- **Security / reliability reviewer**: needs assurance that stale TUI snapshots, double-submit, crafted payloads, and UI bugs cannot approve gates or mutate workflow files directly.
- **Design review operator**: needs safe TUI controls for full reviewer subset selection, failed reviewer retry, and accept-incomplete decisions.
- **Future TUI implementer**: needs a stable decision control layer that can coexist with later review detail and controlled-execution detail views.

## Non-Goals

- Do not create a new workflow authority in TUI code.
- Do not let TUI modules directly write `state.json`, `.workflow/events.jsonl`, `.workflow/approvals/*`, `.workflow/decisions/*`, `.workflow/reviews/*`, `.workflow/revisions/*`, or artifact markdown files.
- Do not let TUI modules import or call low-level approval writers, review decision writers, revision ledger writers, artifact commit helpers, or state transition helpers directly.
- Do not implement plan review mode selection; plan review remains automatic and fixed.
- Do not implement plan reviewer subset selection, partial accept, or per-reviewer retry.
- Do not implement review finding browsers, triage conflict explorers, or detailed review ledger browsers; those belong to Spec 8.2.
- Do not implement execution task detail controls, task selection, checkbox writes, evidence validation, or execution state advancement; those belong to Spec 8.3 or controlled execution runtime.
- Do not implement reviewer prompts, review algorithms, triage algorithms, design revision algorithms, plan review algorithms, or controlled execution logic.
- Do not introduce background async dashboards, detached runners, intercom, generic subagent UI, arbitrary `single` / `parallel` / `chain` orchestration, or builtin agent discovery.
- Do not make TUI approval automatic based on readiness; readiness remains evidence for a separate explicit user decision.

## Context

Brainstorming Pro has converged on a runtime-first workflow model. The user enters through `/brainstorm-pro`, while the workflow runtime owns state transitions, artifact commits, review decisions, approval gates, plan review, controlled execution, event logging, and fail-closed validation.

Relevant predecessor specs:

- Spec 7 `workflow-ux-interface` defines `/brainstorm-pro --resume` as the deterministic CLI decision and recovery surface, plus status rendering and runtime decision/view-model boundaries.
- Spec 8 `workflow-tui-live-progress` defines read-only `WorkflowLiveSnapshot`, live widgets, gate cards, fallback rendering, and the rule that TUI rendering is presentation-only.
- Spec 5.2 `design-review-execution-control` defines reviewer subset selection, partial coverage, failed reviewer retry, and accept-incomplete semantics.
- Spec 5.4 `design-revision-loop` defines single-use design revision authorization and post-revision re-review semantics.
- Spec 6 `plan-review-panel` defines automatic fixed plan review and plan approval readiness.

Spec 8.1 bridges Spec 7 and Spec 8: it presents richer TUI controls for the same runtime decisions exposed through CLI resume. The TUI snapshot is not authoritative. Any decision collected from the TUI must be submitted to runtime, and runtime must reload the current authoritative state before accepting or rejecting the decision.

## Discovery

### Key Discoveries

- The important boundary is not CLI versus TUI; it is input surface versus runtime authority.
- Interactive TUI controls are useful only if they submit the same `RuntimeUserDecision` intent as CLI resume decisions and follow the same validation/persistence path.
- `WorkflowLiveSnapshot` may be stale, incomplete, or built from delayed live progress; it must never be used as approval evidence without runtime revalidation.
- TUI decisions need more than a choice value. They must carry gate identity, gate nonce, artifact refs/checksums, readiness evidence refs where applicable, and an idempotency key.
- Accept-incomplete is the highest-risk UX flow because users may read it as “review passed.” It needs a dedicated confirmation dialog and explicit wording that it is neither passed review nor design approval.
- Design approval and plan approval also need explicit confirmation because readiness is not approval.
- Double-submit is a real correctness issue for keyboard UIs, re-render loops, terminal glitches, and retrying after transport uncertainty.
- Plan review must not inherit design review controls. There must be no TUI plan review `skip | minimal | full`, reviewer subset, partial accept, or per-reviewer retry.
- CLI fallback is a safety feature, not a secondary convenience; every TUI action must have an equivalent `/brainstorm-pro --resume` path.

### Scope Decisions

Included:

- Narrow runtime decision facade.
- TUI interactive gate model builder.
- Design review mode selector.
- Full design reviewer subset selector.
- Design approval selector.
- Failed reviewer retry selector.
- Accept-incomplete confirmation dialog.
- Design revision authorization confirmation dialog.
- Plan approval selector.
- Decision binding with gate nonce, artifact refs/checksums, readiness refs, and idempotency key.
- Stale rejection display.
- Double-submit protection.
- Keyboard/focus/cancel/confirmation behavior.
- CLI fallback alignment.
- Boundary and security tests proving TUI cannot mutate workflow files directly.

Excluded:

- Review detail/finding/triage browsers.
- Execution detail/task browsers.
- New review/revision/plan algorithms.
- Public command surface expansion beyond existing `/brainstorm-pro --resume` fallback semantics.
- Background or detached TUI operation.

## Proposed Solution

Implement a **snapshot-bound interactive decision layer**. The live TUI reads a `WorkflowLiveSnapshot`, builds an `InteractiveGateModel` only when the snapshot contains a current pending gate, renders a focused control for that gate, and submits a `RuntimeUserDecision` with a gate binding and idempotency key through `submitWorkflowDecision()`.

The runtime decision facade reloads authoritative workflow state, validates that the submitted gate and artifact binding still match the current pending gate, validates the requested decision against runtime-owned rules, persists the decision/event/state through existing workflow mechanisms, and returns either an accepted result or a typed rejection with current status.

Core principles:

```text
TUI displays snapshot.
TUI collects intent.
TUI submits RuntimeUserDecision.
Runtime reloads authoritative state.
Runtime validates gate, refs, checksums, readiness and idempotency.
Runtime writes durable records.
TUI renders accepted/rejected result.
CLI --resume remains equivalent fallback.
```

### Architecture

```text
Workflow Runtime
  ├─ state.json / events.jsonl / ledgers / artifacts
  ├─ getStatus()
  ├─ resumeWorkflow()
  └─ submitWorkflowDecision()
       ↑
       │ RuntimeUserDecision + WorkflowDecisionBinding + idempotencyKey
       │
Workflow TUI Interactive Layer
  ├─ WorkflowLiveSnapshot
  ├─ InteractiveGateModelBuilder
  ├─ WorkflowDecisionControls
  │    ├─ DesignReviewModeSelector
  │    ├─ FullReviewerSubsetSelector
  │    ├─ DesignApprovalSelector
  │    ├─ FailedReviewerRetrySelector
  │    ├─ AcceptIncompleteDialog
  │    ├─ DesignRevisionAuthorizationDialog
  │    └─ PlanApprovalSelector
  ├─ DecisionSubmissionController
  ├─ StaleDecisionRejectionView
  └─ CLI fallback hints
```

`submitWorkflowDecision()` is a package-internal runtime API, not a new public command. It should reuse the same validation and persistence code paths as `resumeWorkflow()` decisions. CLI helper flags and TUI controls both convert user intent into `RuntimeUserDecision` and pass through the facade.

### Components

#### 1. Runtime Decision Facade

Suggested module:

```text
extensions/clarification-orchestrator/workflow/decision-facade.ts
```

or a dedicated export from:

```text
extensions/clarification-orchestrator/workflow/runtime.ts
```

Suggested input/result types:

```ts
type SubmitWorkflowDecisionInput = {
  topic: string;
  runId: string;
  decision: RuntimeUserDecision;
  binding: WorkflowDecisionBinding;
  idempotencyKey: string;
  submittedAt: string;
  source: "cli-resume" | "tui";
};

type WorkflowDecisionBinding = {
  gateId: string;
  gateNonce: string;
  phase: WorkflowPhase;
  artifactRefs: VersionedArtifactRef[];
  reviewRunId?: string;
  readinessRef?: {
    path: string;
    checksum: string;
  };
};

type WorkflowDecisionResult =
  | {
      status: "accepted";
      topic: string;
      runId: string;
      newPhase: WorkflowPhase;
      message: string;
    }
  | {
      status: "rejected";
      reason:
        | "stale-snapshot"
        | "stale-gate"
        | "phase-mismatch"
        | "artifact-mismatch"
        | "checksum-mismatch"
        | "readiness-mismatch"
        | "decision-not-allowed"
        | "duplicate-decision"
        | "workflow-blocked"
        | "workflow-failed";
      currentStatus: WorkflowStatusSnapshot;
      message: string;
    };
```

Runtime rules:

- Reload current workflow state/status before validation.
- Treat all submitted binding fields as untrusted hints.
- Verify `topic`, `runId`, `phase`, `gateId`, and `gateNonce` match the current pending gate.
- Verify artifact refs/checksums against current runtime artifact store.
- Verify readiness evidence refs/checksums for approval and accept-incomplete decisions.
- Verify the decision is allowed for the current gate.
- Persist accepted decisions through existing runtime-owned decision, event, approval, review/revision, and state commit paths.
- Reject fail-closed on any mismatch.

#### 2. Runtime User Decision Types

Spec 8.1 uses the runtime decision types defined by earlier workflow specs and narrows them for TUI submission. Representative union:

```ts
type RuntimeUserDecision =
  | SelectDesignReviewModeDecision
  | ApproveDesignDecision
  | RequestDesignRevisionDecision
  | RetryFailedDesignReviewersDecision
  | AcceptIncompleteDesignReviewDecision
  | AuthorizeDesignRevisionDecision
  | ApprovePlanDecision
  | ExitDecision
  | StatusOnlyDecision;
```

Representative shapes:

```ts
type SelectDesignReviewModeDecision = {
  type: "select-design-review-mode";
  mode: "skip" | "minimal" | "full";
  designRef: VersionedArtifactRef;
  selectedReviewerRoles?: FullDesignReviewerRole[];
};

type ApproveDesignDecision = {
  type: "approve-design";
  designRef: VersionedArtifactRef;
  reviewEvidenceRef: {
    reviewRunId?: string;
    readinessPath?: string;
    readinessChecksum?: string;
  };
  explicitConfirmation: true;
};

type RetryFailedDesignReviewersDecision = {
  type: "retry-failed-design-reviewers";
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  failedReviewerRoles: FullDesignReviewerRole[];
};

type AcceptIncompleteDesignReviewDecision = {
  type: "accept-incomplete-design-review";
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  coverageChecksum: string;
  explicitConfirmation: true;
};

type AuthorizeDesignRevisionDecision = {
  type: "authorize-design-revision";
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  sourceTriageRef: {
    path: string;
    checksum: string;
  };
  reviewAfterRevision: {
    mode: "minimal" | "full";
    selectedReviewerRoles?: FullDesignReviewerRole[];
  };
  explicitConfirmation: true;
};

type ApprovePlanDecision = {
  type: "approve-plan";
  approvedDesignRef: VersionedArtifactRef;
  requirementsRef: VersionedArtifactRef;
  tasksRef: VersionedArtifactRef;
  planReviewRunId: string;
  readinessChecksum: string;
  explicitConfirmation: true;
};
```

`explicitConfirmation: true` is required for decisions whose consequences are easy to misunderstand or are irreversible within the current gate: skip review, accept incomplete, authorize revision, approve design, and approve plan.

#### 3. Gate Binding and Nonce

Every pending runtime gate must expose a binding suitable for snapshot display and decision submission:

```ts
type PendingGateBinding = {
  gateId: string;
  gateNonce: string;
  phase: WorkflowPhase;
  artifactRefs: VersionedArtifactRef[];
  createdAt: string;
};
```

Rules:

- Runtime generates a new `gateNonce` each time it enters a new pending gate.
- Artifact changes, review re-runs, revision commits, and plan re-reviews produce new gate bindings where applicable.
- TUI decisions must include the displayed `gateId` and `gateNonce`.
- Runtime compares the submitted nonce to the current authoritative pending gate nonce.
- Mismatch yields `stale-gate` or `stale-snapshot` rejection.

Gate nonce is stored in runtime-owned pending decision state, not in TUI-local state.

#### 4. Idempotency Keys

Each decision submission carries an idempotency key:

```ts
type WorkflowDecisionIdempotency = {
  idempotencyKey: string;
  source: "cli-resume" | "tui";
  gateId: string;
  decisionType: RuntimeUserDecision["type"];
  createdAt: string;
};
```

Rules:

- TUI generates one key per submit attempt and disables the submitting control until the result is known.
- Runtime persists the accepted idempotency key in the durable decision/approval/recovery record for the consumed gate.
- Re-submitting the same key for the same accepted gate returns an idempotent accepted result when possible.
- Submitting a different key after the gate has been consumed returns `stale-gate` or `duplicate-decision`.
- If transport fails and acceptance is unknown, TUI should prompt the user to refresh status; if retry is attempted, it should reuse the same key.

#### 5. Interactive Gate Model Builder

Suggested module:

```text
extensions/clarification-orchestrator/tui/interactive-gates.ts
```

Responsibilities:

- Read `WorkflowLiveSnapshot` and produce a typed `InteractiveGateModel`.
- Hide submit controls when the snapshot is stale, corrupt, or lacks a pending gate.
- Include exact artifact refs/checksums and gate binding in each model.
- Include CLI fallback text for every model.
- Never read or write workflow files directly.

Suggested union:

```ts
type InteractiveGateModel =
  | DesignReviewModeGateModel
  | DesignApprovalGateModel
  | DesignReviewRecoveryGateModel
  | AcceptIncompleteGateModel
  | DesignRevisionAuthorizationGateModel
  | PlanApprovalGateModel
  | NoInteractiveGateModel;
```

#### 6. Design Review Mode Selector

Rendered at `awaiting-design-review-decision`.

Required display:

```text
Design v<N> checksum <prefix>
Choose review mode:
  skip     Explicitly skip review for this exact design
  minimal  Run lightweight workflow-owned review
  full     Run full design reviewer panel
  revise   Request design revision / return to design recovery path
  exit     Do nothing
```

Rules:

- `skip` is an explicit recorded decision, not a no-op.
- `full` opens reviewer subset selection before submission.
- `revise` submits a runtime intent only when runtime exposes a valid revision/recovery action; otherwise it exits to CLI fallback/status.
- If the snapshot is stale, choices are disabled and the control renders refresh/resume hints.

#### 7. Full Reviewer Subset Selector

Rendered after selecting `full` design review.

Default selected roles:

```text
[x] product-reviewer
[x] architecture-reviewer
[x] risk-security-reviewer
[x] testing-reviewer
[x] scope-simplicity-reviewer
```

Rules:

- Default is all five full design reviewers.
- At least one reviewer must be selected.
- Unknown roles, duplicate roles, `minimal-reviewer`, and plan reviewers are invalid.
- Selection binds to exact design ref/checksum.
- Runtime still validates selection; TUI validation is convenience only.

#### 8. Design Approval Selector

Rendered at `awaiting-design-approval`.

Required display:

- design ref/version/checksum;
- review mode and review run id when available;
- readiness status;
- triage summary when available;
- skipped-review warning when applicable;
- accepted-incomplete warning when applicable;
- revision handoff summary when applicable;
- explicit reminder that review readiness is not approval.

Actions:

```text
Approve design
Request revision, if runtime exposes the action
Status
Exit
```

Approval action is enabled only when runtime status indicates approval is currently allowed. Runtime must still reject if readiness or artifact binding changed before submission.

#### 9. Failed Reviewer Retry Selector

Rendered for design review recovery states with failed selected reviewers.

Required display:

- review run id;
- design ref/version/checksum;
- selected reviewers;
- succeeded reviewers;
- failed reviewers;
- failure diagnostics summary;
- aggregate finding counts from successful reviewers;
- runtime-provided recovery actions.

Allowed actions depend on runtime status:

- retry failed reviewers;
- replace reviewer selection if supported by runtime;
- accept incomplete if safe and available;
- status;
- exit.

Retry submission includes exactly the runtime-exposed failed reviewer roles. TUI cannot invent retryable reviewers.

#### 10. Accept Incomplete Confirmation Dialog

Rendered only when runtime status exposes `accept-incomplete-review` as an allowed recovery action.

Required confirmation text:

```text
Accept incomplete review?

This does NOT mean the review passed.
This does NOT approve the design.
It only accepts missing reviewer coverage for this exact design review
and moves the workflow to the separate design approval gate.
```

Required display:

- exact design ref/checksum;
- review run id;
- succeeded reviewers;
- failed reviewers;
- blocking finding count from successful reviewers;
- coverage checksum or coverage evidence ref;
- consequence summary.

Rules:

- Default focused action is cancel/no.
- Submission requires explicit confirmation.
- Runtime must reject if blocking findings exist, no reviewer succeeded, no reviewer failed, readiness is not `incomplete-review`, coverage changed, or design ref/checksum is stale.
- Accepted incomplete moves only to design approval gate. It does not approve design.

#### 11. Design Revision Authorization Dialog

Rendered when runtime exposes a design revision authorization recovery action.

Required display:

- source design ref/checksum;
- source review run id;
- source triage/readiness refs/checksums;
- must-fix / unresolved question summary when available;
- post-revision review mode;
- selected reviewer roles when post-revision review mode is `full`;
- round limit / single-use warning.

Required warning:

```text
One authorization permits one revision attempt and one post-revision re-review.
It does not approve the revised design.
It does not allow automatic multi-round revision.
```

Rules:

- Submission requires explicit confirmation.
- Runtime validates source design/review/triage/readiness binding and round policy.
- Missing required user answers are rejected or returned as `needs-user-input` by runtime.

#### 12. Plan Approval Selector

Rendered at `awaiting-plan-approval`.

Required display:

- approved design ref/checksum;
- requirements ref/checksum;
- tasks ref/checksum;
- plan review run id;
- plan readiness status;
- automatic plan revision attempt summary when applicable;
- explicit reminder that plan review ready is not plan approval.

Allowed actions:

```text
Approve plan
Status
Exit
```

Forbidden controls:

- plan review `skip | minimal | full`;
- plan reviewer subset;
- plan partial accept;
- per-plan-reviewer retry.

Runtime must validate that current requirements/tasks still match the ready plan review binding before accepting approval.

#### 13. Decision Submission Controller

Suggested module:

```text
extensions/clarification-orchestrator/tui/decision-submission.ts
```

Responsibilities:

- Convert focused control state into `RuntimeUserDecision`.
- Attach `WorkflowDecisionBinding` and `idempotencyKey`.
- Call `submitWorkflowDecision()`.
- Disable controls while submitting.
- Reuse idempotency key when retrying after uncertain transport failure.
- Render accepted result, rejected result, or transport failure.
- Trigger snapshot/status refresh after accepted or rejected result.
- Never mutate workflow files directly.

#### 14. Stale Decision Rejection View

When runtime rejects a decision because displayed data is stale, TUI renders a clear comparison when available:

```text
Decision rejected: stale artifact binding

Your TUI snapshot referenced:
- design v4 checksum abc123…

Current runtime state has:
- design v5 checksum def456…

No decision was recorded.
Use /brainstorm-pro --resume <topic> or refresh the TUI.
```

All rejection views must state that no decision was recorded unless runtime explicitly reports an idempotent accepted result.

#### 15. Keyboard, Focus, Confirmation, and IME Behavior

Required behavior:

- `Tab` / `Shift+Tab` move focus between controls.
- Arrow keys move within radio groups and checkbox lists.
- `Space` toggles checkbox options.
- `Enter` submits the focused primary action only after required confirmation is satisfied.
- `Esc` cancels the current dialog or closes the interactive overlay without submitting.
- `q` exits/hides the interactive control without submitting.
- `Ctrl+C` follows command cancellation semantics and must not submit a partial decision.
- Confirmation dialogs default focus to cancel/no.
- Text input is avoided in the first implementation except for optional reason fields; when present, IME input is accepted only inside the active text field.
- Narrow terminals fall back to compact confirmation controls or CLI hints.

Actions requiring explicit confirmation:

- skip design review;
- accept incomplete review;
- authorize design revision;
- approve design;
- approve plan.

### Data Flow

#### Design review mode selection

```text
Runtime enters awaiting-design-review-decision
  ↓
Spec 8 snapshot includes design ref and gate binding
  ↓
Spec 8.1 renders design review mode selector
  ↓
User chooses full and selects reviewer subset
  ↓
TUI builds RuntimeUserDecision + binding + idempotency key
  ↓
submitWorkflowDecision()
  ↓
Runtime reloads state and validates gate/design checksum/reviewer subset
  ↓
Runtime records decision and event
  ↓
Runtime transitions to design-review
  ↓
TUI refreshes snapshot
```

#### Accept incomplete review

```text
Design review status is partial
Readiness is incomplete-review
Runtime exposes accept-incomplete recovery action
  ↓
TUI renders explicit confirmation dialog
  ↓
User confirms
  ↓
TUI submits accept-incomplete decision
  ↓
Runtime validates design ref, review run, coverage, readiness and no blocking findings
  ↓
Runtime records accept-incomplete decision and event
  ↓
Runtime moves to awaiting-design-approval
  ↓
TUI refreshes and shows design approval gate
```

#### Design approval

```text
Runtime enters awaiting-design-approval
  ↓
TUI renders design ref, review evidence and readiness
  ↓
User explicitly confirms approval
  ↓
TUI submits approve-design decision
  ↓
Runtime validates latest design and approval readiness evidence
  ↓
Runtime records approval and transitions to planning
  ↓
TUI refreshes progress or closes on command completion
```

#### Plan approval

```text
Plan review reaches ready-for-plan-approval
Runtime enters awaiting-plan-approval
  ↓
TUI renders approved design + requirements + tasks refs
  ↓
User explicitly confirms plan approval
  ↓
Runtime validates latest requirements/tasks still match ready plan review binding
  ↓
Runtime records plan approval
  ↓
Runtime transitions to executing
```

#### Stale snapshot rejection

```text
TUI snapshot references design v4
  ↓
Another runtime path commits design v5 or changes the gate
  ↓
User submits approval from stale TUI
  ↓
Runtime reloads authoritative state and detects mismatch
  ↓
Runtime rejects stale-gate/artifact/checksum
  ↓
TUI displays rejection and refresh/CLI fallback hints
```

## Error Handling

### Stale snapshot or stale gate

- Runtime rejects with `stale-snapshot` or `stale-gate`.
- TUI displays current authoritative status when provided.
- No durable decision is written.
- User is prompted to refresh or use `/brainstorm-pro --resume <topic>`.

### Artifact or checksum mismatch

- Runtime rejects with `artifact-mismatch` or `checksum-mismatch`.
- TUI must not retry automatically with updated refs.
- User must review the latest gate before submitting a new decision.

### Readiness mismatch

- Runtime rejects with `readiness-mismatch`.
- TUI displays the current readiness and safe next actions.
- Approval, accept-incomplete, or revision authorization is not recorded.

### Double submit

- TUI disables controls while submitting.
- Runtime handles same-key duplicate as idempotent when possible.
- Runtime rejects different-key submissions after gate consumption as duplicate or stale gate.

### Transport failure

- TUI must not assume the decision was accepted.
- TUI displays an uncertain-submission message and prompts status refresh.
- If retrying the same submission, TUI reuses the same idempotency key.

### Invalid reviewer selection

- TUI prevents empty/unknown/duplicate/invalid selections.
- Runtime still validates and rejects invalid selections fail-closed.

### Accept incomplete unavailable

- TUI only displays accept-incomplete when runtime status exposes it.
- Crafted payloads without runtime permission are rejected.

### Plan review control violation

- TUI must never render plan review mode/subset/partial controls.
- Runtime rejects any submitted plan review mode/subset decision.

### TUI render or input failure

- Close/hide interactive controls if safe.
- Fall back to deterministic text and `/brainstorm-pro --resume` hints.
- Do not mark workflow failed solely because TUI interaction failed.

### Cancel or escape

- Cancel, escape, close, and quit actions do not submit decisions.
- Partial form state is discarded unless explicitly confirmed later.

## Testing

### Unit Tests

Suggested files:

```text
tests/unit/tui/workflow-tui-interactive-gates.test.ts
tests/unit/tui/workflow-tui-decision-submission.test.ts
tests/unit/tui/workflow-tui-stale-rejection.test.ts
tests/unit/tui/workflow-tui-keyboard.test.ts
tests/unit/workflow/decision-facade.test.ts
```

Critical cases:

- Builds design review mode selector from a non-stale snapshot.
- Hides or disables submit controls when snapshot is stale.
- Full reviewer selector defaults to all five design reviewers.
- Full reviewer selector rejects empty selection.
- Full reviewer selector rejects duplicate, unknown, minimal, and plan reviewer roles.
- Design approval is disabled when readiness is blocked.
- Accept-incomplete dialog requires explicit confirmation.
- Accept-incomplete text states it is not passed review and not approval.
- Plan approval selector never renders plan review mode/subset controls.
- Decision payload includes gate id, gate nonce, artifact refs and idempotency key.
- Decision submission disables controls while pending.
- Stale rejection view renders current status and says no decision was recorded.
- Escape/cancel exits without calling decision submission.

### Runtime Decision Facade Tests

- Accepts valid design review mode decision for the current gate.
- Rejects phase mismatch.
- Rejects stale gate nonce.
- Rejects design checksum mismatch.
- Rejects duplicate consumed gate with a different idempotency key.
- Returns idempotent accepted result for same key when applicable.
- Accepts design approval only when readiness and artifact binding match.
- Rejects accept-incomplete when blocking findings exist.
- Rejects accept-incomplete when coverage checksum is stale.
- Rejects plan approval when requirements/tasks changed after ready plan review.
- Rejects any plan review mode/subset decision.

### Integration Tests

Suggested file:

```text
tests/integration/workflow-tui-interactive-decisions.test.ts
```

Critical flows:

- TUI design review mode selection produces the same durable decision/state result as CLI `--resume` helper decision.
- TUI full reviewer subset selection writes the same review decision schema as CLI fallback.
- TUI retry failed reviewers follows runtime validation and updates review recovery state.
- TUI accept incomplete moves only to `awaiting-design-approval` and does not approve design.
- TUI approve design enters planning only after runtime validation.
- TUI approve plan enters executing only after ready fixed plan review and exact requirements/tasks binding.
- Stale TUI approval attempt is rejected and does not mutate state.
- Transport failure path does not assume acceptance and can recover through status refresh.

### Security / Product Boundary Tests

Suggested file:

```text
tests/security/workflow-tui-interactive-boundary.test.ts
```

Critical cases:

- TUI modules do not import approval writers.
- TUI modules do not import review decision ledger writers.
- TUI modules do not import revision ledger writers.
- TUI modules do not import artifact commit helpers.
- TUI modules do not write `state.json` or workflow ledger/artifact paths.
- Crafted TUI payload cannot approve using stale artifact ref.
- Crafted TUI payload cannot accept incomplete without explicit confirmation.
- Crafted TUI payload cannot authorize design revision with stale triage checksum.
- Crafted TUI payload cannot submit plan review mode/subset.
- TUI decision controls cannot expose generic subagent orchestration, background runner, or intercom UI.

### Documentation Alignment Tests

- README and workflow docs state TUI decisions are runtime-gated.
- Docs state `/brainstorm-pro --resume` remains fallback for every TUI action.
- Docs state accept incomplete is not passed review and not design approval.
- Docs state plan review has no user mode/subset controls.

## Open Questions

Resolved for this design:

1. **Should the TUI reuse `resumeWorkflow()` or add `submitWorkflowDecision()`?**
   - Use a narrow package-internal `submitWorkflowDecision()` facade. It must reuse the same validation and persistence code paths as `resumeWorkflow()` decisions, so CLI and TUI behavior remain equivalent.

2. **Where should gate nonce live?**
   - Store gate nonce in runtime-owned pending decision state. TUI only displays and echoes it back; runtime treats it as untrusted input and compares against current state.

3. **Should idempotency be persisted?**
   - Yes. Persist the accepted idempotency key in the durable decision/approval/recovery record for the consumed gate. Same-key duplicate submissions can return idempotent accepted results; different-key submissions after gate consumption fail closed.

4. **Should TUI support free-form reason input?**
   - Not in the first implementation except optional narrow reason fields for future revision authorization or accept-incomplete notes. Initial controls should prioritize deterministic choices and explicit confirmations to reduce IME/focus complexity.

5. **Should approvals require confirmation?**
   - Yes. Design approval and plan approval both require explicit confirmation and default focus to cancel/no.

6. **Should controls be embedded in the Spec 8 widget or implemented as a separate overlay/layer?**
   - Implement a separate interactive gate layer that consumes the Spec 8 snapshot and can be rendered by the widget/session. This keeps read-only rendering, input handling, and decision submission boundaries testable and isolated.
