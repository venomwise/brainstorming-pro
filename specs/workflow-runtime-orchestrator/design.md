# Workflow Runtime Orchestrator 设计

## Summary

新增一个 **Workflow Runtime Orchestrator**，作为 Brainstorming Pro 的顶层流程引擎。它用持久化状态机串联 `brainstorming`、`spec-plan`、`spec-exec` 三个成熟能力，并通过 artifact store、event log、approval gates 和 phase adapter 接口确保复杂需求可以被自动推进、恢复、审计和安全暂停。目标是减少用户在需求澄清、任务规划和稳定执行之间手动充当“胶水”的成本，同时为后续多 Agent 交叉评审设计预留稳定架构。

## Goals

- 提供统一 workflow runtime，减少用户手动串联 `brainstorming`、`spec-plan`、`spec-exec` 的负担。
- 将生命周期从 prompt 约定改为代码强制状态机。
- 在 review mode decision、`design approval` 和 `plan approval` 等用户决策点自动暂停等待用户选择或确认。
- 通过统一 `--resume` 入口驱动恢复、选择 review 深度和 approval，降低用户命令记忆成本。
- 为后续 multi-agent review panel 提供稳定插槽。
- 所有关键产物版本化并可恢复：
  - `design.md`
  - `requirements.md`
  - `tasks.md`
  - reviews
  - approvals
  - decisions
- 支持 workflow start / resume / status；`resume` 根据持久化状态展示下一步可选操作。
- 保持 phase adapter 与底层 agent runtime 解耦。
- 保持后续可扩展性，使 design review、plan review、execution review 能作为独立阶段逐步增强。

## Primary Users / Roles

- **Workflow user**：提出复杂需求，希望系统自动完成需求澄清、设计产出、计划生成和稳定执行，只在关键审批点介入。
- **Brainstorming Pro maintainer**：需要一个可测试、可恢复、可扩展的 workflow runtime，避免流程逻辑散落在多个 slash command 或 prompt 中。
- **Security / reliability reviewer**：需要确认 planning 和 execution 不能绕过用户审批，产物变更可追溯，状态损坏时能 fail closed。
- **Future review-panel implementer**：需要稳定的 phase adapter 和 artifact/event 接口，以便后续加入多 Agent 交叉评审、triage 和 revision loop。

## Non-Goals

- 不实现完整 multi-agent review panel。
- 不设计 reviewer 角色 prompt。
- 不实现 review triage / revision loop 的详细策略。
- 不实现通用 public `subagent` tool。
- 不实现 background async runner。
- 不自动跳过用户 approval。
- 不直接重写 `brainstorming`、`spec-plan`、`spec-exec` skill 内部逻辑。
- 不完整实现 execution diff review。
- 不承诺完全兼容现有 artifact layout；这是一次新架构设计，可以采用更适合长期维护的布局。

## Context

Brainstorming Pro 当前公开生命周期是：

```text
/clarify <request> -> /spec-plan <topic> -> /spec-exec <topic>
```

现有能力已经可以围绕需求澄清、计划生成和执行建立 durable artifacts，但对复杂需求来说，用户仍然需要手动承担大量流程粘合工作：

1. 启动 brainstorming / clarify。
2. 判断 `design.md` 是否足够完整。
3. 手动拉起多个 agent review design。
4. 整理 review 意见和冲突。
5. 修订 design。
6. 手动运行 spec-plan。
7. 手动运行 spec-exec。
8. 在阶段之间维护上下文、产物版本和审批边界。

全新重构的核心目标不是保留 slash command 串联形态，而是建立一个由代码强制的 workflow runtime：

```text
User / Parent LLM
  ↓
Workflow Command / Tool Interface
  ↓
Workflow Runtime Orchestrator
  ├─ State Machine
  ├─ Gate Manager
  ├─ Artifact Store
  ├─ Event Log
  ├─ Phase Adapter Registry
  └─ Status / Resume Engine
      ↓
Phase Adapters
  ├─ Brainstorming Adapter
  ├─ Spec Plan Adapter
  ├─ Spec Exec Adapter
  ├─ Design Review Adapter placeholder
  ├─ Plan Review Adapter placeholder
  └─ Execution Review Adapter placeholder
      ↓
Agent Execution Runtime / Existing Skills
```

关键架构原则：

```text
Workflow Runtime owns state.
Phase adapters produce outputs.
Approval gates are explicit.
Artifacts are versioned.
Events are append-only.
```

## Discovery

### Key Discoveries

- 项目的核心价值不是单独提供 `/clarify`、`/spec-plan`、`/spec-exec`，而是稳定地组织多 Agent 对复杂需求进行澄清、评审、规划、执行和验证。
- 现有 `brainstorming`、`spec-plan`、`spec-exec` 三个 skill 已经是成熟能力，主要缺口是缺少可靠的 workflow runtime 来自动串联和强制边界。
- 对复杂需求，用户最重的负担是手动启动多个 agent 反复验证 `design.md`，并维护 design、requirements、tasks 之间的上下文一致性。
- 从鲁棒性角度，不能依赖父 LLM 通过 prompt 自觉遵循 `/clarify -> /spec-plan -> /spec-exec`。状态迁移必须由代码强制。
- Approval gate 必须保留人类确认，尤其是进入 planning 前的 design approval 和进入 execution 前的 plan approval。
- Review 深度也应由用户在看到第一版 artifact 后决定：`skip`、`minimal` 或未来的 `full`，且选择必须记录到 state/events。
- Multi-agent review panel 是高价值能力，但应建立在状态机、artifact store、event log 和 phase adapter 基础设施之上，不应作为第一步直接实现。

### Scope Decisions

包含：

- Workflow state machine。
- Design review decision、plan review decision、design approval 和 plan approval 等强制用户决策 gate。
- Artifact versioning。
- Append-only event log。
- Phase adapter interface。
- Workflow start / resume / status 交互模型。
- Design review / plan review / execution review 的 lifecycle 插槽和 placeholder adapter。
- State corruption、artifact missing、invalid transition、approval mismatch 等错误处理原则。

排除：

- 完整多 Agent review panel。
- Reviewer roles、prompt、并发、triage、revision loop。
- 通用 subagent tool。
- Background async execution。
- 自动审批。
- 完整 execution review。

## Proposed Solution

引入 `Workflow Runtime Orchestrator` 作为 Brainstorming Pro 顶层流程引擎。用户通过统一入口开始 workflow，并通过 `--resume` 恢复、选择 review 深度、批准 artifact 或处理阻塞；runtime 根据持久化状态机决定下一步可执行阶段和需要展示的用户决策，并调用对应 phase adapter。每个 adapter 只负责读取指定输入、生成结构化输出并提交 artifact；状态迁移、gate enforcement、event append 和 artifact versioning 由 runtime 统一处理。

主路径：

```text
intake
  → designing
  → awaiting-design-review-decision
  → design-review | awaiting-design-approval
  → awaiting-design-approval
  → planning
  → awaiting-plan-review-decision
  → plan-review | awaiting-plan-approval
  → awaiting-plan-approval
  → executing
  → execution-review
  → done
```

用户交互采用以下模式：

```text
全自动推进非决策阶段，但在 review mode decision、design approval 和 plan approval 等用户决策点暂停。
用户只需要通过 /brainstorm-pro --resume 回到 workflow，runtime 根据当前状态展示下一步可选操作。
```

也就是：

- design 生成后先停止在 `awaiting-design-review-decision`，让用户审阅第一版 `design.md` 并选择 `skip`、`minimal` 或未来的 `full` review。
- 如果用户选择 `skip`，runtime 显式记录 user-selected skip 并进入 `awaiting-design-approval`；如果选择 `minimal` 或 `full`，runtime 进入 `design-review` 并在 review 完成后进入 `awaiting-design-approval`。
- 用户批准 design 后，自动进入 planning。
- planning artifacts 生成后先停止在 `awaiting-plan-review-decision`，让用户审阅 `requirements.md` / `tasks.md` 并选择 plan review 深度。
- plan review 被显式跳过或完成后，停止在 `awaiting-plan-approval`。
- 用户批准 plan 后，自动进入 execution。

### Persisted Runtime Layout

当前实现新增的 runtime layout：

```text
specs/<topic>/
  design.md
  requirements.md
  tasks.md
  .workflow/
    events.jsonl
    artifacts/
      design/v<N>.md
      requirements/v<N>.md
      tasks/v<N>.md
    decisions/
      <target>-<timestamp>.json
    approvals/
      design-approval.json
      plan-approval.json
    runs/<run-id>/
      state.json
```

`VersionedArtifactRef` 使用相对路径、version、kind、createdAt 和 SHA-256 checksum 绑定精确产物版本。`decisions/` 和 `approvals/` 中的记录必须引用当前 topic 内的 versioned artifact；若缺失、为空、路径逃逸或 checksum mismatch，runtime fail closed。

### Architecture

核心模块：

```text
Workflow Runtime Orchestrator
  ├─ Workflow Command / Tool Interface
  ├─ State Machine
  ├─ Gate Manager
  ├─ Artifact Store
  ├─ Event Log
  ├─ Phase Adapter Registry
  ├─ Status / Resume Engine
  └─ Error Boundary
```

#### Workflow Command / Tool Interface

第一版以极少命令提供主路径，避免用户学习多个细粒度动作。当前实现的用户入口是：

```text
/brainstorm-pro "<request>" --topic <english-kebab-case-topic>
/brainstorm-pro --resume [topic]
/brainstorm-pro --status [topic]
```

`--topic` 是第一版 start path 的显式安全边界；后续 topic proposal 可以继续复用现有 `/clarify` 能力或接入 runtime。所有 runtime 文件写入 `specs/<topic>/` 下，topic 必须通过 English kebab-case 校验。

`--resume` 是状态感知入口。它会：

- 如果存在多个可恢复 workflow，让用户选择要恢复的 topic。
- 根据当前 `state.phase` 展示下一步可选操作，例如选择 review mode、批准 artifact、请求 revision、重试 failed phase 或查看 blocker。
- 自动推进非 gate phase，例如 designing、review、planning、execution。
- 在任何用户决策 gate 处暂停，不能静默 approve 或跳过。

后续可以扩展为 Pi tool。当前代码保留 narrow typed hook，但不注册 public tool：

```ts
brainstorming_pro({
  action: "start" | "resume" | "status",
  topic?: string,
  request?: string,
  decision?: RuntimeUserDecision
})
```

命令或 tool 只表达用户意图，不直接跳过 runtime 的状态检查。`approve`、`review --mode` 等细粒度动作只能通过 state-aware resume 路径进入，不能绕过 review decision gate 或 approval gate。

#### State Machine

建议状态类型：

```ts
type WorkflowPhase =
  | "intake"
  | "designing"
  | "awaiting-design-review-decision"
  | "design-review"
  | "awaiting-design-approval"
  | "planning"
  | "awaiting-plan-review-decision"
  | "plan-review"
  | "awaiting-plan-approval"
  | "executing"
  | "execution-review"
  | "done"
  | "blocked"
  | "failed";
```

主路径：

```text
intake
  → designing
  → awaiting-design-review-decision
  → design-review | awaiting-design-approval
  → awaiting-design-approval
  → planning
  → awaiting-plan-review-decision
  → plan-review | awaiting-plan-approval
  → awaiting-plan-approval
  → executing
  → execution-review
  → done
```

阻塞路径：

```text
any phase
  → blocked
```

失败路径：

```text
any phase
  → failed
```

恢复路径：

```text
blocked / failed / awaiting-* / active phase
  → resume
```

`resume` 根据当前状态执行确定性行为：active phase 可继续运行；`awaiting-*` phase 必须展示用户选择；`blocked` / `failed` phase 必须展示诊断和恢复选项。

#### Gate Manager

Gate manager 负责审批约束。

Review Decision Gate：进入 review 或显式跳过 review 前必须满足：

```text
latest candidate artifact exists
AND user selected review mode for exact latest artifact version
AND review mode is one of: skip | minimal | full
```

第一版 `full` 可以返回 unavailable，并要求用户重新选择 `skip` 或 `minimal`；不能静默降级。

Design Approval Gate：进入 planning 前必须满足：

```text
latest design artifact exists
AND user selected design review mode for exact latest design version
AND selected review mode is completed or explicitly skipped by user decision
AND user approved latest design version
```

Plan Approval Gate：进入 execution 前必须满足：

```text
latest requirements artifact exists
AND latest tasks artifact exists
AND user selected plan review mode for exact latest requirements/tasks versions
AND selected review mode is completed or explicitly skipped by user decision
AND user approved latest requirements/tasks versions
```

任何 phase adapter 或父 LLM 都不能绕过 gate。

#### Artifact Store

Artifact store 负责：

- 写入 versioned artifact。
- 维护顶层 mirror file。
- 校验 artifact ref 是否位于当前 topic 目录内。
- 校验 approval 引用的 artifact version 是否仍是当前候选版本。
- 在缺失或损坏时 fail closed。

建议布局：

```text
specs/<topic>/
  design.md
  requirements.md
  tasks.md

  .workflow/
    state.json
    events.jsonl

    artifacts/
      design/
        v1.md
        v2.md
      requirements/
        v1.md
      tasks/
        v1.md

    reviews/
      design/
        round-1/
          summary.md
          review.json
      plan/
        round-1/
      execution/
        round-1/

    approvals/
      design-approval.json
      plan-approval.json

    decisions/
      decision-001.md

    runs/
      run-YYYYMMDD-HHMMSS/
        log.md
        phase-results.json
```

顶层文件语义：

```text
design.md        = latest candidate or approved design mirror
requirements.md  = latest candidate or approved requirements mirror
tasks.md         = latest candidate or approved tasks mirror
```

`.workflow/artifacts/*/vN.md` 是版本化历史。

#### Event Log

`events.jsonl` 是 append-only。示例：

```json
{"type":"workflow.started","topic":"multi-tenant-auth","at":"..."}
{"type":"phase.started","phase":"designing","at":"..."}
{"type":"artifact.created","kind":"design","version":"v1","path":"...","at":"..."}
{"type":"phase.completed","phase":"designing","at":"..."}
{"type":"gate.awaiting-approval","gate":"design","artifactVersion":"v1","at":"..."}
{"type":"gate.approved","gate":"design","artifactVersion":"v1","at":"..."}
{"type":"phase.started","phase":"planning","at":"..."}
```

用途：

- resume。
- audit。
- debugging。
- 后续 TUI/status 展示。
- 判断 workflow 为什么停在当前状态。

#### Phase Adapter Registry

Runtime 不直接嵌入每个 skill 的实现，而是通过 adapter 调用 phase。

统一接口建议：

```ts
type PhaseAdapter<Input, Output> = {
  name: string;
  allowedFrom: WorkflowPhase[];
  requiredArtifacts: ArtifactRequirement[];
  run(input: Input, context: WorkflowContext): Promise<Output>;
  validate(output: unknown): Output;
  commit(output: Output, context: WorkflowContext): Promise<CommitResult>;
};
```

第一批 adapter：

```text
BrainstormingPhaseAdapter
SpecPlanPhaseAdapter
SpecExecPhaseAdapter
DesignReviewPhaseAdapter
PlanReviewPhaseAdapter
ExecutionReviewPhaseAdapter
```

本 spec 中，review adapters 可以先实现为用户可选择的 `skip` 或 `minimal`：

```text
skip:
  reviewStatus = "skipped"
  reason = "user-selected-skip"

minimal:
  reviewStatus = "passed" | "blocked" | "failed"
  mode = "minimal"
```

`skip` 不是隐式 no-op，必须由用户在 `--resume` 的 review decision 菜单中选择，并绑定当前 artifact version。`minimal` 至少应校验 artifact 存在、非空、路径安全、版本/checksum 一致；是否检查必需章节可由第一版实现决定。`full` 是后续 multi-agent review panel 的插槽；如果第一版未实现，应明确提示 unavailable，不能静默降级为 minimal 或 skip。

状态机位置必须保留，避免后续加入多 Agent review 时再次重构主生命周期。

### Components

#### `workflow/types.ts`

定义核心类型：

```ts
type WorkflowState = {
  version: 1;
  topic: string;
  request: string;
  phase: WorkflowPhase;
  createdAt: string;
  updatedAt: string;

  artifacts: {
    design?: VersionedArtifactRef;
    requirements?: VersionedArtifactRef;
    tasks?: VersionedArtifactRef;
  };

  gates: {
    designApproval?: ApprovalRef;
    planApproval?: ApprovalRef;
  };

  reviewDecisions: {
    design?: ReviewDecisionRef;
    plan?: ReviewDecisionRef;
    execution?: ReviewDecisionRef;
  };

  reviewStatus: {
    design?: ReviewPhaseStatus;
    plan?: ReviewPhaseStatus;
    execution?: ReviewPhaseStatus;
  };

  pendingUserDecision?: UserDecisionRequest;

  lastError?: WorkflowErrorSnapshot;
};
```

补充类型：

```ts
type VersionedArtifactRef = {
  kind: "design" | "requirements" | "tasks";
  version: string;
  path: string;
  mirrorPath: string;
  createdAt: string;
  checksum?: string;
};

type ApprovalRef = {
  gate: "design" | "plan";
  approvedAt: string;
  approvedBy: "user";
  artifactVersions: Record<string, string>;
  path: string;
};

type ReviewMode = "skip" | "minimal" | "full";

type ReviewDecisionRef = {
  target: "design" | "plan" | "execution";
  mode: ReviewMode;
  selectedAt: string;
  selectedBy: "user";
  artifactVersions: Record<string, string>;
  path: string;
};

type ReviewPhaseStatus = {
  status: "pending" | "passed" | "skipped" | "blocked" | "failed";
  mode?: ReviewMode;
  reason?: string;
  round?: number;
  summaryPath?: string;
};
```

#### `workflow/state-machine.ts`

职责：

- 定义合法 transition table。
- 拒绝非法状态迁移。
- 提供 `canTransition()` / `transition()`。
- 保证任何 phase adapter 都不能直接更改状态。

示例规则：

```text
awaiting-design-review-decision -> design-review              only if user selected minimal/full for latest design version
awaiting-design-review-decision -> awaiting-design-approval   only if user selected skip for latest design version
awaiting-design-approval        -> planning                   only if design gate approved
awaiting-plan-review-decision   -> plan-review                only if user selected minimal/full for latest requirements/tasks versions
awaiting-plan-review-decision   -> awaiting-plan-approval     only if user selected skip for latest requirements/tasks versions
awaiting-plan-approval          -> executing                  only if plan gate approved
planning                        -> executing rejected
executing                       -> planning rejected unless explicit recovery flow exists
```

#### `workflow/gates.ts`

职责：

- 校验 design approval。
- 校验 plan approval。
- 写入 approval artifact。
- 检查 approval 是否匹配当前 artifact version。
- 检查审批前置条件是否满足。

#### `workflow/artifact-store.ts`

职责：

- 创建 topic workflow 目录。
- 写入 versioned artifacts。
- 更新顶层 mirror。
- 读取 latest artifact。
- 校验 artifact path 安全性。
- 处理缺失文件、损坏引用和 checksum mismatch。

#### `workflow/events.ts`

职责：

- append JSONL events。
- 提供 typed event writer。
- 确保 event append failure 不会造成 state 与 artifacts 静默不一致。

#### `workflow/runtime.ts`

职责：

- `startWorkflow(request)`。
- `resumeWorkflow(topic?)`。
- `getStatus(topic?)`。
- 发现多个 resumable workflow 时请求用户选择。
- 根据当前 phase 展示 review decision、approval、revision、retry 等用户选项。
- 记录用户选择，例如 review mode decision 或 approval。
- 根据当前 phase 调用 adapter。
- 统一捕获 phase error。
- 统一写 state/event。

#### `workflow/adapters/*.ts`

职责：

- 将已有 skill 或 command 能力包装成 phase。
- 声明输入 artifact 和输出 artifact。
- 进行 output schema validation。
- 返回 commit result，不直接推进 gate。

### Data Flow

#### Start

```text
User runs /brainstorm-pro "<request>"
  ↓
validate request
  ↓
propose/derive topic
  ↓
create specs/<topic>/.workflow/state.json
  ↓
append workflow.started
  ↓
enter designing
```

#### Designing

```text
Workflow Runtime
  ↓
BrainstormingPhaseAdapter
  ↓
produce design v1
  ↓
write specs/<topic>/.workflow/artifacts/design/v1.md
  ↓
mirror to specs/<topic>/design.md
  ↓
enter awaiting-design-review-decision
```

#### Awaiting Design Review Decision

System stops and shows this through `/brainstorm-pro --resume`:

```text
Design draft is ready:
- specs/<topic>/design.md
- version: v1

Choose design review mode:
1. skip    - You manually inspect the design; automated review is explicitly skipped.
2. minimal - Run lightweight artifact/content validation.
3. full    - Run multi-agent design review when available.
4. revise  - Provide feedback and produce a new design version before review.
```

The selected mode is recorded for the exact design version. If user chooses `skip`, runtime records `reviewStatus.design.status = "skipped"` with `reason = "user-selected-skip"` and enters `awaiting-design-approval`. If user chooses `minimal`, runtime enters `design-review`. If user chooses `full` and full review is unavailable, runtime stays in the decision state and asks the user to choose another available mode.

#### Design Review

```text
Workflow Runtime
  ↓
DesignReviewPhaseAdapter(mode = minimal | full)
  ↓
validate/review design according to selected mode
  ↓
write review summary/status
  ↓
enter awaiting-design-approval when passed, or blocked/failed when not ready
```

#### Awaiting Design Approval

System stops and shows this through `/brainstorm-pro --resume`:

```text
Design is ready for approval:
- specs/<topic>/design.md
- version: v1
- review mode/status: skip/skipped or minimal/passed

Choose next action:
1. approve design and continue to planning
2. request design revision
3. show design summary/status
4. exit
```

#### Planning

After approval selected through `--resume`:

```text
record approval for exact design version
  ↓
enter planning
  ↓
SpecPlanPhaseAdapter
  ↓
produce requirements.md + tasks.md
  ↓
version both artifacts
  ↓
enter awaiting-plan-review-decision
```

#### Awaiting Plan Review Decision

System stops and shows this through `/brainstorm-pro --resume`:

```text
Plan draft is ready:
- specs/<topic>/requirements.md
- specs/<topic>/tasks.md

Choose plan review mode:
1. skip
2. minimal
3. full
4. revise
```

#### Awaiting Plan Approval

System stops and shows this through `/brainstorm-pro --resume`:

```text
Plan is ready for approval:
- specs/<topic>/requirements.md
- specs/<topic>/tasks.md
- review mode/status: skip/skipped or minimal/passed

Choose next action:
1. approve plan and continue to execution
2. request plan revision
3. show plan summary/status
4. exit
```

#### Execution

After approval selected through `--resume`:

```text
record approval for exact requirements/tasks versions
  ↓
enter executing
  ↓
SpecExecPhaseAdapter
  ↓
execute approved tasks
  ↓
enter execution-review
  ↓
done or blocked
```

#### Resume

```text
/brainstorm-pro --resume
  ↓
find resumable workflows
  ↓
if multiple workflows:
    ask user to select topic
  ↓
load selected state.json
  ↓
if awaiting review decision:
    show artifact path/version and ask user to choose skip/minimal/full/revise
  else if awaiting approval:
    show artifact path/version/review status and ask user to approve/revise/inspect/exit
  else if blocked:
    show blocker and recovery options
  else if failed and recoverable:
    show error and retry/recover options
  else:
    resume from current phase
```

`--resume` must never silently approve an artifact or silently choose a review mode. It may automatically continue non-decision phases after a previously recorded user decision.

## Error Handling

### Invalid state transition

示例：在 planning artifacts 不存在时批准 plan。

处理：

```text
reject with recoverable workflow-boundary error
state unchanged
event appended
```

### Missing artifact

示例：state 指向 `design v2`，但文件不存在。

处理：

```text
enter blocked
record artifact-integrity error
tell user how to recover
```

### Phase adapter failure

处理：

```text
phase failed
state = failed or blocked depending on recoverability
error stored in state.lastError
event appended
```

### Review decision / approval mismatch

如果用户已经为 design v1 选择 review mode，但 `design.md` 或 latest artifact version 在 review/approval 前变成 v2：

```text
reject stale review decision
require user to choose review mode for latest version
state returns to awaiting-design-review-decision or blocked
```

如果用户尝试批准 design，但 `design.md` 或 latest artifact version 自 review 后发生变化：

```text
reject approval
require review/revalidation of latest version
state remains awaiting-design-approval or returns to awaiting-design-review-decision
```

同理，如果 `requirements.md` 或 `tasks.md` 在 plan review decision、plan review 或 plan approval 前变化，则拒绝 stale decision/approval。

### Event append failure

事件日志写入失败时不应静默继续推进 workflow。推荐策略：

```text
fail closed
state remains at previous safe phase if possible
surface event-log-write error
```

### Corrupted state

`state.json` schema validation 失败时：

```text
refuse to resume
show recovery guidance
optionally reconstruct read-only status from events.jsonl in a future spec
```

第一版不要求自动修复 corrupted state。

### Topic/path safety

所有 workflow path 必须位于：

```text
specs/<topic>/
```

其中 `<topic>` 必须继续使用严格 topic validation，例如 English kebab-case，拒绝 path traversal、absolute path、空 topic 和隐藏目录跳转。

## Testing

### Unit tests: state machine

- 合法主路径 transition 被接受。
- 非法 transition 被拒绝。
- 未批准 design 时不能进入 planning。
- 未批准 plan 时不能进入 executing。
- `blocked` 和 `failed` 的 resume 行为符合策略。

### Unit tests: gates

- design review decision 写入 exact design version。
- plan review decision 写入 exact requirements/tasks versions。
- design approval 写入 exact design version。
- plan approval 写入 exact requirements/tasks versions。
- artifact version mismatch 时拒绝 review decision 或 approval。
- missing artifact 时拒绝 review decision 或 approval。
- user-selected skip 被显式记录，而不是隐式通过。
- full review unavailable 时不会静默降级。

### Unit tests: artifact store

- 创建 topic workflow layout。
- 写入 `design v1` 并 mirror 到 `design.md`。
- 写入 `requirements v1` 和 `tasks v1` 并 mirror。
- version increment 正确。
- path traversal 被拒绝。
- missing versioned artifact 被检测。

### Unit tests: event log

- workflow started event append。
- phase started/completed event append。
- gate awaiting/approved event append。
- invalid transition event append。
- JSONL 格式稳定。

### Unit tests: runtime

- start workflow 创建 state/events/artifacts。
- resume 在 awaiting review decision 时展示 review mode 选择，不会自动选择。
- resume 在 awaiting approval 时展示 approval 选择，不会自动批准。
- 用户选择 design review skip 后进入 awaiting-design-approval 并记录 skipped reason。
- 用户选择 design review minimal 后运行 DesignReviewPhaseAdapter。
- 用户 approve design 后自动进入 planning。
- 用户 approve plan 后自动进入 execution。
- adapter failure 进入 failed 或 blocked。
- status 输出当前 phase、pending decision/gate 和 artifact paths。

### Integration tests

- 完整 happy path：start → design → awaiting design review decision → choose minimal/skip → awaiting design approval → approve design → plan → awaiting plan review decision → choose minimal/skip → awaiting plan approval → approve plan → execute → done。
- 中断后 `--resume` 从正确 phase 恢复。
- 多个 pending workflow 时 `--resume` 要求用户选择 topic。
- design approval 前运行 planning 被拒绝。
- plan approval 前运行 execution 被拒绝。
- artifact 被手动删除后 workflow blocked。

### Security tests

- topic path traversal rejected。
- approvals and review decisions cannot reference outside topic directory。
- corrupted state fails closed。
- phase adapter cannot skip review decision or approval gate。
- project-local config/tool expansion remains constrained。
- no automatic execution before explicit plan approval。

## Open Questions

这些问题不阻塞本 spec，但需要在后续 spec 中解决：

1. Multi-agent design review panel 的 reviewer roles、并发策略和 triage 规则。
2. Review failed 时是自动 revision 还是暂停问用户。
3. `brainstorming`、`spec-plan`、`spec-exec` 作为 skill adapter 的具体调用机制。
4. 是否支持 background execution。
5. 是否未来暴露 Pi tool，而不只是 slash command。
6. Execution review 的 reviewer 角色和通过标准。
7. 是否根据事件日志支持 corrupted state 的自动重建。
