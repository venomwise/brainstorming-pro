# Design Review Execution Control Design

## Summary

新增 **Design Review Execution Control**，在 Spec 5 `design-review-panel` 与 Spec 5.1 `design-reviewer-role-pack` 的基础上，为 full design review 增加用户可控 reviewer subset、partial-success aggregation、failed reviewer retry 和 explicit accept-incomplete gate。该 spec 让 design review 从 “五个 reviewer 一次性全部成功或整体失败” 演进为可恢复、可审计、版本绑定的执行控制模型：用户可以为当前 exact `design.md` artifact 选择一个或多个 reviewer，系统聚合成功 reviewer 的 findings，记录失败 reviewer diagnostics，允许只重试失败 reviewer，并且只在满足安全条件且用户显式接受 incomplete review 后进入 design approval gate。

## Goals

- 扩展 design review decision model，使 `full` mode 可绑定一个用户选择的 full reviewer subset。
- 保持 full review 默认行为为全选五个 reviewer，但允许用户选择一个或多个 reviewer。
- 引入 selected / unselected / succeeded / failed / pending-retry reviewer coverage model。
- 支持 partial-success aggregation：成功 reviewer 的 findings 进入 aggregate，失败 reviewer 只记录 diagnostics。
- 引入 `partial` review status 和 `incomplete-review` readiness，清楚区分 incomplete review 与 passed review。
- 支持 failed reviewer retry，默认只重试失败 reviewer，并保持同一个 design artifact version/checksum binding。
- 引入 explicit accept-incomplete decision gate：当至少一个 selected reviewer 成功、无 blocking findings、且仍有 failed reviewer 时，用户可以显式接受 incomplete review 并进入 design approval gate。
- 为 retry、accept-incomplete、reviewer selection 写入 event log 和 review ledger，保证 audit、status、resume 和未来 TUI 展示可用。
- 定义 `/brainstorm-pro --resume` / status 所需的 recovery contract，但不在本 spec 中实现完整 UX polish。
- 保持 runtime authority：review panel、reviewer、父 LLM 都不能自动 approve design 或绕过 gate。

## Primary Users / Roles

- **Workflow user**：希望 full review 不因单个 reviewer 超时或失败而完全阻塞，也希望能按当前关注点选择 reviewer subset。
- **Brainstorming Pro maintainer**：需要可测试、可恢复、可审计的 design review execution control 语义。
- **Security / reliability reviewer**：需要确认 partial review 不会被误认为完整 review passed，accept incomplete 必须由用户显式确认且绑定 exact artifact。
- **Future UX/TUI implementer**：需要稳定的 resume/status contract 展示 reviewer coverage、failed reviewer retry、accept incomplete 等恢复动作。
- **Future triage/revision designer**：需要基于 partial aggregation 和 coverage 信息继续实现 advanced triage、readiness refinement 与 revision loop。

## Non-Goals

- 不实现五个 full reviewer prompt、system prompt 或 role registration；这些属于 Spec 5.1 `design-reviewer-role-pack`。
- 不重新定义 Spec 5 的 canonical `DesignReviewFinding` schema。
- 不实现 advanced triage、finding deduplication、conflict resolution、must-fix/should-fix/note 分类；这些属于 Spec 5.3 `design-review-triage-and-readiness`。
- 不实现 automatic design revision loop；该能力属于 Spec 5.4 `design-revision-loop`。
- 不实现 plan review。
- 不实现 design approval automation。
- 不新增默认 public command surface；本 spec 只定义 runtime/resume contract，具体 `/brainstorm-pro --resume` 交互由 Spec 7 `workflow-ux-interface` 完成。
- 不允许 reviewer、review panel 或父 LLM 修改 `design.md`、approval、decision 或 workflow state。
- 不允许 partial review 静默进入 approval gate；必须经过 explicit accept-incomplete decision 或 retry 到完整成功。

## Context

全局 roadmap 将 design review 拆为四个连续 spec：

```text
Spec 5:   design-review-panel
Spec 5.1: design-reviewer-role-pack
Spec 5.2: design-review-execution-control
Spec 5.3: design-review-triage-and-readiness
Spec 5.4: design-revision-loop
```

Spec 5 已建立 foundation：

- design review decision gate；
- exact design artifact version/checksum binding；
- review run lifecycle；
- ledger under `.workflow/reviews/design/<review-run-id>/`；
- canonical finding schema；
- minimal review；
- basic aggregation/readiness；
- full unavailable capability contract。

Spec 5.1 将 full review 从 unavailable 变成可执行：

- Product Reviewer；
- Architecture Reviewer；
- Risk / Security Reviewer；
- Testing Reviewer；
- Scope / Simplicity Reviewer；
- 默认 full review 运行完整五角色集合；
- 任一 required reviewer 失败时，Spec 5.1 full review fail closed。

Spec 5.2 解决 Spec 5.1 的可用性和恢复性问题。full review 的 reviewer execution 可能因为 timeout、invalid output、child process failure、model transient error 等原因部分失败。此时成功 reviewer 的 findings 仍有价值，但不能被误认为完整 review。系统需要一种 runtime-owned、ledger-backed、用户显式确认的控制模型来处理 partial success、retry 和 incomplete acceptance。

现有全局约束仍然有效：

- Runtime owns lifecycle and transitions。
- Review decision 和 approval 必须绑定 exact artifact version/checksum。
- Reviewer output 是 untrusted，必须 schema validation / normalization 后才能写入 ledger。
- Review readiness 不等于 approval。
- Design approval 必须由用户显式完成，不能由 review 自动通过。

## Discovery

### Key Discoveries

- Spec 5.2 的核心不是 reviewer capability，而是 review execution control 和 recovery semantics。
- reviewer subset selection 是 design review decision 的扩展，而不是独立 public command 或独立顶层产品模型。
- 同一个 review run 内 reviewer selection 应保持稳定；否则 coverage、retry 和 accept-incomplete 的 audit 语义会复杂化。
- Retry 应优先只重试 failed reviewers，复用 successful reviewers 的 latest effective results。
- Partial aggregation 有价值，但不能等同 passed review；必须通过 `partial` status 和 `incomplete-review` readiness 显式表达。
- Accept incomplete 是用户 gate，应写入独立 decision record 和 event log，不能只靠 readiness 字段暗示。
- 有 blocking findings 时不能 accept incomplete；即使部分 reviewer 失败，已发现的 blocking issue 也必须阻止进入 approval gate。
- Stale design artifact 必须使 retry 和 accept-incomplete fail closed；旧 review coverage 不能绑定到新 design version。

### Scope Decisions

包含：

- reviewer selection decision model；
- full reviewer subset validation；
- reviewer coverage model；
- `partial` review status；
- `incomplete-review` readiness；
- partial-success aggregation；
- retry attempt model；
- failed reviewer retry；
- accept-incomplete decision gate；
- ledger layout extension；
- event log extension；
- resume/status recovery contract。

排除：

- full reviewer implementation；
- advanced triage；
- design revision；
- plan review；
- public UX polish；
- approval automation。

## Proposed Solution

将 reviewer execution control 纳入 workflow-owned design review runtime。用户在 design review decision gate 选择 `full` mode 时，可以接受默认完整五 reviewer 集合，也可以选择一个或多个 full reviewer roles。该 selection 与 exact design artifact version/checksum 绑定，并记录为 review decision 的一部分。

Review panel 执行 selected reviewers 后，生成 coverage：哪些 reviewer 被选择、未选择、成功、失败、待 retry。成功 reviewer 的 findings 被 normalized 并进入 aggregate；失败 reviewer 的错误写入 diagnostics，但不被转换成 findings。如果 selected reviewers 全部成功，则沿用 Spec 5/5.1 的 passed/blocked 规则；如果部分成功、部分失败，则进入 partial result 语义。无 blocking findings 时 readiness 为 `incomplete-review`，runtime 通过 resume contract 向用户提供 retry failed reviewers 或 accept incomplete 的恢复动作。有 blocking findings 时 readiness 为 `blocked`，不能 accept incomplete。

核心原则：

```text
Reviewer selection is part of the review decision.
Same review run keeps a stable selected reviewer set.
Retry only re-executes failed reviewers by default.
Partial aggregation is useful but never equals approval readiness by itself.
Accept incomplete is an explicit user decision.
Approval remains a separate user gate.
Artifact binding remains exact and non-bypassable.
```

### Architecture

```text
Workflow Runtime Orchestrator
  ├─ design review decision gate
  │    └─ mode + selected reviewer roles + exact design ref
  ├─ event log
  ├─ resume/status recovery contract
  └─ designReviewAdapter
       ↓
DesignReviewPanel
  ├─ DesignArtifactBinder
  ├─ ReviewerSelectionResolver       (new)
  ├─ ReviewCoverageTracker          (new)
  ├─ ReviewAttemptStore             (new)
  ├─ ReviewerCoordinator            (extended)
  ├─ FindingNormalizer
  ├─ PartialFindingAggregator       (new / extension of basic aggregator)
  ├─ ReadinessEvaluator             (extended)
  ├─ AcceptIncompleteGate           (new)
  └─ ReviewLedgerWriter             (extended)
       ↓
Agent Execution Runtime
  └─ runAgent(role = selected full reviewer)
```

### Components

#### 1. Reviewer Selection Decision Model

Extend design review decision for `full` mode:

```ts
type DesignReviewDecision = {
  decisionId: string;
  mode: "skip" | "minimal" | "full";
  designRef: VersionedArtifactRef;
  selectedReviewerRoles?: FullDesignReviewerRole[];
  selectionReason?: string;
  createdAt: string;
};
```

Rules:

- `skip` cannot include `selectedReviewerRoles`。
- `minimal` cannot include full reviewer selection。
- `full` with omitted `selectedReviewerRoles` means default full set: all five reviewers。
- `full` with provided `selectedReviewerRoles` must include at least one valid full reviewer role。
- Duplicate roles are invalid。
- Unknown roles are invalid。
- `minimal-reviewer` is invalid in full reviewer selection。
- Selection binds to exact `designRef.version` and checksum。
- If the design artifact changes, reviewer selection is stale and must be recreated。

#### 2. Reviewer Selection Resolver

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-selection.ts
```

Responsibilities:

- Resolve default full set when no subset is provided。
- Validate explicit subset。
- Compute selected and unselected reviewer roles。
- Ensure all selected roles are registered and allowed for `design-review` phase。
- Return deterministic role ordering for execution and ledger output。

Suggested type:

```ts
type ResolvedDesignReviewerSelection = {
  mode: "full";
  allAvailableReviewers: FullDesignReviewerRole[];
  selectedReviewers: FullDesignReviewerRole[];
  unselectedReviewers: FullDesignReviewerRole[];
  designRef: VersionedArtifactRef;
};
```

#### 3. Reviewer Coverage Model

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts
```

Suggested type:

```ts
type DesignReviewCoverage = {
  allAvailableReviewers: FullDesignReviewerRole[];
  selectedReviewers: FullDesignReviewerRole[];
  unselectedReviewers: FullDesignReviewerRole[];
  succeededReviewers: FullDesignReviewerRole[];
  failedReviewers: FullDesignReviewerRole[];
  pendingRetryReviewers: FullDesignReviewerRole[];
};
```

Coverage semantics:

- `selectedReviewers` is stable for a review run。
- `unselectedReviewers` are intentionally not part of the review and should not be treated as failures。
- `succeededReviewers` are selected reviewers with latest effective success result。
- `failedReviewers` are selected reviewers whose latest effective result failed。
- `pendingRetryReviewers` usually equals failed reviewers unless workflow is no longer retryable。

#### 4. Partial Review Status and Readiness

Extend review run status:

```ts
type DesignReviewRunStatus =
  | "created"
  | "running"
  | "collecting"
  | "aggregated"
  | "passed"
  | "blocked"
  | "failed"
  | "skipped"
  | "unavailable"
  | "partial";
```

Extend readiness:

```ts
type DesignApprovalReadinessStatus =
  | "ready-for-user-approval"
  | "blocked"
  | "failed"
  | "not-ready"
  | "skipped-by-user"
  | "incomplete-review";
```

Readiness rules:

```text
all selected succeeded + no blocking findings
  → review status = passed
  → readiness = ready-for-user-approval

all selected succeeded + any blocking finding
  → review status = blocked
  → readiness = blocked

some selected succeeded + some selected failed + no blocking findings
  → review status = partial
  → readiness = incomplete-review

some selected succeeded + some selected failed + any blocking finding
  → review status = blocked
  → readiness = blocked

all selected failed
  → review status = failed
  → readiness = failed
```

#### 5. Partial-Success Aggregation

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/partial-aggregation.ts
```

Responsibilities:

- Aggregate normalized findings from successful reviewer results。
- Exclude failed reviewer diagnostics from findings。
- Preserve failed reviewer diagnostics separately in coverage and per-reviewer result files。
- Include coverage in aggregate output。
- Avoid advanced deduplication/conflict resolution; leave that to Spec 5.3。

Suggested aggregate extension:

```ts
type DesignReviewAggregateResult = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  status: "passed" | "blocked" | "failed" | "skipped" | "unavailable" | "partial";
  summary: string;
  coverage?: DesignReviewCoverage;
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

#### 6. Retry Attempt Model

Add attempt tracking under each review run. Same review run keeps the same selected reviewer set; retry creates a new attempt and only executes failed reviewers by default.

Suggested layout:

```text
specs/<topic>/
  .workflow/
    reviews/
      design/
        <review-run-id>/
          review-run.json
          coverage.json
          attempts/
            attempt-001/
              attempt.json
              reviewer-results/
                product-reviewer.json
                risk-security-reviewer.json
            attempt-002/
              attempt.json
              reviewer-results/
                risk-security-reviewer.json
          reviewer-results/
            product-reviewer.json
            architecture-reviewer.json
            risk-security-reviewer.json
            testing-reviewer.json
            scope-simplicity-reviewer.json
          aggregated-findings.json
          readiness.json
          accept-incomplete-decision.json
```

Attempt schema:

```ts
type DesignReviewAttempt = {
  attemptId: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  reviewerRoles: FullDesignReviewerRole[];
  reason: "initial" | "retry-failed-reviewers";
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed";
  succeededReviewerRoles: FullDesignReviewerRole[];
  failedReviewerRoles: FullDesignReviewerRole[];
};
```

Top-level `reviewer-results/<role>.json` stores the latest effective result for each selected reviewer. Attempt-level results preserve audit history.

Retry rules:

- Retry preserves `reviewRunId` and exact `designRef`。
- Retry default target set is current `failedReviewers`。
- Succeeded reviewer results are not re-run by default。
- If retry succeeds, top-level effective reviewer result is updated。
- If retry fails again, diagnostics are updated and another retry remains possible if runtime policy allows。
- Changing reviewer selection requires a new review decision and new review run。

#### 7. Accept Incomplete Gate

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/accept-incomplete.ts
```

Suggested decision schema:

```ts
type AcceptIncompleteDesignReviewDecision = {
  decisionId: string;
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  acceptedCoverage: DesignReviewCoverage;
  succeededReviewerResultRefs: string[];
  failedReviewerDiagnosticsRefs: string[];
  aggregateRef: string;
  decidedBy: "user";
  reason?: string;
  createdAt: string;
};
```

Accept incomplete is allowed only when:

- review mode is `full`；
- at least one selected reviewer succeeded；
- at least one selected reviewer failed；
- successful reviewer findings contain no blocking findings；
- readiness is `incomplete-review`；
- design artifact version/checksum still matches the bound review decision；
- user explicitly confirms accept incomplete；
- ledger and event log can be written durably。

Accept incomplete is rejected when:

- all selected reviewers failed；
- any aggregated successful finding is blocking；
- design artifact is stale；
- review run ledger is missing or corrupted；
- user did not explicitly confirm；
- mode is `skip` or `minimal`。

After accepted incomplete:

```text
review remains marked incomplete but accepted
runtime may move to awaiting-design-approval
user must still explicitly approve design before planning
```

#### 8. Runtime Resume / Status Contract

Spec 5.2 defines recovery actions for future `/brainstorm-pro --resume` UX:

```ts
type DesignReviewRecoveryAction =
  | {
      type: "retry-failed-reviewers";
      reviewRunId: string;
      failedReviewerRoles: FullDesignReviewerRole[];
    }
  | {
      type: "accept-incomplete-review";
      reviewRunId: string;
      designRef: VersionedArtifactRef;
      coverage: DesignReviewCoverage;
    }
  | {
      type: "replace-review-selection";
      designRef: VersionedArtifactRef;
      availableReviewerRoles: FullDesignReviewerRole[];
    }
  | {
      type: "view-review-ledger";
      reviewRunId: string;
      ledgerPath: string;
    };
```

When review readiness is `incomplete-review`, status/resume should expose at least:

- selected reviewers；
- unselected reviewers；
- succeeded reviewers；
- failed reviewers；
- failed reviewer diagnostics summary；
- aggregate finding counts from successful reviewers；
- available recovery actions。

Recommended top-level workflow behavior:

- Do not add a new workflow state unless existing runtime cannot model recoverable blocked states。
- Represent partial/incomplete review as recoverable `blocked` with reason `incomplete-design-review` and resume actions。
- Retry or accept-incomplete resumes from that recoverable state。

#### 9. Event Log Extensions

Add event types for audit and recovery:

```ts
type DesignReviewExecutionControlEvent =
  | {
      type: "design-review-reviewer-selection-recorded";
      reviewDecisionId: string;
      designRef: VersionedArtifactRef;
      selectedReviewerRoles: FullDesignReviewerRole[];
      unselectedReviewerRoles: FullDesignReviewerRole[];
      createdAt: string;
    }
  | {
      type: "design-review-attempt-started";
      reviewRunId: string;
      attemptId: string;
      reviewerRoles: FullDesignReviewerRole[];
      createdAt: string;
    }
  | {
      type: "design-review-attempt-completed";
      reviewRunId: string;
      attemptId: string;
      succeededReviewerRoles: FullDesignReviewerRole[];
      failedReviewerRoles: FullDesignReviewerRole[];
      createdAt: string;
    }
  | {
      type: "design-review-partial-aggregated";
      reviewRunId: string;
      coverage: DesignReviewCoverage;
      readinessStatus: "incomplete-review" | "blocked" | "failed";
      createdAt: string;
    }
  | {
      type: "design-review-failed-reviewers-retried";
      reviewRunId: string;
      attemptId: string;
      reviewerRoles: FullDesignReviewerRole[];
      createdAt: string;
    }
  | {
      type: "design-review-incomplete-accepted";
      decisionId: string;
      reviewRunId: string;
      designRef: VersionedArtifactRef;
      acceptedCoverage: DesignReviewCoverage;
      createdAt: string;
    };
```

Events must be append-only and must not be inferred solely from mutable ledger files.

### Data Flow

#### Default Full Review Path

```text
User selects full review for design vN without reviewer subset
  ↓
Runtime records review decision bound to design vN/checksum
  ↓
ReviewerSelectionResolver defaults to all five full reviewers
  ↓
DesignReviewPanel creates review run and attempt-001
  ↓
ReviewerCoordinator runs all five reviewers
  ↓
All reviewers succeed
  ↓
Findings aggregate
  ↓
No blocking findings → passed / ready-for-user-approval
Blocking findings → blocked / blocked
```

#### Reviewer Subset Path

```text
User selects full review for design vN with selected reviewer subset
  ↓
Runtime validates subset and records selection in review decision
  ↓
Review run selected set remains stable
  ↓
Only selected reviewers execute
  ↓
Unselected reviewers are recorded as unselected, not failed
  ↓
Aggregation/readiness use selected reviewer results only
```

#### Partial Success Path

```text
Selected reviewers: product, architecture, risk-security
  ↓
product succeeds
architecture succeeds
risk-security fails
  ↓
product + architecture findings normalize and aggregate
  ↓
risk-security diagnostics recorded separately
  ↓
No blocking findings from successful reviewers
  ↓
review status = partial
readiness = incomplete-review
  ↓
Runtime exposes retry-failed-reviewers and accept-incomplete-review actions
```

#### Failed Reviewer Retry Path

```text
Review run has failed reviewer: risk-security
  ↓
User chooses retry failed reviewers
  ↓
Runtime verifies designRef is still latest exact bound design
  ↓
ReviewAttemptStore creates attempt-002
  ↓
Only risk-security reviewer executes
  ↓
If retry succeeds:
    update top-level effective risk-security result
    recompute coverage and aggregate
    if no failed reviewers and no blocking findings → passed
    if no failed reviewers and blocking findings → blocked
  ↓
If retry fails:
    keep status partial or failed according to coverage
    expose retry again if policy permits
```

#### Accept Incomplete Path

```text
Review readiness = incomplete-review
  ↓
User explicitly accepts incomplete review
  ↓
Runtime verifies:
    exact design binding still valid
    at least one selected reviewer succeeded
    at least one selected reviewer failed
    no blocking findings in aggregate
    ledger is durable
  ↓
AcceptIncompleteGate writes decision record
  ↓
Runtime appends design-review-incomplete-accepted event
  ↓
Runtime moves to awaiting-design-approval
  ↓
User must still explicitly approve exact design before planning
```

#### Stale Artifact Path

```text
Review decision bound to design vN
  ↓
Design changes to vN+1 before retry or accept incomplete
  ↓
Runtime detects designRef/checksum mismatch
  ↓
Retry / accept incomplete rejected
  ↓
User must make a new review decision for design vN+1
```

## Error Handling

### 1. Invalid reviewer selection

Reject review decision if:

- selected reviewer list is empty；
- list contains duplicates；
- list contains unknown roles；
- list contains `minimal-reviewer`；
- selected role is not registered in agent runtime；
- selected role is not allowed in `design-review` phase。

No review run should be created for invalid selection.

### 2. Stale artifact binding

If design artifact version/checksum differs from the recorded review decision during initial execution, retry, or accept incomplete:

- fail closed；
- do not run reviewers；
- do not accept incomplete；
- require new review decision for the latest design artifact。

### 3. Some selected reviewers fail

If at least one reviewer succeeds and at least one fails:

- write successful reviewer results；
- write failed reviewer diagnostics；
- aggregate successful findings only；
- compute coverage；
- expose retry and, if safe, accept incomplete。

### 4. All selected reviewers fail

If all selected reviewers fail:

- review status = `failed`；
- readiness = `failed`；
- accept incomplete is not allowed；
- retry failed reviewers may still be offered if runtime policy treats it as recoverable。

### 5. Blocking findings in partial review

If successful reviewer findings include any blocking finding:

- review status = `blocked`；
- readiness = `blocked`；
- accept incomplete is not allowed；
- failed reviewer retry may still be offered, but approval gate remains blocked until blocking findings are resolved by later revision flow or user-approved process。

### 6. Retry ledger failure

If attempt files, reviewer result files, coverage, aggregate, readiness, or event append fail:

- do not treat retry result as durable；
- keep previous effective results；
- return failed diagnostics；
- do not proceed to approval。

### 7. Accept incomplete without explicit user decision

If accept incomplete is requested by agent output, reviewer output, parent LLM implication, or missing explicit user confirmation:

- reject；
- do not write accept-incomplete decision；
- do not enter approval gate。

### 8. Corrupted or missing ledger

If review run files are missing, corrupted, or inconsistent with event log/state:

- fail closed；
- do not retry or accept incomplete based on incomplete evidence；
- surface diagnostics through status/resume。

### 9. Unauthorized mutation attempts

If reviewer output, retry result, or accept-incomplete payload attempts to modify artifacts/state/approval/review decisions:

- reject untrusted fields；
- fail validation when detected；
- keep runtime state authority with orchestrator only。

## Testing

### Unit tests

Suggested locations:

```text
tests/unit/workflow/design-review-execution-control-selection.test.ts
tests/unit/workflow/design-review-execution-control-coverage.test.ts
tests/unit/workflow/design-review-execution-control-retry.test.ts
tests/unit/workflow/design-review-execution-control-accept-incomplete.test.ts
tests/unit/workflow/design-review-execution-control-ledger.test.ts
```

Cases:

- `full` review without subset defaults to five reviewers。
- `full` review with subset selects only requested reviewers。
- Empty reviewer subset is rejected。
- Duplicate reviewer roles are rejected。
- Unknown reviewer roles are rejected。
- `minimal-reviewer` in full subset is rejected。
- Selected/unselected coverage is computed deterministically。
- Successful/failed/pending-retry coverage updates after initial run。
- Successful reviewer findings enter aggregate when another reviewer fails。
- Failed reviewer diagnostics do not become findings。
- Partial success with no blocking findings yields `partial` and `incomplete-review`。
- Partial success with blocking findings yields `blocked` and cannot accept incomplete。
- All selected reviewers failed yields `failed` and cannot accept incomplete。
- Retry creates a new attempt id and only executes failed reviewers by default。
- Retry preserves exact design artifact binding。
- Retry success updates top-level effective reviewer result。
- Changing reviewer selection requires new review decision / run。
- Accept incomplete requires explicit user decision。
- Accept incomplete writes decision record and event。
- Accept incomplete moves only to design approval gate, not planning。
- Stale design rejects retry and accept incomplete。

### Integration tests

Suggested location:

```text
tests/integration/design-review-execution-control.test.ts
```

Cases:

- Workflow reaches design review decision, user selects full subset, selected reviewers pass, runtime reaches `awaiting-design-approval`。
- One selected reviewer fails, workflow becomes recoverable incomplete and exposes retry action。
- Retry failed reviewer succeeds, runtime reaches `awaiting-design-approval` when no blocking findings exist。
- One reviewer fails, successful findings have no blocking items, user accepts incomplete, runtime reaches `awaiting-design-approval`。
- One reviewer fails, successful findings include blocking item, accept incomplete is rejected。
- Design changes after partial review, retry and accept incomplete are rejected as stale。

### Security tests

Suggested location:

```text
tests/security/design-review-execution-control.test.ts
```

Cases:

- Reviewer selection cannot reference roles outside the package-owned registry。
- Accept incomplete cannot spoof `designRef` or checksum。
- Ledger paths cannot escape `.workflow/reviews/design/`。
- Crafted reviewer result cannot mark failed reviewer as succeeded。
- Crafted aggregate cannot hide blocking findings to enable accept incomplete。
- Crafted event or decision cannot bypass explicit user confirmation。
- Reviewer output cannot mutate workflow state, approval, or artifact refs。

### Documentation alignment tests

Update docs tests when public docs expose this behavior:

- Full review defaults to five reviewers but may support user-selected subset。
- Partial review is not passed review。
- Accept incomplete is explicit and still requires separate design approval。
- Failed reviewer retry keeps the same artifact binding。

## Open Questions

1. Should partial/incomplete review use existing recoverable `blocked` state with reason `incomplete-design-review`, or should runtime add a dedicated `awaiting-design-review-recovery` state? Recommended: start with recoverable `blocked` plus explicit resume actions to minimize state machine expansion.
2. Should retry have a max attempt count per reviewer? Recommended: define a configurable conservative default in implementation, but keep design focused on attempt model and fail-closed semantics.
3. Should users be allowed to retry all selected reviewers, not only failed reviewers? Recommended: default to failed-only; full rerun can be modeled later as a new review decision/run if needed.
4. Should accept incomplete require a user-provided reason? Recommended: optional reason initially; UX may encourage but not require it.
5. Should unselected reviewers be shown as “not covered” in readiness summaries? Recommended: yes for status/UX, but they must not count as failed reviewers.
6. Should successful partial findings be written to `aggregated-findings.json` even when accept incomplete has not occurred? Recommended: yes, with status `partial` and coverage included, so status/resume can show useful information without implying approval readiness.
