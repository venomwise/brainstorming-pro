# Design Revision Loop Design

## Summary

新增 **Design Revision Loop**，在 Spec 5 `design-review-panel`、Spec 5.2 `design-review-execution-control` 和 Spec 5.3 `design-review-triage-and-readiness` 的基础上，把 blocking findings、must-fix triage items、conflicts 和 unresolved questions 转换为受控的 design revision transaction。用户每次只授权一轮 revision；runtime 绑定当前 exact `design.md` artifact、review run 和 triage report，调用 package-owned design reviser 生成新版 `design.md`，由 runtime 提交新的 design artifact version，然后立即对新版 design 执行一次 re-review。re-review 完成后 workflow 必须暂停并把新的 review/triage/readiness 交还给用户，由用户决定批准、再次授权 revision、回答问题、retry/review 或停止。该 spec 不允许一次授权内连续自动 revision，也不允许自动 approve design。

## Goals

- 将 Spec 5.3 triage/readiness 结果转化为可执行、可审计、版本绑定的 design revision transaction。
- 引入 single-use `DesignRevisionAuthorization`，明确一次用户授权只允许一轮 revision 和一轮 post-revision re-review。
- 使用受控 design reviser agent 生成完整新版 `design.md` 内容，但只有 runtime 可以提交 artifact version 和更新 mirror。
- 在 revised design commit 后立即使旧 review/triage/readiness 对 approval 失效，并为新版 design 创建新的 review evidence。
- 支持 unresolved user question gate：需要用户决策的问题不得由 reviser 猜测推进。
- 为 blocked review 提供清晰 recovery action：revise once、answer questions、retry review、change review mode/reviewer subset、stop。
- 维护 workflow 累计 revision/review round 上限，防止无限人工授权循环或误配置自动化。
- 写入 revision ledger 和 event log，支持 audit、status/resume、未来 TUI 和 debugging。
- 保持 runtime authority：revision、review、approval、planning 的生命周期迁移全部由代码强制。

## Primary Users / Roles

- **Workflow user**：希望系统根据 review 反馈修订 `design.md`，但仍保留是否继续修、是否批准、是否回答问题的最终决策权。
- **Brainstorming Pro maintainer**：需要一个安全、可测试、可恢复的 revision transaction，而不是 prompt-only 的自动改文档。
- **Design reviser role implementer**：需要清楚 reviser 只能返回 structured revised content，不能写文件、不能审批、不能启动 planning。
- **Security / reliability reviewer**：需要确认旧 review 不会被复用于新版 design，用户授权不会被扩大为无限自动循环。
- **UX/TUI implementer**：需要稳定的 recovery action、revision record 和 post-review handoff 数据来渲染下一步选择。

## Non-Goals

- 不实现 reviewer role pack；该能力属于 Spec 5.1。
- 不实现 reviewer subset、partial retry 或 accept-incomplete mechanics；这些属于 Spec 5.2。
- 不重新设计 finding deduplication、conflict detection、must-fix/should-fix/note 分类或 readiness refinement；这些属于 Spec 5.3。
- 不实现 plan review、plan regeneration、requirements/tasks 生成或 execution。
- 不允许 reviser 直接修改 `design.md`、`requirements.md`、`tasks.md`、state、decision、approval 或 review ledger。
- 不自动 approve design。
- 不在一次用户授权内连续自动执行多轮 revision。
- 不把 post-revision re-review passed 视为 approval；它只能进入 design approval gate。
- 不让 unresolved user questions 被 agent 猜测回答。
- 不新增 generic subagent command/tool 或 arbitrary orchestration。

## Context

全局 roadmap 将 design review 拆为连续子 spec：

```text
Spec 5:   design-review-panel
Spec 5.1: design-reviewer-role-pack
Spec 5.2: design-review-execution-control
Spec 5.3: design-review-triage-and-readiness
Spec 5.4: design-revision-loop
```

当前基础包括：

- versioned design artifacts and latest `design.md` mirror；
- design review decision gate and design approval gate；
- exact design artifact version/checksum binding；
- review runs and review ledger under `.workflow/reviews/design/<review-run-id>/`；
- canonical `DesignReviewFinding`；
- full reviewer role pack；
- reviewer selection, retry, partial aggregation and accept-incomplete decisions；
- triage report with clusters, must-fix/should-fix/notes, conflicts, unresolved questions and coverage-aware readiness；
- agent execution runtime with controlled child Pi execution and structured output validation；
- skill phase adapter foundation for agent-backed design generation.

The missing piece is controlled mutation of the design artifact after review. Reviewers and triage can identify problems, but no component should directly edit `design.md` or silently proceed to planning. Spec 5.4 adds a runtime-owned bridge from review findings to a revised design artifact while preserving all gates.

## Discovery

### Key Discoveries

- A revision loop should not mean “revise until passed.” That would expand one user action into unbounded artifact mutation and reviewer execution.
- The safest useful unit is a **single-use revision transaction**: one user authorization permits one revision attempt and, if committed, one automatic re-review of the revised design.
- Post-revision re-review should happen automatically because a revised design is unvalidated and old review evidence is stale; however, the workflow must pause after that re-review for user decision.
- Old review/triage can be provenance for why a revision happened, but cannot be approval evidence for the new design version.
- Unresolved user questions are a hard boundary. If a revision depends on a product, scope, risk, or trade-off decision, the system must ask the user instead of inventing an answer.
- Max rounds are still necessary, but they should be cumulative workflow safety limits, not permission for automatic multi-round revision inside one authorization.
- The reviser output must be complete replacement markdown plus structured metadata, not direct file edits or unchecked patches.

### Scope Decisions

Included:

- single-use revision authorization;
- revision eligibility checks;
- unresolved question gate;
- design reviser adapter;
- revised design validation;
- versioned artifact commit request;
- stale review/triage invalidation;
- one automatic post-revision re-review;
- user handoff after post-revision review;
- revision ledger and events;
- cumulative round limits.

Excluded:

- reviewer implementation;
- triage rule redesign;
- plan review/regeneration;
- execution;
- automatic approval;
- repeated automatic revision without fresh user authorization.

## Proposed Solution

Add a workflow-owned `DesignRevisionController`. When a design review/triage result is blocked or contains must-fix items, runtime/status/resume exposes a recovery action such as `revise-design-once`. If the user chooses it, runtime records a single-use `DesignRevisionAuthorization` bound to the current design artifact, review run, triage report, readiness report and review-after-revision settings.

The controller validates eligibility, builds a `DesignRevisionRequest`, invokes a package-owned design reviser role through the controlled agent execution runtime, validates the structured output, then asks the runtime artifact store to commit a new design version. After commit, old review/triage/readiness are marked stale for approval purposes. Runtime then immediately starts one re-review for the new design artifact using the review mode/reviewer subset authorized for this revision transaction. After that re-review and triage finish, runtime pauses for user decision.

Core principles:

```text
Reviewers identify issues.
Triage explains and prioritizes issues.
User authorizes one revision transaction.
Reviser drafts a complete revised design.
Runtime commits the new design version.
Old review evidence becomes stale for approval.
Runtime performs one post-revision re-review.
User decides the next step.
Approval is never automatic.
```

### Architecture

```text
Workflow Runtime Orchestrator
  ├─ blocked/review recovery actions
  ├─ design revision authorization gate
  ├─ event log
  ├─ artifact store
  └─ DesignRevisionController
       ├─ RevisionEligibilityEvaluator
       ├─ RevisionRoundPolicy
       ├─ UserQuestionGate
       ├─ RevisionRequestBuilder
       ├─ DesignReviserAdapter
       ├─ RevisedDesignValidator
       ├─ RevisionLedgerWriter
       └─ PostRevisionReviewScheduler
            ↓
       Agent Execution Runtime
            ↓
       package-owned design reviser role
```

Implemented modules:

```text
extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/constants.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/schemas.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/ledger.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/source-binding.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/events.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/round-policy.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/user-questions.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/eligibility.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/request-builder.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/prompts.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/reviser-adapter.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/validator.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/artifact-commit.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/staleness.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/controller.ts
extensions/clarification-orchestrator/workflow/adapters/design-revision/post-review.ts
```

The implementation keeps the original transaction semantics: one consumed authorization can produce at most one revised design artifact and one post-revision review, and post-review handoff never approves design or enters planning.

### Components

#### 1. `DesignRevisionController`

Responsibilities:

- Load the current workflow state and latest design artifact ref.
- Load source review run, aggregate, triage and readiness refs.
- Validate the single-use authorization.
- Enforce revision eligibility and round policy.
- Build a `DesignRevisionRequest`.
- Invoke `DesignReviserAdapter`.
- Validate output and request artifact commit.
- Write revision ledger/events.
- Schedule exactly one post-revision re-review.
- Return a post-review handoff status to runtime.

The controller cannot approve design, enter planning, or write state truth directly.

#### 2. `RevisionEligibilityEvaluator`

Allows revision when:

- source design ref matches the current latest design artifact;
- source review run and triage report are bound to that design ref;
- triage/readiness indicates blocked, must-fix, requires-revision findings, unresolved questions with user answers, or explicit user revision feedback;
- review coverage semantics permit using the findings as revision input;
- cumulative round limits are not exhausted.

Rejects revision when:

- source design/review/triage/readiness is stale or checksum mismatched;
- no actionable findings or user instructions exist;
- unresolved blocking user questions lack answers;
- current workflow state does not allow design revision;
- max total revision rounds or post-revision review rounds are exhausted;
- review run failed without usable aggregate/triage;
- crafted ledger refs point outside the topic workflow directory.

#### 3. `UserQuestionGate`

Consumes triage `unresolvedQuestions`. It classifies questions into:

- `requires-user-answer-before-revision`: revision must pause until the user answers;
- `reviser-can-address`: implementation detail or wording issue that can be resolved by rewriting;
- `carry-forward`: non-blocking question that should be preserved in the design as an assumption/risk.

If any blocking question requires user input and has no bound answer, the controller returns `needs-user-input` without launching the reviser.

#### 4. `RevisionRoundPolicy`

Round limits are cumulative workflow safety bounds:

```ts
type DesignRevisionRoundPolicy = {
  maxTotalRevisionRounds: number;
  maxTotalPostRevisionReviewRounds: number;
  currentRevisionRound: number;
  currentPostRevisionReviewRound: number;
};
```

They do not authorize automatic multi-round revision. Each additional revision after a post-review handoff requires a new user authorization.

#### 5. `DesignReviserAdapter`

Runs a package-owned design reviser role through `agent-execution-runtime`.

Constraints:

- use `--no-session` and `--no-skills`;
- use package-owned prompt/system prompt templates;
- consume current design, triage clusters, conflicts, unresolved question answers and user instructions;
- return structured JSON plus full revised markdown;
- never write files directly;
- never update approvals, decisions, review ledgers or workflow state;
- never generate requirements/tasks;
- never start planning.

#### 6. `RevisedDesignValidator`

Validates:

- output schema;
- `revisedDesignMarkdown` is non-empty and complete;
- required design template headings are present;
- no requirements/tasks/checklist artifact is embedded as a substitute for design;
- no approval language claims the design is approved;
- resolved item ids exist in source triage;
- unresolved item ids are reported with reasons;
- markdown does not instruct bypassing review/approval gates;
- output size is bounded.

If validation fails, the previous `design.md` remains authoritative and no artifact version is committed.

#### 7. Artifact Commit and Stale Invalidation

A successful revision creates a new `design` artifact version through the existing artifact store and mirrors it to `specs/<topic>/design.md`.

Required rule:

```text
Revision consumes old review as input.
Revision invalidates old review as approval evidence.
Only review of the revised design can unblock approval.
```

Old review/triage/readiness records remain immutable provenance but cannot satisfy approval for the new design ref.

#### 8. `PostRevisionReviewScheduler`

After a successful design commit, runtime immediately starts one re-review against the new design artifact.

Rules:

- re-review is runtime-owned, not reviser-owned;
- it binds the new design version/checksum;
- it uses the authorized review mode and selected reviewer roles from the revision authorization;
- it writes a new review run, aggregate, readiness and triage report;
- after it completes, workflow pauses for user decision;
- a blocked post-revision review never triggers another revision automatically.

#### 9. `RevisionLedgerWriter`

Writes durable records for audit, status/resume and future TUI.

Suggested layout:

```text
specs/<topic>/.workflow/
  revisions/
    design/
      <revision-id>/
        authorization.json
        request.json
        prompt.md
        system-prompt.md
        child-result.json
        output.json
        validation.json
        record.json
```

## Data Flow

### Primary path: blocked review to revised design and one re-review

1. `design v1` is reviewed by `review run r1`.
2. Spec 5.3 writes `triage report t1` with must-fix items or blocking readiness.
3. Runtime/status/resume presents recovery action `revise design once from review findings`.
4. User authorizes one revision transaction.
5. Runtime writes `authorization.json` bound to `design v1`, `r1`, `t1` and chosen post-revision review settings.
6. `DesignRevisionController` validates eligibility, source checksums and round policy.
7. `UserQuestionGate` either passes with bound answers or returns `needs-user-input`.
8. Controller builds `DesignRevisionRequest`.
9. `DesignReviserAdapter` runs the reviser child and captures structured output.
10. `RevisedDesignValidator` validates the output.
11. Runtime commits `design v2` and mirrors it to `specs/<topic>/design.md`.
12. Runtime marks `r1/t1` stale for approval of `design v2`.
13. Runtime starts exactly one re-review for `design v2`.
14. New review run `r2` and triage `t2` are written.
15. Workflow pauses for user decision:
    - approve `design v2` if readiness permits;
    - authorize another revision;
    - answer questions;
    - retry/review with different settings;
    - stop.

### Data Model

#### `DesignRevisionAuthorization`

```ts
type DesignRevisionAuthorization = {
  authorizationId: string;
  revisionId: string;
  topic: string;
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  sourceTriageRef: {
    path: string;
    checksum: string;
  };
  sourceReadinessRef: {
    path: string;
    checksum: string;
  };
  allowedAction: "single-revision-and-rereview";
  reviewAfterRevision: {
    enabled: true;
    mode: "minimal" | "full";
    selectedReviewerRoles?: FullDesignReviewerRole[];
    sourceReviewDecisionId: string;
  };
  userInstructions?: string;
  userAnswers?: DesignRevisionUserAnswer[];
  createdAt: string;
  createdBy: "user";
  consumedAt?: string;
};
```

#### `DesignRevisionRequest`

```ts
type DesignRevisionRequest = {
  revisionRequestId: string;
  authorizationId: string;
  topic: string;
  sourceDesignRef: VersionedArtifactRef;
  sourceReviewRunId: string;
  sourceTriageRef: {
    path: string;
    checksum: string;
  };
  requestedAt: string;
  round: DesignRevisionRoundPolicy;
  inputs: {
    mustFixClusterIds: string[];
    shouldFixClusterIds: string[];
    conflictIds: string[];
    unresolvedQuestionIds: string[];
    userAnswers: DesignRevisionUserAnswer[];
    userInstructions?: string;
  };
  reviewAfterRevision: DesignRevisionAuthorization["reviewAfterRevision"];
};
```

#### `DesignRevisionOutput`

```ts
type DesignRevisionOutput = {
  revisedDesignMarkdown: string;
  changeSummary: string;
  resolvedItems: {
    clusterIds: string[];
    questionIds: string[];
    conflictIds: string[];
  };
  unresolvedItems: {
    itemType: "cluster" | "question" | "conflict";
    itemId: string;
    reason: string;
  }[];
  assumptionsIntroduced: string[];
  riskNotes: string[];
};
```

#### `DesignRevisionRecord`

```ts
type DesignRevisionRecord = {
  revisionId: string;
  authorizationId: string;
  requestId: string;
  sourceDesignRef: VersionedArtifactRef;
  targetDesignRef?: VersionedArtifactRef;
  sourceReviewRunId: string;
  postRevisionReviewRunId?: string;
  sourceTriageChecksum: string;
  status:
    | "committed"
    | "needs-user-input"
    | "blocked"
    | "failed"
    | "revision-exhausted"
    | "stale-source";
  resolvedClusterIds: string[];
  unresolvedClusterIds: string[];
  unresolvedQuestionIds: string[];
  changeSummary?: string;
  createdAt: string;
  completedAt?: string;
};
```

## Error Handling

- **Stale source**: If source design/review/triage/readiness does not match the current latest design artifact or recorded checksums, return `stale-source` and do not run reviser.
- **Missing user answer**: If blocking unresolved questions require user input, return `needs-user-input` with question ids and prompts.
- **Round limit exhausted**: Return `revision-exhausted`; user may manually edit or start a new explicit workflow path, but automatic reviser does not continue.
- **Child failure/timeout**: Return `failed`, persist diagnostics, do not modify `design.md`.
- **Invalid reviser output**: Return `failed`, persist validation errors, do not commit artifact.
- **Artifact commit failure**: Return `failed`; previous design remains latest.
- **Post-revision review failure**: Preserve committed revised design, record review failure, and expose retry/review recovery actions; do not approve.
- **Post-revision review blocked**: Pause for user decision; do not automatically launch another revision.
- **Path or checksum corruption**: Fail closed and require manual recovery.

## Testing

Unit tests:

- validates `DesignRevisionAuthorization`, `DesignRevisionRequest`, `DesignRevisionOutput` and `DesignRevisionRecord` schemas;
- rejects stale source design/review/triage/readiness refs;
- enforces single-use authorization consumption;
- enforces cumulative max revision/review round policy;
- blocks unresolved user questions without bound answers;
- validates revised design headings and output bounds;
- rejects invalid resolved/unresolved item ids;
- writes and reads revision ledger records;
- marks old review/triage stale for approval after commit.

Integration tests:

- blocked review + triage → user authorization → revised design artifact vN+1 → one post-revision re-review → user handoff;
- revised design cannot be approved using old review run;
- post-revision passed review enters `awaiting-design-approval` but does not approve automatically;
- post-revision blocked review exposes another user decision without automatic second revision;
- reviser failure leaves previous `design.md` unchanged;
- invalid reviser output leaves previous `design.md` unchanged;
- missing user answer pauses before child execution;
- round limit exhaustion prevents another revision authorization.

Security tests:

- crafted triage checksum mismatch fails closed;
- ledger path traversal is rejected;
- reviser output claiming approval is rejected or sanitized according to validation policy;
- reviser attempts to modify requirements/tasks are rejected by output contract;
- stale artifact ref cannot be reused to authorize revision;
- post-revision review decision binds the new artifact checksum, not the old one.

## Open Questions

1. Should the first implementation support `minimal` and `full` post-revision review, or only reuse the source review decision mode exactly? Recommended: reuse the source mode/reviewer subset initially, and add explicit mode change through existing review decision UX.
2. Should `should-fix` clusters be included by default in revision requests? Recommended: include them as lower priority context, but require must-fix/blocking items to drive eligibility unless the user explicitly asks for broader cleanup.
3. Should manual user feedback without a blocked review be allowed to trigger this same revision transaction? Recommended: yes later, but first implementation should focus on review/triage-driven blocked recovery.
4. Should design template heading validation be strict or advisory? Recommended: strict for required top-level headings from the template, advisory for optional sections.
