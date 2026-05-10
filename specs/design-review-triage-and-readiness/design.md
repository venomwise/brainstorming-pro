# Design Review Triage and Readiness Design

## Summary

新增 **Design Review Triage and Readiness**，在 Spec 5 `design-review-panel`、Spec 5.1 `design-reviewer-role-pack` 和 Spec 5.2 `design-review-execution-control` 的基础上，把多 reviewer 的原始 findings、partial coverage、retry 后的 effective results、incomplete review 状态转换成稳定、可审计、用户可理解、可驱动后续 revision loop 的 triage report 和 enhanced readiness report。该 spec 聚焦 deterministic finding deduplication、conflict detection、must-fix / should-fix / note 分层、unresolved user question summary、coverage-aware readiness 和 user-facing summary；它不执行 reviewer、不处理 reviewer selection/retry/accept-incomplete、不修改 `design.md`、不自动 approve design。

## Goals

- 在现有 design review aggregate/readiness 之后新增 deterministic-first triage layer。
- 将多个 reviewer 的重复 findings 合并为可追踪的 finding clusters，同时保留所有 source finding ids。
- 检测 reviewer 之间的冲突，包括 severity disagreement、recommendation conflict、scope disagreement 和 readiness disagreement。
- 将 findings/clusters 分层为 `must-fix`、`should-fix`、`note`，供用户理解和后续 Spec 5.4 revision loop 消费。
- 汇总 unresolved user questions，明确哪些问题需要用户决策，哪些可以由后续 reviser 修订。
- 生成 coverage-aware approval readiness report，清楚区分 passed、blocked、partial/incomplete、failed、skipped 和 stale。
- 为 `/brainstorm-pro --status`、`--resume`、未来 TUI 和 revision loop 提供稳定 JSON ledger contract。
- 支持 minimal、full、custom subset、partial/incomplete review result set，不依赖完整五 reviewer 全部成功。
- 当 design artifact、aggregate、coverage 或 effective reviewer results 变化时，使旧 triage/readiness fail closed 或标记 stale。
- 可选支持 agent-generated user summary，但结构化 triage/readiness 的真相必须由 deterministic code 产生。

## Primary Users / Roles

- **Workflow user**：需要看到 review 结果中哪些必须修、哪些建议修、哪些只是备注，以及当前 design 是否可以进入用户 approval gate。
- **Brainstorming Pro maintainer**：需要把基础 aggregate 升级为可测试、可恢复、可驱动 revision 的 triage/readiness contract。
- **Future design reviser / Spec 5.4 implementer**：需要稳定的 must-fix、should-fix、unresolved question 和 conflict 输入来生成新版 `design.md`。
- **Security / reliability reviewer**：需要确认 partial review、conflicting findings、stale artifacts、crafted summaries 不会绕过 approval gate。
- **UX/TUI implementer**：需要从 triage report 中渲染 compact summary、blocked card、coverage summary 和 next action hints。

## Non-Goals

- 不实现 reviewer role prompt、system prompt 或 role registration；这些属于 Spec 5.1。
- 不实现 reviewer selection、partial aggregation、failed reviewer retry 或 accept-incomplete gate；这些属于 Spec 5.2。
- 不重新定义 canonical `DesignReviewFinding` schema；Spec 5.3 消费并扩展其解释层。
- 不执行 reviewer 或重新运行 reviewer。
- 不修改 `design.md`、不提交新版 artifact、不实现 automatic design revision loop；这些属于 Spec 5.4。
- 不自动 approve design。
- 不让 LLM/agent 决定 readiness、severity、triage level、coverage 或 workflow transition。
- 不实现 plan review、execution review 或 plan revision。
- 不新增 public command surface；只提供 runtime/status/resume 可消费的数据 contract。
- 不把 partial/incomplete review 静默当作 passed review。

## Context

全局 roadmap 将 design review 拆为连续子 spec：

```text
Spec 5:   design-review-panel
Spec 5.1: design-reviewer-role-pack
Spec 5.2: design-review-execution-control
Spec 5.3: design-review-triage-and-readiness
Spec 5.4: design-revision-loop
```

当前已具备：

- review run lifecycle 和 ledger：`.workflow/reviews/design/<review-run-id>/`；
- exact design artifact version/checksum binding；
- canonical `DesignReviewFinding`；
- minimal 和 full reviewer execution；
- full reviewer subset、coverage、partial status、retry、accept incomplete；
- basic aggregate：counts、raw normalized findings、basic readiness；
- runtime authority：review/readiness 不等于 approval，design approval 仍是独立用户 gate。

当前缺口是：基础 aggregate 仍偏机械，无法很好回答这些问题：

- 多个 reviewer 是否在说同一个问题？
- 哪些问题必须在 planning 前修复？
- 哪些只是建议或备注？
- reviewer 之间是否存在冲突？
- partial review 的 coverage 风险如何解释？
- 哪些 unresolved user questions 会阻塞 revision 或 approval？
- retry 或 design 修改后旧 readiness 是否仍可用？

Spec 5.3 解决这些解释和 readiness refinement 问题，为 Spec 5.4 revision loop 提供受控输入。

## Discovery

### Key Discoveries

- Basic aggregation 适合早期 gate enforcement，但不足以指导用户和 reviser 如何处理 review findings。
- Finding deduplication 不能只按 title 字符串合并；应保守使用 category、affected sections、normalized tokens、severity、requiresRevision、userQuestion 等信号。
- 冲突不应该被自动吞掉。Reviewer 之间的不同建议可能代表真实 trade-off，应进入 conflict summary。
- `blocking` 不等于唯一的 must-fix 来源。某些 `non-blocking` finding 如果 `requiresRevision=true` 且涉及 gate/security/artifact binding，也应提升为 must-fix 或至少 should-fix。
- Partial/incomplete review 的 readiness 必须覆盖 coverage 风险；成功 reviewer 没发现 blocker 不代表完整 review passed。
- Optional agent summary 有价值，但不能参与结构化裁决。Readiness、tiers、conflicts、coverage 和 stale 判断必须由代码产生。
- Triage report 必须绑定 source aggregate 和 design artifact，否则 retry、accept incomplete 或 design revision 后可能复用过期解释结果。

### Scope Decisions

包含：

- `DesignReviewTriageEngine`；
- deterministic finding clustering/deduplication；
- conflict detection；
- must-fix / should-fix / note classification；
- unresolved user question extraction；
- incomplete coverage summary；
- enhanced approval readiness report；
- user-facing deterministic summary；
- triage ledger layout；
- stale triage invalidation；
- optional summary-agent boundary。

排除：

- reviewer execution；
- reviewer retry / accept incomplete mechanics；
- design mutation / revision loop；
- approval automation；
- plan review。

## Proposed Solution

新增 workflow-owned `DesignReviewTriageEngine`，在 design review aggregate 写入后运行。它读取 version-bound aggregate、coverage、readiness、review run metadata 和 effective reviewer results，进行确定性 clustering、conflict detection、classification 和 readiness refinement，并写入 `triage-report.json`。Runtime/status/resume 后续优先展示 triage report 中的 user-facing summary、tiers、coverage summary 和 recommended next action。

核心原则：

```text
Reviewers produce findings.
Aggregator preserves normalized findings and coverage.
Triage explains and classifies findings.
Readiness advises but never approves.
Revision loop consumes triage; triage does not mutate design.
Deterministic code owns structured truth.
Optional agent summary may only rewrite prose.
```

### Architecture

```text
DesignReviewPanel / Retry Flow / Accept-Incomplete Flow
  ↓
DesignReviewAggregateResult + DesignReviewCoverage + DesignApprovalReadiness
  ↓
DesignReviewTriageEngine
  ├─ TriageSourceBinder
  ├─ FindingDeduplicator
  ├─ ConflictDetector
  ├─ TriageClassifier
  ├─ UnresolvedQuestionExtractor
  ├─ CoverageSummaryBuilder
  ├─ ReadinessReportBuilder
  ├─ UserFacingSummaryBuilder
  └─ TriageLedgerWriter
       ↓
.workflow/reviews/design/<review-run-id>/triage-report.json
.workflow/reviews/design/<review-run-id>/readiness.json
```

Suggested modules:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/triage.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/triage-deduplication.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/triage-conflicts.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/triage-classification.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/triage-readiness.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/triage-summary.ts
extensions/clarification-orchestrator/workflow/adapters/design-review/triage-ledger.ts
```

### Components

#### 1. `DesignReviewTriageEngine`

Responsibilities:

- Accept a review run, aggregate, readiness, coverage, and source ledger refs.
- Validate exact design binding.
- Validate aggregate/readiness/coverage consistency.
- Build finding clusters.
- Detect conflicts.
- Classify clusters into must-fix / should-fix / note.
- Build unresolved question summary.
- Build coverage-aware readiness report.
- Write triage ledger.
- Return result to panel/runtime for status/resume display.

Suggested input:

```ts
type DesignReviewTriageEngineInput = {
  reviewRun: DesignReviewRun;
  aggregate: DesignReviewAggregateResult;
  currentReadiness: DesignApprovalReadiness;
  coverage?: DesignReviewCoverage;
  sourceRefs: {
    aggregatePath: string;
    aggregateChecksum: string;
    coveragePath?: string;
    coverageChecksum?: string;
    reviewerResultRefs: string[];
  };
};
```

#### 2. `DesignReviewTriageReport`

Suggested canonical output:

```ts
type DesignReviewTriageReport = {
  reviewRunId: string;
  designRef: VersionedArtifactRef;
  sourceAggregateRef: string;
  sourceAggregateChecksum: string;
  sourceCoverageRef?: string;
  sourceCoverageChecksum?: string;
  generatedAt: string;
  status: "ready" | "blocked" | "incomplete" | "failed" | "skipped" | "stale";
  coverage?: DesignReviewCoverage;
  clusters: DesignReviewFindingCluster[];
  tiers: {
    mustFix: string[];
    shouldFix: string[];
    notes: string[];
  };
  conflicts: DesignReviewConflict[];
  unresolvedQuestions: DesignReviewUnresolvedQuestion[];
  readiness: DesignReviewReadinessReport;
  userFacingSummary: string;
};
```

#### 3. `DesignReviewFindingCluster`

A cluster groups findings that describe the same underlying issue.

```ts
type DesignReviewFindingCluster = {
  clusterId: string;
  findingIds: string[];
  category: DesignReviewFindingCategory;
  reviewers: DesignReviewerRole[];
  title: string;
  summary: string;
  severity: DesignReviewFindingSeverity;
  triageLevel: "must-fix" | "should-fix" | "note";
  requiresRevision: boolean;
  hasUserQuestion: boolean;
  affectedSections: string[];
  evidence: string[];
  recommendations: string[];
  confidence: "high" | "medium" | "low";
};
```

Rules:

- `clusterId` is generated by deterministic code.
- `findingIds` must reference existing aggregate findings.
- Source findings are never deleted or overwritten.
- If deduplication confidence is low, findings remain separate clusters.
- Cluster severity is the highest source severity: `blocking > non-blocking > note`.

#### 4. `FindingDeduplicator`

Responsibilities:

- Normalize title/description/recommendation tokens.
- Use category, affected sections, severity, `requiresRevision`, and `userQuestion` as merge signals.
- Merge high-confidence duplicate findings across reviewers.
- Preserve source finding ids and reviewers.

Conservative policy:

```text
high confidence duplicate → merge
medium/low confidence duplicate → keep separate unless exact affected section + category + strongly overlapping title tokens
unknown → do not merge
```

#### 5. `ConflictDetector`

Responsibilities:

- Detect severity disagreement on same/similar cluster.
- Detect incompatible recommendations.
- Detect scope disagreement, especially when one finding asks to expand scope and another asks to trim it.
- Detect readiness disagreement, e.g. one reviewer says ready while another raises gate/security blocker.

Suggested schema:

```ts
type DesignReviewConflict = {
  conflictId: string;
  findingIds: string[];
  type:
    | "recommendation-conflict"
    | "severity-disagreement"
    | "scope-disagreement"
    | "readiness-disagreement";
  summary: string;
  affectedSections: string[];
  impact:
    | "blocks-approval-readiness"
    | "should-resolve-before-revision"
    | "informational";
  suggestedResolution?: string;
};
```

High-risk conflicts involving security, path guards, artifact binding, approval gates, state authority, or stale artifacts should block readiness unless proven informational.

#### 6. `TriageClassifier`

Responsibilities:

- Assign each cluster to `must-fix`, `should-fix`, or `note`.
- Preserve blocking semantics.
- Promote high-risk non-blocking findings when they affect workflow safety.
- Keep optional polish as notes.

Classification rules:

```text
must-fix:
  - any source finding severity = blocking
  - requiresRevision=true and affects lifecycle gate, artifact binding, path/trust boundary, state authority, approval safety, or unrecoverable runtime behavior
  - unresolved user question changes scope, architecture, requirements, data model, or security assumptions
  - high-risk conflict blocks approval readiness

should-fix:
  - non-blocking requiresRevision=true but does not block approval
  - meaningful test coverage gap
  - consistency/context issue likely to improve planning quality
  - medium-risk conflict or ambiguity

note:
  - informational finding
  - optional polish
  - future enhancement
  - low-risk observation that should not block approval or revision loop
```

#### 7. `UnresolvedQuestionExtractor`

Responsibilities:

- Extract `userQuestion` fields from findings/clusters.
- Group duplicate questions.
- Classify whether each question blocks approval/readiness or can be deferred.

Suggested schema:

```ts
type DesignReviewUnresolvedQuestion = {
  questionId: string;
  findingIds: string[];
  question: string;
  blocksApprovalReadiness: boolean;
  reason: string;
};
```

#### 8. `CoverageSummaryBuilder`

Responsibilities:

- Summarize selected/unselected/succeeded/failed/pending retry reviewers.
- Explain incomplete coverage without treating unselected reviewers as failed.
- Preserve Spec 5.2 semantics: partial review is not passed; accept incomplete remains explicit.

Suggested readiness coverage shape:

```ts
type DesignReviewCoverageSummary = {
  selectedReviewers: FullDesignReviewerRole[];
  succeededReviewers: FullDesignReviewerRole[];
  failedReviewers: FullDesignReviewerRole[];
  unselectedReviewers: FullDesignReviewerRole[];
  pendingRetryReviewers: FullDesignReviewerRole[];
  incompleteCoverage: boolean;
  summary: string;
};
```

#### 9. `ReadinessReportBuilder`

Responsibilities:

- Convert triage + coverage + source readiness into enhanced readiness.
- Keep design approval separate.
- Produce recommended next action for status/resume.

Suggested schema:

```ts
type DesignReviewReadinessReport = {
  status:
    | "ready-for-user-approval"
    | "blocked"
    | "incomplete-review"
    | "failed"
    | "not-ready"
    | "skipped-by-user"
    | "stale";
  blockingClusterIds: string[];
  mustFixClusterIds: string[];
  shouldFixClusterIds: string[];
  noteClusterIds: string[];
  unresolvedQuestionIds: string[];
  conflictIds: string[];
  coverageSummary?: DesignReviewCoverageSummary;
  summary: string;
  recommendedNextAction:
    | "approve-design"
    | "retry-failed-reviewers"
    | "accept-incomplete-or-retry"
    | "revise-design"
    | "resolve-user-questions"
    | "rerun-review"
    | "inspect-failure";
};
```

Readiness rules:

```text
source readiness = skipped-by-user:
  → skipped-by-user, next action approve-design, with explicit skip caveat

source readiness = failed:
  → failed, next action inspect-failure or retry-failed-reviewers if coverage supports retry

source readiness = incomplete-review + no must-fix + no blocking conflicts:
  → incomplete-review, next action accept-incomplete-or-retry

source readiness = incomplete-review + must-fix/blocking conflict:
  → blocked, next action revise-design or retry-failed-reviewers depending on failure coverage

any must-fix cluster:
  → blocked, next action revise-design or resolve-user-questions

blocking unresolved user question:
  → blocked, next action resolve-user-questions

no must-fix + source passed:
  → ready-for-user-approval, next action approve-design
```

#### 10. `UserFacingSummaryBuilder`

Responsibilities:

- Generate deterministic human-readable summary from triage report.
- Mention must-fix count, should-fix count, note count, conflicts, unresolved questions, and coverage.
- Avoid suggesting approval when readiness is incomplete or blocked.

Optional future agent summary constraints:

- Input is deterministic triage report only.
- Output is prose only.
- It cannot change ids, tiers, readiness, coverage, conflicts, or next actions.
- If output attempts structural changes, reject and fallback to deterministic summary.

#### 11. `TriageLedgerWriter`

Responsibilities:

- Write `triage-report.json` under the design review run ledger.
- Update or replace `readiness.json` only with runtime-approved enhanced readiness shape or a backward-compatible embedded refinement.
- Use atomic writes and topic-scoped path checks.
- Store source aggregate/checksum binding.

Suggested layout:

```text
specs/<topic>/
  .workflow/
    reviews/
      design/
        <review-run-id>/
          review-run.json
          reviewer-results/
          coverage.json
          aggregated-findings.json
          readiness.json
          triage-report.json
          user-summary.md          optional, generated from triage only
```

### Data Flow

#### Normal passed review

```text
All selected reviewers succeed
  ↓
Basic aggregate has no blocking findings
  ↓
Triage clusters findings
  ↓
No must-fix / blocking conflict / blocking question
  ↓
readiness = ready-for-user-approval
  ↓
Runtime may enter or remain at awaiting-design-approval
  ↓
User still must explicitly approve design before planning
```

#### Blocking review

```text
Aggregate contains blocking finding(s)
  ↓
Triage classifies related clusters as must-fix
  ↓
Readiness report status = blocked
  ↓
Recommended next action = revise-design or resolve-user-questions
  ↓
Spec 5.4 can consume must-fix clusters to produce a revised design
```

#### Partial/incomplete review without blockers

```text
Some selected reviewers succeeded, some failed
  ↓
Aggregate includes findings from successful reviewers only
  ↓
Triage clusters successful findings
  ↓
No must-fix found
  ↓
Coverage summary records failed reviewers
  ↓
Readiness = incomplete-review
  ↓
Recommended next action = accept-incomplete-or-retry
  ↓
Accept incomplete remains a separate explicit Spec 5.2 gate
```

#### Partial review with blockers

```text
Some reviewers succeeded and at least one succeeded reviewer found blocking issue
  ↓
Triage classifies must-fix
  ↓
Readiness = blocked
  ↓
Accept incomplete action must remain unavailable
  ↓
User should revise design and/or retry failed reviewers depending on recovery state
```

#### Retry after partial review

```text
Failed reviewer retry updates effective reviewer results
  ↓
Aggregate/checksum changes
  ↓
Old triage source checksum no longer matches
  ↓
Old triage is stale
  ↓
Triage engine rebuilds report from latest aggregate/coverage
```

#### Design changed after review

```text
Triage report bound to design vN/checksum A
  ↓
Design artifact becomes vN+1/checksum B
  ↓
Old triage/readiness is stale
  ↓
Runtime must require new review decision/review/triage for latest design
```

## Error Handling

### 1. Missing or corrupted aggregate

If `aggregated-findings.json` is missing, unreadable, malformed, or inconsistent with review run metadata:

- do not build approval-ready triage;
- return triage status `failed`;
- readiness `failed` or `not-ready`;
- surface diagnostics through status/resume.

### 2. Source checksum mismatch

If the aggregate, coverage, reviewer results, or design ref checksum differs from the source refs stored in an existing triage report:

- mark existing triage as `stale`;
- do not reuse its readiness;
- rebuild triage from latest durable sources or require rerun/review decision if design changed.

### 3. Stale design artifact

If latest design artifact differs from triage `designRef`:

- readiness becomes `stale` or unusable;
- do not proceed to approval based on old triage;
- require a new design review decision for latest design.

### 4. Unsafe deduplication ambiguity

If two findings might be related but confidence is low:

- keep them as separate clusters;
- do not drop source findings;
- optionally mention possible overlap in summary only if deterministic.

### 5. Conflicting reviewer results

If findings conflict:

- record a `DesignReviewConflict`;
- do not silently choose one recommendation;
- block readiness when the conflict affects security, artifact binding, approval gate, state authority, or scope correctness.

### 6. Optional summary agent failure

If optional summary agent fails, times out, returns malformed output, or attempts to alter structured fields:

- reject agent summary;
- keep deterministic triage report;
- fallback to deterministic summary text;
- do not change readiness.

### 7. Ledger write failure

If `triage-report.json` or updated readiness cannot be written atomically:

- do not treat triage/readiness as durable;
- fail closed;
- keep previous effective review state unchanged.

### 8. Crafted triage or readiness spoofing

If crafted files claim blockers disappeared, coverage changed, stale design is current, or approval is allowed:

- validate against source aggregate, coverage, reviewer results, design checksum, and event/state data;
- fail closed on mismatch;
- never let triage files alone authorize state transitions.

## Testing

### Unit tests

Suggested locations:

```text
tests/unit/workflow/design-review-triage-deduplication.test.ts
tests/unit/workflow/design-review-triage-conflicts.test.ts
tests/unit/workflow/design-review-triage-classification.test.ts
tests/unit/workflow/design-review-triage-readiness.test.ts
tests/unit/workflow/design-review-triage-ledger.test.ts
```

Cases:

- duplicate findings across reviewers merge into one cluster with all source ids preserved;
- low-confidence similar findings are not merged;
- cluster severity uses highest source severity;
- blocking finding becomes must-fix;
- non-blocking `requiresRevision=true` gate/security/artifact issue becomes must-fix or should-fix according to risk;
- informational finding becomes note;
- duplicate user questions are grouped;
- blocking user question blocks readiness;
- severity disagreement creates conflict;
- incompatible recommendations create conflict;
- high-risk conflict blocks readiness;
- partial coverage creates incomplete coverage summary;
- incomplete review without must-fix stays `incomplete-review`, not `ready-for-user-approval`;
- partial review with must-fix becomes blocked;
- skipped review summary preserves explicit skip caveat;
- failed source readiness remains failed;
- deterministic summary does not suggest approval when blocked/incomplete;
- stale aggregate checksum invalidates old triage;
- stale design checksum invalidates old triage;
- triage ledger paths remain under review run directory.

### Integration tests

Suggested location:

```text
tests/integration/design-review-triage-and-readiness.test.ts
```

Cases:

- full review with no blockers writes triage report and reaches approval gate with readiness summary;
- full review with duplicate blockers writes one must-fix cluster and blocks approval readiness;
- full review with conflicting recommendations writes conflict summary;
- custom subset partial review writes coverage summary and incomplete readiness;
- partial review with blocking successful finding rejects accept-incomplete readiness;
- retry updates aggregate and rebuilds triage;
- design revision or artifact change makes previous triage stale.

### Security tests

Suggested location:

```text
tests/security/design-review-triage-and-readiness.test.ts
```

Cases:

- crafted triage report cannot spoof `designRef` or checksum;
- crafted triage report cannot hide blocking source findings;
- crafted readiness cannot mark incomplete review as approval-ready;
- crafted coverage cannot mark failed reviewer as succeeded;
- triage ledger path traversal is rejected;
- optional summary agent cannot mutate structured readiness;
- stale aggregate cannot be reused for latest design;
- triage report cannot approve design or start planning.

### Documentation alignment tests

Update docs tests if public README/workflow docs expose this behavior:

- review summary distinguishes must-fix, should-fix, notes;
- incomplete review remains incomplete even when no blockers are found;
- readiness is not approval;
- stale triage/readiness cannot be reused after design changes.

## Open Questions

1. Should Spec 5.3 update the existing `readiness.json` schema directly, or write enhanced readiness only inside `triage-report.json` while keeping current readiness backward-compatible? Recommended: write `triage-report.json` as the new source for enhanced readiness and keep `readiness.json` backward-compatible unless implementation complexity favors a schema bump.
2. Should deterministic deduplication use only simple token overlap or introduce a small local similarity heuristic? Recommended: start simple and conservative; false negatives are safer than false positives.
3. Should optional agent summary be included in the first implementation? Recommended: no. Start with deterministic summary; add agent summary only after tests prove structure cannot be influenced.
4. Should high-risk non-blocking security findings always become must-fix? Recommended: yes when they affect gate bypass, artifact binding, path traversal, state authority, or untrusted output handling.
5. Should unselected reviewers contribute to readiness risk? Recommended: show them in coverage summary but do not count them as failed. Only selected failed reviewers make review incomplete.
6. Should accepted incomplete review change triage readiness from `incomplete-review` to `ready-for-user-approval`? Recommended: no. Keep triage truthful as incomplete; runtime may separately record accept-incomplete and move to approval gate, while UI explains that approval is based on accepted incomplete coverage.
