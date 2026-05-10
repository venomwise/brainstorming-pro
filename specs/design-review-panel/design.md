# Design Review Panel Design

## Summary

新增 **Design Review Panel foundation**，让 Brainstorming Pro 在用户选择 design review mode 后，可以用 workflow-owned runtime 执行可恢复、可审计、版本绑定的 design review。Spec 5 定义完整多 Agent review panel 的上位架构、review run 生命周期、统一 finding schema、review ledger、基础 aggregation/readiness 和 runtime adapter 集成；首版实现真实 `minimal` review 路径，并为 `full` review 保留正式 capability contract。`full` review 在 Spec 5 首版可显式返回 `unavailable`，完整五角色 reviewer pack 由后续 Spec 5.1 `design-reviewer-role-pack` 实现。

## Goals

- 用真实 `DesignReviewPanel` 替换当前 design review placeholder adapter。
- 支持 design review decision 后的 `skip | minimal | full` review mode handling。
- 让 `minimal` review 走正式 review run、finding schema、aggregation、readiness 和 ledger，而不是临时 no-op。
- 为 `full` review 定义稳定 contract；Spec 5 首版允许 `full-review-unavailable`，但不能静默降级为 `minimal` 或 `skip`。
- 所有 review run 必须绑定 exact `design` artifact version、relative path 和 checksum。
- Reviewer 只能输出结构化 findings，不能修改 `design.md`、workflow state、decision 或 approval。
- Review panel 只能返回 review result，由 workflow runtime 执行 state transition、event append 和 gate enforcement。
- 持久化 review ledger，支持 audit、status、resume、future TUI 和后续 triage/revision 子 spec。
- 定义后续子 spec 的 extension points，并与全局 refactor roadmap 保持一致：
  - Spec 5.1 `design-reviewer-role-pack`；
  - Spec 5.2 `design-review-execution-control`；
  - Spec 5.3 `design-review-triage-and-readiness`；
  - Spec 5.4 `design-revision-loop`。
- 保持与 `workflow-runtime-orchestrator`、`agent-execution-runtime` 和 `skill-phase-adapters` 的边界清晰。

## Primary Users / Roles

- **Workflow user**：希望在批准 design 进入 planning 前，获得自动化 design review 反馈，并清楚看到是否存在 blocking issue。
- **Brainstorming Pro maintainer**：需要把 review phase 从 placeholder 升级为可测试、可恢复、可扩展的 runtime-owned panel。
- **Reviewer role implementer**：后续需要在稳定 schema 和 ledger contract 上添加 Product / Architecture / Risk / Testing / Scope reviewers。
- **Security / reliability reviewer**：需要确认 reviewer 不能绕过 lifecycle gate，不能修改 artifacts/state，review 与 approval 必须绑定 exact artifact version。
- **Future triage/revision designer**：需要基于统一 findings 和 ledger 实现 advanced triage、approval readiness refinement 和 design revision loop。
- **Future TUI/status implementer**：需要从 review run / reviewer result / aggregate result 中展示 live progress 和 review summary。

## Non-Goals

- 不实现完整 `full` reviewer role pack；该能力由 Spec 5.1 `design-reviewer-role-pack` 完成。
- 不实现五个 reviewer 的完整 prompt/system prompt。
- 不实现 reviewer subset、partial-success aggregation、failed reviewer retry 或 accept-incomplete review；这些能力由 Spec 5.2 `design-review-execution-control` 完成。
- 不实现 advanced triage、冲突归并、must-fix/should-fix/note 精细分类；该能力由 Spec 5.3 `design-review-triage-and-readiness` 完成。
- 不实现 automatic design revision loop；该能力由 Spec 5.4 `design-revision-loop` 完成。
- 不实现 plan review panel。
- 不实现 execution review panel。
- 不新增 public command surface。
- 不实现 workflow UX/TUI 展示细节。
- 不允许 review panel 自动 approve design。
- 不允许 reviewer 直接修改 `design.md`、`requirements.md`、`tasks.md`、approval、decision 或 workflow state。
- 不允许 `full` review 在不可用时静默降级为 `minimal` 或 `skip`。
- 不公开 generic subagent command/tool。
- 不实现 background async runner。

## Context

Brainstorming Pro 已完成或正在完成以下基础：

- Spec 1 `workflow-runtime-orchestrator`：workflow state machine、artifact store、event log、review decision gate、approval gate、phase adapter registry。
- Spec 3 `agent-execution-runtime`：role-based `runAgent()`、safe child Pi launch、`--no-session`、`--no-skills`、structured output validation、timeout/output limits、audit files、progress hooks。
- Spec 4 `skill-phase-adapters`：agent-backed `BrainstormingPhaseAdapter` 和 `SpecPlanPhaseAdapter`，并为 design reviser / execution adapter 建立 shared prompt/schema/context foundation。
- Spec 4.1 `controlled-spec-exec-adapter`：execution 阶段由 code-owned task loop 控制，不设置默认 execution-review phase。

当前 `extensions/clarification-orchestrator/workflow/adapters/design-review.ts` 仍是 placeholder：

- `skip` 返回 `skipped`；
- `full` 返回 `unavailable`；
- `minimal` 仅接受外部传入的 `passed | blocked | failed` 状态；
- 没有真实 reviewer execution、review run、finding schema、aggregation 或 review ledger。

全局 runtime path 中，design review 发生在：

```text
BrainstormingPhaseAdapter produces design vN
  ↓
awaiting-design-review-decision
  ↓ user selects skip | minimal | full bound to design vN
 design-review
  ↓ DesignReviewPanel runs or reports unavailable
awaiting-design-approval | blocked | failed
```

关键约束：

- 进入 planning 前必须完成 design review decision 和 design approval。
- Review decision 和 approval 必须绑定 exact design artifact version。
- Reviewer findings 不能直接 mutate artifacts。
- Runtime owns transitions；adapter/reviewer 只能返回结构化 result。
- `full` unavailable 不能被视为 passed，也不能静默 fallback。

## Discovery

### Key Discoveries

- Design review 是复杂需求稳定性的核心，但不能直接从 placeholder 跳到完整五角色 review panel，否则 prompt、schema、ledger、triage、revision 会一次性耦合过大。
- `minimal` review 不能再是 ad-hoc 状态输入；它必须走与未来 `full` review 相同的 review run / finding / ledger contract，避免后续重构。
- `full` review 是长期核心能力，但首版应先稳定 foundation。Spec 5 定义 `full` contract，Spec 5.1 实现 full reviewer role pack。
- Review 必须绑定 exact design artifact version 和 checksum，否则 design 被修改后旧 review 可能被错误复用。
- Reviewer output 必须视为 untrusted；只有通过 schema validation 和 finding normalization 后才能写入 ledger。
- Basic readiness 可以先 deterministic：存在 blocking finding 则 blocked，否则 passed。reviewer subset、partial aggregation、failed reviewer retry 和 accept-incomplete review 应拆到 Spec 5.2；复杂 deduplication、conflict resolution 和 must-fix/should-fix 分层应拆到 Spec 5.3。
- Blocking finding 后是否自动 revision 是独立复杂问题，应通过 Spec 5.4 处理；Spec 5 只返回 blocked 和 revision hook input。
- Review ledger 应独立于 workflow state truth。State 可引用 review status / latest review run，但完整 reviewer output 和 aggregate result 应在 `.workflow/reviews/design/<review-run-id>/` 中持久化。

### Scope Decisions

包含：

- `DesignReviewPanel` foundation。
- `designReviewAdapter` 与 panel 的 runtime 集成。
- `skip | minimal | full` mode semantics。
- `full-review-unavailable` explicit capability status。
- Review run lifecycle。
- Exact design artifact binding。
- Reviewer role abstraction。
- Minimal reviewer execution path。
- Unified finding schema。
- Basic aggregation/readiness。
- Review ledger writer/reader。
- Stale artifact detection。
- Failure/block/unavailable semantics。
- Follow-up sub spec boundaries。

排除：

- Full reviewer role pack implementation。
- Advanced triage。
- Automatic revision loop。
- Plan review。
- UX/TUI polish。

## Proposed Solution

实现一个 workflow-owned `DesignReviewPanel` foundation。`designReviewAdapter` 在 `design-review` phase 被 runtime 调用后，根据用户已经记录的 review decision 和当前 exact design artifact ref 构造 review request。Panel 首先验证 decision/artifact 是否仍然匹配，然后创建 topic-scoped review run directory。对于 `skip`，adapter 只记录显式 skip 并进入 `awaiting-design-approval`；对于 `minimal`，panel 通过 `agent-execution-runtime` 启动受控 `minimal-reviewer`，解析结构化 findings，写入 ledger，聚合 readiness；对于 `full`，Spec 5 首版检查 full reviewer role pack capability，若未实现则写入 unavailable ledger/event 并返回 `unavailable`，不降级、不通过。

核心原则：

```text
Runtime owns lifecycle and gates.
DesignReviewPanel owns review execution and ledger.
Reviewer agents produce findings only.
Findings do not mutate artifacts.
Readiness does not equal approval.
Full unavailable is explicit, not fallback.
```

### Architecture

```text
Workflow Runtime Orchestrator
  ├─ state machine
  ├─ review decision gate
  ├─ artifact store
  ├─ event log
  └─ designReviewAdapter
       ↓
DesignReviewPanel
  ├─ ReviewModeResolver
  ├─ DesignArtifactBinder
  ├─ ReviewRunStore
  ├─ ReviewerCoordinator
  │    ├─ minimal reviewer runner
  │    └─ full reviewer role set capability check
  ├─ FindingNormalizer
  ├─ BasicFindingAggregator
  ├─ ReadinessEvaluator
  └─ ReviewLedgerWriter
       ↓
Agent Execution Runtime
  └─ runAgent(role = minimal-reviewer)
```

### Components

#### 1. `DesignReviewPanel`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts
```

Responsibilities:

- Accept a `DesignReviewPanelRequest` from `designReviewAdapter`.
- Validate review mode and design artifact binding.
- Create review run.
- Dispatch skip/minimal/full behavior.
- Aggregate reviewer outputs.
- Write review ledger files.
- Return `DesignReviewPanelResult` to adapter.

Suggested types:

```ts
type DesignReviewMode = "skip" | "minimal" | "full";

type DesignReviewPanelRequest = {
  topic: string;
  workflowRunId: string;
  mode: DesignReviewMode;
  designRef: VersionedArtifactRef;
  designContent: string;
  reviewDecisionRef: string;
  projectRoot: string;
  topicDir: string;
  model: ProviderQualifiedModel;
};

type DesignReviewPanelStatus =
  | "skipped"
  | "passed"
  | "blocked"
  | "failed"
  | "unavailable";

type DesignReviewPanelResult = {
  reviewRunId: string;
  mode: DesignReviewMode;
  status: DesignReviewPanelStatus;
  designRef: VersionedArtifactRef;
  aggregate?: DesignReviewAggregateResult;
  ledgerPath: string;
  unavailableReason?: "full-review-unavailable" | "reviewer-role-pack-missing";
  error?: DesignReviewError;
};
```

#### 2. `ReviewModeResolver`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/mode.ts
```

Responsibilities:

- Interpret recorded review decision.
- Enforce that `skip` is user-selected.
- Enforce that `full` unavailable is explicit.
- Prevent fallback from `full` to `minimal`.

Mode semantics:

```text
skip:
  no reviewer execution
  status = skipped
  reason = user-selected-skip

minimal:
  run minimal reviewer
  status = passed | blocked | failed

full:
  Spec 5 foundation checks capability
  if role pack missing: status = unavailable, reason = full-review-unavailable
  Spec 5.1 later replaces capability with real reviewer set execution
```

#### 3. `DesignArtifactBinder`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/artifact-binding.ts
```

Responsibilities:

- Load exact `design` artifact ref from runtime state / artifact store.
- Verify relative path remains topic-scoped.
- Verify checksum matches content.
- Verify review decision references same design version/checksum.
- Reject stale decision/review when latest design changed before review.

Failure behavior:

- checksum mismatch → failed closed;
- decision artifact mismatch → blocked with stale-review-decision diagnostics;
- missing design artifact → failed;
- path escape → security failure / failed.

#### 4. `ReviewRunStore`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts
```

Responsibilities:

- Generate stable review run id.
- Create review directory.
- Write `review-run.json`.
- Write per-reviewer result files.
- Write `aggregated-findings.json`.
- Write `readiness.json`.
- Use atomic writes where possible.
- Keep paths topic-scoped.

Suggested layout:

```text
specs/<topic>/
  .workflow/
    reviews/
      design/
        <review-run-id>/
          review-run.json
          reviewer-results/
            minimal-reviewer.json
            product-reviewer.json
            architecture-reviewer.json
            risk-security-reviewer.json
            testing-reviewer.json
            scope-simplicity-reviewer.json
          aggregated-findings.json
          readiness.json
```

In Spec 5首版，只有 `minimal-reviewer.json` 会被真实写入；full reviewer files 由 Spec 5.1 添加。

Suggested review run schema:

```ts
type DesignReviewRun = {
  reviewRunId: string;
  topic: string;
  workflowRunId: string;
  mode: "minimal" | "full" | "skip";
  status:
    | "created"
    | "running"
    | "collecting"
    | "aggregated"
    | "passed"
    | "blocked"
    | "failed"
    | "skipped"
    | "unavailable";
  designRef: VersionedArtifactRef;
  reviewDecisionRef: string;
  startedAt: string;
  completedAt?: string;
  reviewerResults: DesignReviewerResultRef[];
  aggregateResult?: DesignReviewAggregateResult;
  unavailableReason?: "full-review-unavailable" | "reviewer-role-pack-missing";
};
```

#### 5. `ReviewerCoordinator`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-coordinator.ts
```

Responsibilities:

- Resolve reviewer set for mode.
- Run `minimal-reviewer` for `minimal` mode.
- For `full` mode in Spec 5, return explicit unavailable when role pack capability is absent.
- Provide extension point for Spec 5.1 full reviewer set.
- Capture reviewer timeout/failure/invalid-output as structured reviewer result.

Spec 5 reviewer set:

```ts
type DesignReviewerRole =
  | "minimal-reviewer"
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";
```

Spec 5 only requires agent runtime role `minimal-reviewer` to be executable for design-review. Spec 5.1 registers or maps full reviewer roles.

#### 6. Minimal reviewer prompt/schema

Suggested modules:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/minimal-review.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/schemas.ts
```

Minimal reviewer responsibilities:

- Check if design has enough information to safely proceed to planning.
- Surface obvious missing goals, non-goals, constraints, data flow, error handling, test gaps.
- Identify lifecycle/gate/security risks.
- Return structured findings only.
- Never edit design.
- Never approve design.

Minimal reviewer should be intentionally conservative but not overblock for optional polish issues.

Suggested output schema:

```ts
type MinimalDesignReviewOutput = {
  summary: string;
  findings: DesignReviewFindingDraft[];
  confidence: "low" | "medium" | "high";
};
```

#### 7. `DesignReviewFinding` schema

Suggested canonical schema:

```ts
type DesignReviewFinding = {
  id: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  reviewerRole: DesignReviewerRole;
  category:
    | "product"
    | "architecture"
    | "risk-security"
    | "testing"
    | "scope-simplicity"
    | "consistency"
    | "missing-context";
  severity: "blocking" | "non-blocking" | "note";
  title: string;
  description: string;
  evidence?: string;
  affectedSections?: string[];
  recommendation?: string;
  requiresRevision: boolean;
  userQuestion?: string;
};
```

Validation rules:

- `id` is generated or normalized by panel, not trusted from child output.
- `reviewRunId` and `designRef` are injected by panel.
- `severity = blocking` implies `requiresRevision = true` or `userQuestion` is present.
- Empty title/description is invalid.
- Unknown categories are rejected or normalized to `missing-context` only if safe.
- Findings cannot contain file paths outside topic/project context as artifact refs.

#### 8. `FindingNormalizer`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/finding-normalizer.ts
```

Responsibilities:

- Convert reviewer draft findings into canonical `DesignReviewFinding`.
- Inject review run id, design ref, reviewer role.
- Assign deterministic ids.
- Validate severity/category.
- Drop or fail on malformed entries according to mode policy.

Spec 5 policy:

- If reviewer output schema fails entirely → review failed.
- If individual optional finding is malformed but output is otherwise valid → fail closed in first implementation unless diagnostics prove safe normalization.

#### 9. `BasicFindingAggregator`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/aggregation.ts
```

Responsibilities:

- Group findings by severity/category/reviewer.
- Count blocking/non-blocking/note findings.
- Produce summary.
- Preserve all raw normalized findings.

Spec 5 deliberately avoids reviewer execution-control semantics and advanced deduplication/conflict resolution. Spec 5.2 adds reviewer selection, partial aggregation, retry, and accept-incomplete behavior; Spec 5.3 enhances deduplication/conflict handling and readiness refinement.

Suggested aggregate schema:

```ts
type DesignReviewAggregateResult = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  status: "passed" | "blocked" | "failed" | "skipped" | "unavailable";
  summary: string;
  counts: {
    blocking: number;
    nonBlocking: number;
    notes: number;
    byCategory: Record<string, number>;
    byReviewer: Record<string, number>;
  };
  findings: DesignReviewFinding[];
  readiness: DesignApprovalReadiness;
};
```

#### 10. `ReadinessEvaluator`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/readiness.ts
```

Responsibilities:

- Evaluate whether design review passed.
- Produce readiness report for `awaiting-design-approval` display.
- Keep approval separate from readiness.

Spec 5 readiness rule:

```text
if status = skipped:
  readiness = skipped-by-user
elif status = unavailable:
  readiness = not-ready
elif any blocking finding:
  readiness = blocked
elif reviewer failed or output invalid:
  readiness = failed
else:
  readiness = ready-for-user-approval
```

Suggested schema:

```ts
type DesignApprovalReadiness = {
  status:
    | "ready-for-user-approval"
    | "blocked"
    | "failed"
    | "not-ready"
    | "skipped-by-user";
  blockingFindingIds: string[];
  unresolvedUserQuestions: string[];
  summary: string;
};
```

### Data Flow

#### Skip path

```text
User selects skip for design vN
  ↓
Runtime records review decision bound to design vN/checksum
  ↓
designReviewAdapter receives mode = skip
  ↓
DesignReviewPanel writes skipped review run / ledger entry
  ↓
Panel returns status = skipped
  ↓
Runtime records event and moves to awaiting-design-approval
```

#### Minimal review path

```text
User selects minimal for design vN
  ↓
Runtime records review decision bound to design vN/checksum
  ↓
Runtime enters design-review
  ↓
designReviewAdapter builds panel request
  ↓
DesignArtifactBinder validates exact design ref/checksum
  ↓
ReviewRunStore creates .workflow/reviews/design/<review-run-id>/
  ↓
ReviewerCoordinator runs minimal-reviewer through runAgent()
  ↓
Agent output schema validation
  ↓
FindingNormalizer creates canonical findings
  ↓
BasicFindingAggregator groups findings
  ↓
ReadinessEvaluator determines passed or blocked
  ↓
ReviewLedgerWriter writes reviewer result, aggregate, readiness
  ↓
Panel returns result to adapter
  ↓
Runtime commits review status/events
  ↓
If passed: awaiting-design-approval
If blocked/failed: blocked or failed according to runtime error boundary
```

#### Full review path in Spec 5

```text
User selects full for design vN
  ↓
Runtime records review decision bound to design vN/checksum
  ↓
Runtime enters design-review
  ↓
DesignArtifactBinder validates exact design ref/checksum
  ↓
DesignReviewPanel checks full reviewer role pack capability
  ↓
Capability missing in Spec 5 foundation
  ↓
Panel writes review run with status = unavailable, reason = full-review-unavailable
  ↓
Panel returns unavailable
  ↓
Runtime records unavailable event/status
  ↓
Workflow does not enter awaiting-design-approval because full review did not pass or skip
  ↓
User can resume and choose a supported path or wait until Spec 5.1 enables full review
```

#### Future full path after Spec 5.1

```text
User selects full for design vN
  ↓
Panel resolves full reviewer set
  ↓
ReviewerCoordinator runs reviewers in parallel:
    product, architecture, risk-security, testing, scope-simplicity
  ↓
Each reviewer returns structured findings
  ↓
Panel normalizes and aggregates all findings
  ↓
ReadinessEvaluator returns ready or blocked
  ↓
Runtime proceeds exactly like minimal path
```

## Error Handling

### 1. Stale or mismatched artifact

If review decision references design vN but latest design is vN+1, or checksum mismatches:

- fail closed;
- do not run reviewers;
- return blocked/failed diagnostics;
- require new review decision for latest design version.

### 2. Missing design artifact

If `designRef` cannot be loaded or points outside topic dir:

- fail closed;
- no reviewer execution;
- record diagnostic event;
- do not proceed to approval.

### 3. Full review unavailable

If mode is `full` and full reviewer role pack is unavailable in Spec 5:

- return `status = unavailable`;
- write ledger with `unavailableReason = full-review-unavailable`;
- do not fallback;
- do not mark review passed;
- do not proceed to approval.

### 4. Reviewer timeout/non-zero exit

For `minimal`:

- timeout/non-zero exit returns review `failed` unless retry policy succeeds;
- write reviewer result with failure diagnostics;
- do not proceed to approval.

For future `full`:

- Spec 5.1 makes the complete five-role full review executable and fails closed when a required reviewer fails.
- Spec 5.2 adds controlled partial-success aggregation, failed reviewer retry, and explicit accept-incomplete semantics. Spec 5 requires no silent success when required reviewer fails.

### 5. Invalid reviewer output

If child output cannot parse or fails schema validation:

- review status = failed;
- write invalid-output diagnostics;
- do not use partial unvalidated content as findings.

### 6. Blocking findings

If aggregation includes one or more blocking findings:

- review status = blocked;
- readiness = blocked;
- runtime must not move to `awaiting-design-approval` as if passed;
- future Spec 5.3 may triage findings into readiness/refinement reports, and Spec 5.4 may consume them as revision input.

### 7. Ledger write failure

If review ledger cannot be written atomically:

- review status = failed;
- do not treat reviewer result as durable;
- runtime must not proceed.

### 8. Adapter boundary violation

If any reviewer or panel output attempts to approve design, modify state, or commit artifacts directly:

- ignore unauthorized fields;
- fail validation if detected in structured output;
- record diagnostics;
- keep runtime state unchanged except failure/block event handled by runtime.

## Testing

### Unit tests

Suggested locations:

```text
tests/unit/workflow/design-review-panel-*.test.ts
tests/unit/workflow/adapters/design-review.test.ts
```

Cases:

- `skip` writes skipped review run and returns skipped.
- `minimal` creates review run with exact design ref.
- `minimal` valid reviewer output normalizes findings.
- No blocking findings → readiness `ready-for-user-approval` and review status `passed`.
- Blocking finding → readiness `blocked` and review status `blocked`.
- Invalid reviewer output → review status `failed`.
- Missing design artifact → fail closed.
- Checksum mismatch → fail closed.
- Review decision artifact mismatch → stale decision blocked.
- `full` without role pack → `unavailable` with `full-review-unavailable`.
- `full` unavailable does not fallback to minimal.
- Reviewer cannot inject approval/state mutation fields.
- Review ledger paths are topic-scoped.

### Integration tests

Suggested locations:

```text
tests/integration/design-review-panel.test.ts
```

Cases:

- Workflow reaches `awaiting-design-review-decision`, user selects `minimal`, panel runs, runtime reaches `awaiting-design-approval` only when passed.
- Workflow selecting `full` before Spec 5.1 records unavailable and does not enter approval.
- Stale design after review decision requires new decision.
- Interrupted review run can be diagnosed via status/resume using ledger/state.

### Security tests

Suggested locations:

```text
tests/security/design-review-panel-*.test.ts
```

Cases:

- Review ledger cannot escape `.workflow/reviews/design/`.
- Artifact refs cannot reference external files.
- Reviewer output cannot create external artifact refs.
- Child reviewer still uses `--no-session` and `--no-skills` through agent runtime.
- Full unavailable cannot be interpreted as passed through crafted output.

### Documentation alignment tests

Update docs tests if README or workflow docs expose review behavior:

- `full` mode unavailable is explicit before Spec 5.1.
- `minimal` review is real and writes ledger.
- Review readiness is not design approval.

## Open Questions

1. Should Spec 5 `minimal` reviewer be the existing `minimal-reviewer` role, or should design-specific minimal review get a distinct role such as `design-minimal-reviewer` in Spec 5.1?
2. Should `full` unavailable leave workflow in `design-review`, move to `blocked`, or return to `awaiting-design-review-decision` with a recorded unavailable attempt? The design preference is fail closed without approval; exact phase recovery should align with existing runtime blocked/resume semantics.
3. Should malformed individual findings fail the whole review, or can safe findings be preserved while invalid findings are dropped with diagnostics? First implementation should fail closed unless a deterministic safe-normalization rule is added.
4. Should review run ids be timestamp-based, UUID-based, or derived from workflow run + design version + attempt number? They must be unique and stable in paths.
5. Should minimal review use one child agent only, or can it be implemented deterministically without child execution for some structural checks? The preferred path is one child reviewer plus deterministic artifact binding/validation.
6. How much of readiness summary should be human-facing markdown versus JSON-only? Spec 5 should store JSON; UX/TUI specs can render summaries.
7. Should `DesignReviewPanel` write a markdown summary artifact, or only JSON ledger? First implementation should prefer JSON ledger and status rendering, avoiding new top-level artifacts unless UX requires them.
