# Plan Review Panel Design

## Summary

新增 **Plan Review Panel**，作为 planning 之后、plan approval 之前的自动文档校验阶段。它不复制 Design Review 的复杂交叉评审模型，而是固定执行三个只读 reviewer，并行校验已批准 `design.md` → `requirements.md` → `tasks.md` 的覆盖关系、任务完整性和执行顺序。若发现只需修改 plan 文档即可解决的 blocker，runtime 默认执行一次 automatic plan revision，仅允许修订 `requirements.md` 和 `tasks.md`，随后立即 re-review；无论首轮或修订后 review 通过，都必须停在显式 plan approval gate，不能自动进入 execution。

## Goals

- 用真实 `PlanReviewPanel` 替换当前 `plan-review.ts` placeholder。
- 将 plan review 定义为 planning 后由 runtime 自动执行的固定文档校验阶段，不再暴露 `skip | minimal | full` plan review mode。
- 绑定 exact artifact refs：已批准 `design.md`、当前 `requirements.md`、当前 `tasks.md` 的版本、路径和 checksum。
- 固定并行执行三个 reviewer：
  - `requirements-coverage-reviewer`；
  - `task-coverage-reviewer`；
  - `dependency-order-reviewer`。
- 校验 requirements 是否完整、忠实覆盖 approved design。
- 校验 tasks 是否完整覆盖 requirements，是否存在 missing task、orphan task、粒度问题或缺失测试/验证任务。
- 校验 task 顺序、依赖、checkpoint placement 和后续 controlled execution 的可执行性。
- 生成 deterministic aggregate 和 plan approval readiness report。
- 对 plan-level blocker 默认执行一次 automatic plan revision。
- 保证 automatic plan revision 只能修改 `requirements.md` 和 `tasks.md`，不能修改已批准 `design.md`。
- 修订后提交新版 requirements/tasks artifact versions，并立即重新执行 plan review。
- 保证 automatic revision 最多一次；re-review 后仍 blocked/failed 时停止并报告 blocker。
- 保证 plan review ready 不等于 plan approval；runtime 必须停在 explicit plan approval gate。
- 持久化 plan review ledger 和 plan revision ledger，支持 audit、status、resume 和未来 TUI 展示。

## Primary Users / Roles

- **Workflow user**：希望在批准 plan 进入 execution 前，确认 requirements/tasks 已忠实承接 approved design，且任务顺序可执行。
- **Brainstorming Pro maintainer**：需要把 plan review placeholder 替换为可测试、可恢复、可审计的 runtime-owned 文档校验阶段。
- **Spec planner / plan reviser agent**：根据结构化 findings 修订 requirements/tasks，但不能修改 design 或 approval。
- **Controlled SpecExec adapter**：依赖稳定、完整、有顺序的 `tasks.md` 作为 code-owned execution loop 输入。
- **Security / reliability reviewer**：需要确认 plan review 和 automatic revision 不能绕过 design approval、plan approval 或 execution boundary。

## Non-Goals

- 不实现 Spec 5 风格的 design deliberation 或复杂交叉评审。
- 不支持 plan review `skip | minimal | full` mode。
- 不支持用户选择 reviewer subset。
- 不支持 partial/incomplete accept。
- 不支持单 reviewer retry。
- 不支持多轮 automatic plan revision。
- 不实现五角色 full panel。
- 不实现 complex finding deduplication、conflict triage 或 advanced readiness。
- 不修改 approved `design.md`。
- 不自动 approve plan。
- 不进入 execution。
- 不执行 tasks。
- 不修改 project source files。
- 不实现 execution review panel。
- 不新增 public command surface。
- 不公开 generic subagent command/tool。
- 不实现 background async runner。

## Context

全局重构路线要求 `/brainstorm-pro` runtime-first：workflow state、artifact version、event log、review/approval gate 和 phase transition 都由代码强制。

相关前置 spec：

- Spec 1 `workflow-runtime-orchestrator` 定义 state machine、artifact store、event log、approval gate 和 adapter registry。
- Spec 3 `agent-execution-runtime` 定义受控 `runAgent()`、child Pi isolation、structured output validation、timeout/output limits 和 audit files。
- Spec 4 `skill-phase-adapters` 定义 `SpecPlanPhaseAdapter`，负责在 approved design 后生成 `requirements.md` 和 `tasks.md`。
- Spec 4.1 `controlled-spec-exec-adapter` 定义后续 execution 阶段如何解析 approved `tasks.md` 并按 code-owned task loop 执行。
- Spec 5 系列定义 design review 的多 agent 交叉评审模型；Spec 6 可复用 artifact binding、ledger、schema validation 和 finding normalization 的工程思路，但不继承 reviewer selection、partial retry、accept incomplete 或 complex triage 模型。

当前 `extensions/clarification-orchestrator/workflow/adapters/plan-review.ts` 是 placeholder：

- `full` 返回 unavailable；
- `skip` 返回 skipped；
- `minimal` 只校验外部传入状态；
- 没有真实 artifact binding、reviewer execution、finding schema、readiness、ledger 或 revision loop。

新的 plan review path 应为：

```text
DesignReview / DesignRevision completes
  ↓
User approves exact design version
  ↓
SpecPlanPhaseAdapter commits requirements.md + tasks.md
  ↓
Runtime automatically enters plan-review
  ↓
PlanReviewPanel validates approved design → requirements → tasks
  ↓
Optional automatic-once plan revision + re-review
  ↓
awaiting-plan-approval | blocked | failed
  ↓
User approves exact requirements/tasks versions
  ↓
Controlled SpecExecPhaseAdapter executes approved tasks
```

## Discovery

### Key Discoveries

- Plan review 和 design review 的性质不同。Design review 是需求/方案是否成立的交叉评审；plan review 是 approved design 到 requirements/tasks 的文档一致性与可执行性校验。
- 因为 design 已经被批准，plan reviewers 不应重新讨论需求方向，也不应扩大或缩小 approved scope。
- `requirements.md` 是 execution acceptance source of truth；如果它没有覆盖 approved design，后续 execution 即使稳定也会实现错目标。
- `tasks.md` 是 controlled execution 的操作计划；任务缺失、顺序错误、依赖不明或 checkpoint 放置不合理会直接破坏 execution 稳定性。
- Plan review 不需要用户选择 review mode。固定三 reviewer 足以覆盖核心风险，同时避免 Spec 6 膨胀成 Spec 5 的复制品。
- 三个 reviewer 是只读且互不依赖的文档校验角色，适合并行执行。
- Reviewer 不应直接修订文档。它们只输出 findings；修订由独立 `plan-reviser` 根据 aggregate findings 执行。
- 因为 plan revision 只修改 requirements/tasks，不重新定义 design，可以默认 automatic once；但必须限制次数、绑定 source artifacts，并在修订后重新 review。
- 如果 finding 需要 design revision，automatic plan revision 必须 fail closed，不能让 plan reviser 绕过 approved design。

### Scope Decisions

包含：

- `PlanReviewPanel`。
- Exact approved design / requirements / tasks artifact binding。
- Fixed three-reviewer registry。
- Parallel reviewer execution。
- Plan finding schema。
- Finding normalization。
- Deterministic aggregation。
- Plan approval readiness report。
- Plan review ledger。
- Automatic-once plan revision。
- Plan revision ledger。
- Post-revision re-review。
- Stale review detection。
- Runtime adapter integration。

排除：

- Plan review mode decision。
- Reviewer subset / selection。
- Partial accept。
- Per-reviewer retry。
- Multi-round revision loop。
- Design mutation。
- Plan approval automation。
- Execution。
- Complex triage。

## Proposed Solution

实现 workflow-owned `PlanReviewPanel`。`SpecPlanPhaseAdapter` 提交 `requirements.md` 和 `tasks.md` 后，runtime 不再暂停等待 plan review decision，而是自动进入 `plan-review` phase。`planReviewAdapter` 构造 `PlanReviewPanelRequest`，绑定 approved design ref、requirements ref 和 tasks ref。Panel 验证 binding 后创建 review run，并行执行三个固定 reviewer。Reviewer 输出结构化 findings；panel normalization 后进行 deterministic aggregation 和 readiness evaluation。

如果 readiness 为 `ready-for-plan-approval`，runtime 进入 `awaiting-plan-approval`。如果 readiness 为 `blocked-needs-plan-revision`，且当前 plan cycle 尚未使用 automatic revision，runtime 调用 `plan-reviser` 进行一次修订。Reviser 只允许输出新版 requirements/tasks；runtime 校验后提交新 artifact versions，标记旧 review stale，并对新版 plan 立即 re-review。若 re-review 通过，则进入 `awaiting-plan-approval`；若仍 blocked/failed，则停止在 `blocked` 或 `failed`，展示 findings 和 recovery hint。

核心原则：

```text
Plan review is document validation, not design deliberation.
Approved design is the source of truth.
Plan review always runs the same three reviewers.
Reviewers are read-only and run in parallel.
Findings do not mutate artifacts.
Plan-level blockers get one automatic requirements/tasks revision.
Plan revision cannot modify design.
Revision must be re-reviewed.
Ready does not mean approved.
```

### Architecture

```text
Workflow Runtime Orchestrator
  ├─ state machine
  ├─ artifact store
  ├─ event log
  ├─ design approval gate
  ├─ plan approval gate
  └─ planReviewAdapter
       ↓
PlanReviewPanel
  ├─ PlanArtifactBinder
  ├─ PlanShapeValidator
  ├─ FixedPlanReviewerRegistry
  ├─ ParallelPlanReviewerRunner
  │    ├─ requirements-coverage-reviewer
  │    ├─ task-coverage-reviewer
  │    └─ dependency-order-reviewer
  ├─ PlanFindingNormalizer
  ├─ PlanFindingAggregator
  ├─ PlanReadinessEvaluator
  ├─ PlanReviewLedgerWriter
  ├─ AutomaticPlanRevisionController
  └─ PlanRevisionLedgerWriter
       ↓
Agent Execution Runtime
  ├─ runAgent(role = requirements-coverage-reviewer)
  ├─ runAgent(role = task-coverage-reviewer)
  ├─ runAgent(role = dependency-order-reviewer)
  └─ runAgent(role = plan-reviser)
```

Suggested modules:

```text
extensions/clarification-orchestrator/workflow/adapters/plan-review/panel.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/artifact-binding.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/shape-validator.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/reviewer-registry.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/parallel-runner.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/schemas.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/finding-normalizer.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/aggregation.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/readiness.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/review-run-store.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/revision-controller.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/revision-ledger.ts
extensions/clarification-orchestrator/workflow/adapters/plan-review/prompts/*.ts
```

### Components

#### 1. `planReviewAdapter`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/plan-review.ts
```

Responsibilities:

- Replace placeholder plan review behavior.
- Run only from `plan-review` phase.
- Require `design`, `requirements`, and `tasks` artifacts.
- Verify design approval exists before review.
- Invoke `PlanReviewPanel`.
- Return structured `ReviewPhaseStatus` or equivalent runtime result.
- Let runtime commit state transition and events.

It must not:

- Ask user to choose plan review mode.
- Skip review implicitly.
- Approve plan.
- Execute tasks.
- Directly mutate `state.json` outside runtime commit path.

#### 2. `PlanArtifactBinder`

Responsibilities:

- Load approved design ref from `state.gates.design`.
- Load current requirements/tasks refs from `state.artifacts`.
- Validate all paths are topic-scoped.
- Validate checksums.
- Validate design approval binds the exact design ref.
- Create `PlanReviewArtifactBinding`.
- Detect stale review/revision sources.

Suggested type:

```ts
type PlanReviewArtifactBinding = {
  design: VersionedArtifactRef;
  requirements: VersionedArtifactRef;
  tasks: VersionedArtifactRef;
  designApproval: ApprovalRef;
};
```

#### 3. `PlanShapeValidator`

Responsibilities:

- Validate `requirements.md` exists and has expected sections.
- Validate `tasks.md` exists and has parseable task structure.
- Reuse `spec-exec/task-plan-parser.ts` where appropriate.
- Validate task checkbox markers and task numbering are stable enough for execution.
- Detect empty or malformed plan artifacts before invoking reviewer agents.

Shape validation can produce blocking findings such as:

- missing requirements section;
- missing tasks section;
- unparseable task list;
- missing required tasks;
- invalid checkbox format.

If shape validation fails severely, panel may return `failed` or `blocked-needs-plan-revision` without running all reviewers, depending on whether revision can safely repair the issue.

#### 4. `FixedPlanReviewerRegistry`

Responsibilities:

- Define the only supported plan reviewer roles.
- Provide role metadata, prompt builder, output schema, timeout and role policy.
- Ensure no runtime/user selection can alter the reviewer set.

Role type:

```ts
type PlanReviewerRole =
  | "requirements-coverage-reviewer"
  | "task-coverage-reviewer"
  | "dependency-order-reviewer";
```

The registry always returns all three roles.

#### 5. `requirements-coverage-reviewer`

Focus:

```text
approved design.md → requirements.md
```

Checks:

- Goals covered by requirements.
- Non-goals preserved without scope creep.
- Primary users / roles reflected in user goals or requirements.
- Context, constraints, assumptions and scope decisions captured.
- Error handling requirements captured when design calls for them.
- Testing expectations captured when design calls for them.
- Discovery / Key Discoveries / Scope Decisions not lost.
- Requirements do not introduce behavior outside approved design.

It may emit categories such as:

- `design-requirements-gap`;
- `scope-creep`;
- `ambiguity`;
- `missing-validation`;
- `requires-design-revision`.

#### 6. `task-coverage-reviewer`

Focus:

```text
requirements.md → tasks.md
```

Checks:

- Each requirement has one or more implementation/verification tasks.
- Each task traces to a requirement or approved support work.
- No orphan tasks introduce unapproved scope.
- Testing tasks exist for changed behavior.
- Security/path/state/ledger/doc tests exist when requirements imply them.
- Tasks are neither too broad nor too fragmented.
- Checkpoint/validation tasks cover key acceptance points.
- Tasks do not ask execution agent to revise approved design/requirements.

It may emit categories such as:

- `requirements-task-gap`;
- `orphan-task`;
- `missing-test`;
- `missing-validation`;
- `task-granularity`;
- `acceptance-criteria-gap`.

#### 7. `dependency-order-reviewer`

Focus:

```text
tasks.md internal execution order
```

Checks:

- Foundational types/schemas are created before consumers.
- Stores/writers/readers are created before callers.
- Runtime transitions are implemented before tests rely on them.
- Tests/checkpoints appear after required implementation tasks.
- No task depends on a later task.
- Checkpoints are placed at meaningful phase boundaries.
- The task structure is compatible with code-owned sequential execution.
- Execution risks such as missing prerequisites, unsafe ordering or circular dependencies are surfaced.

It may emit categories such as:

- `dependency-order`;
- `missing-prerequisite`;
- `checkpoint-placement`;
- `execution-risk`;
- `task-sequencing`.

#### 8. `ParallelPlanReviewerRunner`

Responsibilities:

- Run all three reviewers concurrently through `runAgent()`.
- Pass identical artifact binding and artifact contents to each reviewer.
- Enforce read-only role policy.
- Enforce `--no-session`, `--no-skills`, timeout and output limits via Agent Execution Runtime.
- Validate each reviewer output against schema.
- Persist each result under the review run directory.

Failure semantics:

- If any reviewer process fails, times out, or returns invalid output, the plan review run is `failed`.
- There is no partial accept and no per-reviewer retry in Spec 6.
- User/runtime may retry the entire plan review in a future recovery action, but not as part of this spec's normal automatic flow.

#### 9. `PlanReviewFinding` schema

Suggested type:

```ts
type PlanReviewFinding = {
  id: string;
  reviewerRole: PlanReviewerRole | "shape-validator";
  severity: "blocking" | "major" | "minor" | "note";
  category:
    | "design-requirements-gap"
    | "requirements-task-gap"
    | "dependency-order"
    | "task-granularity"
    | "missing-test"
    | "missing-validation"
    | "scope-creep"
    | "ambiguity"
    | "artifact-format"
    | "acceptance-criteria-gap"
    | "orphan-task"
    | "missing-prerequisite"
    | "checkpoint-placement"
    | "execution-risk"
    | "requires-design-revision";
  title: string;
  description: string;
  affectedArtifacts: Array<"design" | "requirements" | "tasks">;
  affectedSections: string[];
  recommendation: string;
  requiresPlanRevision: boolean;
  requiresDesignRevision: boolean;
  evidence?: Array<{
    artifact: "design" | "requirements" | "tasks";
    section?: string;
    quote?: string;
  }>;
};
```

Validation rules:

- `requiresDesignRevision=true` implies category `requires-design-revision` or a finding whose recommendation cannot be satisfied by requirements/tasks changes alone.
- `requiresDesignRevision=true` forbids automatic plan revision.
- `blocking` findings must include a concrete recommendation.
- Reviewer findings cannot contain approval directives, execution directives or artifact mutation instructions.

#### 10. `PlanFindingAggregator`

Responsibilities:

- Combine shape validation findings and reviewer findings.
- Preserve every source finding; no complex deduplication required in Spec 6.
- Count findings by severity and revision type.
- Produce a compact aggregate for readiness and status.

Suggested type:

```ts
type PlanReviewAggregate = {
  reviewRunId: string;
  artifactBinding: PlanReviewArtifactBinding;
  reviewerResults: Array<{
    role: PlanReviewerRole;
    status: "passed" | "blocked" | "failed";
    findingIds: string[];
  }>;
  findings: PlanReviewFinding[];
  counts: {
    blocking: number;
    major: number;
    minor: number;
    note: number;
    requiresPlanRevision: number;
    requiresDesignRevision: number;
  };
};
```

#### 11. `PlanReadinessEvaluator`

Responsibilities:

- Convert aggregate findings into deterministic readiness.
- Decide whether automatic plan revision is allowed.
- Decide whether runtime may enter plan approval gate.

Suggested type:

```ts
type PlanApprovalReadiness = {
  status:
    | "ready-for-plan-approval"
    | "blocked-needs-plan-revision"
    | "blocked-needs-design-revision"
    | "failed"
    | "stale";
  summary: string;
  blockingFindingIds: string[];
  planRevisionFindingIds: string[];
  designRevisionFindingIds: string[];
  automaticRevisionAllowed: boolean;
};
```

Rules:

- Any `requiresDesignRevision=true` finding → `blocked-needs-design-revision`.
- Any blocking finding requiring plan revision → `blocked-needs-plan-revision`.
- Reviewer/process/schema failure → `failed`.
- Artifact mismatch or changed source artifacts → `stale`.
- No blocking findings and all required reviewers passed → `ready-for-plan-approval`.

Major findings may either block or remain advisory depending on category. Spec 6 should start conservative: `major` findings with `requiresPlanRevision=true` block approval readiness.

#### 12. `PlanReviewLedgerWriter`

Review ledger path:

```text
specs/<topic>/.workflow/reviews/plan/<review-run-id>/
  metadata.json
  artifact-binding.json
  reviewer-results/
    requirements-coverage-reviewer.json
    task-coverage-reviewer.json
    dependency-order-reviewer.json
  findings.json
  aggregate.json
  readiness.json
  events.jsonl
```

Responsibilities:

- Persist review metadata and artifact binding before reviewer execution.
- Persist each reviewer result independently.
- Persist normalized findings, aggregate and readiness.
- Link events to workflow event log where applicable.
- Support status/resume reading.

#### 13. `AutomaticPlanRevisionController`

Responsibilities:

- Trigger automatic revision only when readiness is `blocked-needs-plan-revision`.
- Verify no finding requires design revision.
- Verify automatic revision has not already been used for the current plan cycle.
- Build a `plan-reviser` request from approved design, current requirements/tasks and aggregate findings.
- Run `plan-reviser` through Agent Execution Runtime.
- Validate revised requirements/tasks output.
- Reject output that mutates design, approval, review decisions, workflow state or source files.
- Ask runtime to commit new requirements/tasks artifact versions.
- Mark previous review stale by source binding.
- Immediately trigger one post-revision plan review.

Policy:

```ts
type PlanRevisionPolicy = {
  mode: "automatic-once";
  maxAutomaticAttempts: 1;
};
```

#### 14. `plan-reviser`

Input:

- Approved design content and ref.
- Current requirements/tasks content and refs.
- Plan review aggregate findings.
- Readiness report.

Output:

```ts
type PlanRevisionAgentOutput = {
  status: "revised" | "blocked" | "failed";
  revisedRequirements?: string;
  revisedTasks?: string;
  addressedFindingIds: string[];
  unresolvedFindingIds: string[];
  summary: string;
  blocker?: {
    reason: string;
    requiresDesignRevision: boolean;
  };
};
```

Restrictions:

- Must not modify design.
- Must not approve plan.
- Must not execute tasks.
- Must not update task checkboxes as execution progress.
- Must not add scope outside approved design.
- Must not remove constraints from approved design.
- Must not claim workflow state changed.

#### 15. `PlanRevisionLedgerWriter`

Revision ledger path:

```text
specs/<topic>/.workflow/revisions/plan/<revision-id>/
  policy.json
  source-review.json
  source-artifacts.json
  aggregate-findings.json
  reviser-output.json
  committed-artifacts.json
  post-revision-review.json
```

Responsibilities:

- Persist automatic-once policy.
- Bind revision to source review run and source artifact checksums.
- Persist reviser output.
- Persist committed artifact refs.
- Link post-revision review run.

### Data Flow

#### Primary happy path

```text
1. User approves exact design version.
2. Runtime enters planning.
3. SpecPlanPhaseAdapter commits requirements.md v1 and tasks.md v1.
4. Runtime automatically enters plan-review.
5. PlanArtifactBinder binds approved design vN + requirements v1 + tasks v1.
6. PlanShapeValidator validates basic structure.
7. ParallelPlanReviewerRunner runs all three reviewers concurrently.
8. Findings are normalized and aggregated.
9. PlanReadinessEvaluator returns ready-for-plan-approval.
10. Runtime records review status and events.
11. Runtime enters awaiting-plan-approval.
12. User explicitly approves requirements/tasks.
13. Runtime enters executing.
```

#### Automatic revision path

```text
1. Initial plan review returns blocked-needs-plan-revision.
2. Runtime verifies automatic revision has not been used.
3. AutomaticPlanRevisionController invokes plan-reviser.
4. Plan-reviser outputs revised requirements/tasks.
5. Runtime validates and commits requirements.md v2 and tasks.md v2.
6. Source review run becomes stale for approval purposes.
7. Runtime immediately runs plan review again on design vN + requirements v2 + tasks v2.
8. If ready, runtime enters awaiting-plan-approval.
9. If still blocked/failed, runtime stops in blocked/failed and reports findings.
```

#### Design-level blocker path

```text
1. Reviewer emits requiresDesignRevision=true.
2. Readiness becomes blocked-needs-design-revision.
3. Automatic plan revision is not allowed.
4. Runtime stops blocked and surfaces handoff to design-level recovery.
5. Requirements/tasks are not automatically changed.
```

## Error Handling

- **Missing design approval**: fail closed; plan review cannot run before design approval.
- **Missing requirements/tasks**: failed or blocked depending on whether artifacts are absent or malformed.
- **Checksum mismatch**: mark stale/failed and refuse review reuse.
- **Artifact path escapes topic**: security failure.
- **Tasks unparseable**: produce artifact-format finding or fail if unsafe to revise.
- **Reviewer timeout/failure**: review run failed; no partial accept.
- **Reviewer invalid JSON/schema**: review run failed; output is not trusted.
- **Reviewer attempts to approve, execute or mutate artifacts**: schema/policy violation, review failed.
- **Finding requires design revision**: automatic plan revision blocked; runtime reports design-level blocker.
- **Plan reviser modifies design**: reject output and fail closed.
- **Plan reviser omits requirements or tasks**: revision failed.
- **Plan reviser updates task checkboxes as progress**: reject output; planning artifacts must not contain execution progress mutations.
- **Automatic revision already used**: do not run another revision; stop blocked.
- **Post-revision review still blocked**: stop blocked; no further automatic loop.
- **Ready review becomes stale before approval**: approval rejected; rerun plan review on current artifacts.

## Testing

### Unit tests

Suggested files:

```text
tests/unit/workflow/plan-review-artifact-binding.test.ts
tests/unit/workflow/plan-review-shape-validator.test.ts
tests/unit/workflow/plan-review-reviewer-registry.test.ts
tests/unit/workflow/plan-review-parallel-runner.test.ts
tests/unit/workflow/plan-review-schema-validation.test.ts
tests/unit/workflow/plan-review-finding-normalizer.test.ts
tests/unit/workflow/plan-review-aggregation.test.ts
tests/unit/workflow/plan-review-readiness.test.ts
tests/unit/workflow/plan-review-ledger.test.ts
tests/unit/workflow/plan-revision-controller.test.ts
tests/unit/workflow/plan-revision-ledger.test.ts
```

Critical cases:

- Binds approved design + requirements + tasks exact versions.
- Rejects missing design approval.
- Rejects checksum mismatch and path traversal.
- Registry always returns exactly three reviewers.
- No plan review mode is exposed or accepted.
- Parallel runner executes all reviewers and fails on any reviewer failure.
- Invalid reviewer output is rejected.
- `requiresDesignRevision=true` blocks automatic plan revision.
- Plan-level blocking findings allow automatic revision only once.
- Revised requirements/tasks commit creates new artifact versions.
- Old review becomes stale after revision.
- Re-review is required before plan approval.

### Integration tests

Suggested files:

```text
tests/integration/plan-review-automatic-flow.test.ts
tests/integration/plan-review-automatic-revision-flow.test.ts
tests/integration/plan-review-design-blocker-flow.test.ts
tests/integration/plan-review-stale-approval-flow.test.ts
```

Critical flows:

- planning → automatic plan review → awaiting plan approval.
- planning → automatic plan review blocked → automatic revision → re-review → awaiting plan approval.
- planning → automatic plan review blocked → automatic revision → re-review still blocked → blocked.
- design-level blocker prevents plan revision.
- plan approval cannot happen with stale review/artifacts.
- execution cannot start before automatic plan review and plan approval.

### Security tests

Suggested files:

```text
tests/security/plan-review-trust-boundary.test.ts
tests/security/plan-review-path-guard.test.ts
tests/security/plan-revision-no-design-mutation.test.ts
tests/security/plan-review-no-approval-forgery.test.ts
```

Critical cases:

- Reviewer cannot mutate artifacts or workflow state.
- Reviewer cannot forge approval.
- Plan reviser cannot modify approved design.
- Plan reviser cannot enter execution.
- Crafted readiness cannot bypass plan approval gate.
- External artifact refs are rejected.
- Stale review cannot be reused after artifact change.

## Open Questions

- Should `PlanShapeValidator` failure always attempt automatic plan revision, or should severely malformed `tasks.md` fail without invoking `plan-reviser`?
- Should `major` findings with `requiresPlanRevision=true` always block readiness, or should some categories remain advisory?
- Should automatic plan revision be scoped per initial plan artifact pair or per workflow run if planning is re-run manually in future recovery flows?
- Should plan review reuse design-review ledger helpers directly, or keep a separate plan-specific implementation with shared low-level utilities only?
