# Brainstorming Pro 全局重构路线设计

## Summary

本文档记录 Brainstorming Pro 颠覆式重构的全局设计思路、核心架构决策、长期目标和分阶段 spec 拆分。它不是某一个具体子系统的实现设计，而是后续所有重构 spec 的上位约束文档，用于确保 `workflow-runtime-orchestrator`、agent execution runtime、multi-agent review panel、skill phase adapters、plan/execution review 等后续设计不会偏离总体方向。全局目标是把 Brainstorming Pro 从一组三段式手动 slash command/skill 流程，升级为一个由代码强制状态机驱动、可恢复、可审计、支持多 Agent 交叉评审的复杂需求澄清与稳定实现平台。

## Goals

- 明确 Brainstorming Pro 重构后的长期产品目标和架构方向。
- 记录关键设计决策，避免后续单个 spec 只关注局部而偏离整体。
- 将大规模重构拆成多个可独立设计、实现和验证的子 spec。
- 规定子 spec 之间的依赖关系、边界和落地顺序。
- 明确哪些能力应由代码强制，哪些能力可以由 LLM/agent 负责。
- 明确用户确认 gate、artifact/version/event store、phase adapter、multi-agent review 的整体关系。
- 为后续 `spec-plan` 和实现阶段提供全局验收标准。

## Primary Users / Roles

- **Brainstorming Pro maintainer**：需要一个全局蓝图指导后续重构，避免每个 spec 各自为政。
- **Workflow user**：希望复杂需求能被自动澄清、评审、规划和执行，只在关键决策点介入。
- **Spec author / implementation agent**：需要知道某个子 spec 在整体重构中的位置、边界和依赖。
- **Security / reliability reviewer**：需要确认新架构不会让父 LLM、subagent 或 skill 绕过生命周期 gate。
- **Future multi-agent review designer**：需要清楚 review panel 应挂载在哪里、读取哪些 artifacts、如何影响 workflow 状态。

## Non-Goals

- 本文档不替代各子系统的详细 `design.md`。
- 本文档不包含完整实现任务列表；任务应由各子 spec 的 `requirements.md` 和 `tasks.md` 承担。
- 本文档不详细设计 reviewer prompt、agent schema、subagent launch args 或 runtime API。
- 本文档不要求一次性完成所有重构。
- 本文档不追求兼容现有 `/clarify -> /spec-plan -> /spec-exec` 的内部结构；当前项目仍处于可破坏式重构阶段，应优先选择长期更稳的架构。

## Context

Brainstorming Pro 当前围绕如下生命周期工作：

```text
/clarify <request> -> /spec-plan <topic> -> /spec-exec <topic>
```

当前已有较成熟的能力：

- `brainstorming`：通过协作式澄清把想法转为设计。
- `spec-plan`：从设计生成 requirements 和 tasks。
- `spec-exec`：根据 tasks 稳定执行。
- `/clarify` 相关实现：围绕 durable artifacts、reviewers、状态恢复和设计 approval 已有实践。

但当前核心痛点是：

```text
这三个成熟能力之间缺少一个顶层 workflow runtime。
```

对于复杂需求，用户仍然需要手动：

1. 启动 brainstorming 或 clarify。
2. 检查 `design.md` 是否充分。
3. 手动开启多个 agent 从产品、架构、风险、测试等角度评审 design。
4. 汇总 reviewer 反馈。
5. 处理冲突、修订 design。
6. 决定何时进入 planning。
7. 手动运行 spec-plan。
8. 检查 requirements/tasks 是否覆盖 design。
9. 手动运行 spec-exec。
10. 检查执行是否偏离 design/tasks。

因此，全局重构的目标不是简单增加一个 command 或一个通用 subagent tool，而是建立一个稳定的需求交付工作流平台：

```text
复杂需求输入
  → 自动澄清
  → 多 Agent 交叉评审 design
  → 用户批准 design
  → 自动生成 requirements/tasks
  → 多 Agent 评审 plan
  → 用户批准 plan
  → 稳定执行 tasks
  → 执行后 review
  → done
```

## Discovery

### Key Discoveries

- 项目的核心价值不是 slash command 本身，而是“多 Agent 交叉评审来澄清复杂需求并稳定实现”。
- `brainstorming`、`spec-plan`、`spec-exec` 已经是有价值的成熟能力，应作为 workflow phase 被复用，而不是被简单丢弃。
- 最大架构缺口是缺少统一的 workflow runtime 来强制状态迁移、保存 artifacts、记录 events、管理 approval gates 和 resume。
- 对复杂需求来说，`design.md` 的可信度非常关键。它不应由单个 agent 一次生成后直接进入 planning，而应经过多 Agent review、triage 和必要 revision。
- 不能依赖父 LLM 通过 prompt 自觉遵循 `/clarify -> /spec-plan -> /spec-exec`。父 LLM 可以表达意图，但状态迁移必须由代码强制。
- 通用 `subagent` tool 可以作为底层参考，但不应成为顶层产品抽象。Brainstorming Pro 的核心抽象应是 workflow，而不是任意委派。
- Approval gate 不能交给 agent 自动通过。采用“全自动推进非决策阶段，但在 review mode decision、design approval 和 plan approval 等用户决策点暂停”的交互模式。
- 用户应先审阅第一版 design/plan artifact，再通过统一 `--resume` 入口选择 review 深度：`skip`、`minimal` 或未来的 `full`。
- Multi-agent review panel 是高价值能力，但必须建立在 workflow runtime、artifact store、event log 和 phase adapter 基础之上。
- 后续 spec 必须分层落地，否则一次性设计会过大且难以测试。

### Scope Decisions

全局重构包含以下方向：

- 顶层 Workflow Runtime Orchestrator。
- 持久化状态机。
- Artifact/version store。
- Append-only event log。
- Design/plan review decision gates 和 approval gates。
- Phase adapter registry。
- Agent execution runtime。
- Multi-agent design review panel。
- Plan review 和 execution review。
- Public workflow UX。
- Workflow TUI / live progress UI。

全局重构暂不把以下内容作为核心抽象：

- 完全自由的 public `subagent` tool。
- 让父 LLM 自主拼接 arbitrary chain。
- 默认 background async runner。
- 自动 approval。
- 依赖 prompt 约定来保护生命周期边界。

## Proposed Solution

将 Brainstorming Pro 重构为分层系统：

```text
User / Parent LLM
  ↓
Workflow Intent Interface
  ↓
Workflow Runtime Orchestrator
  ↓
Phase Adapters
  ↓
Agent Orchestration / Execution Runtime
  ↓
Pi Subagent Processes / Existing Skills
  ↓
Artifact Store / Review Ledger / Event Log
```

核心原则：

```text
User expresses intent.
Workflow Runtime owns lifecycle.
Resume drives state-aware decisions.
Phase adapters produce artifacts.
Agents provide reasoning and review.
Code enforces gates.
Artifacts are versioned.
Events are append-only.
```

### Architecture

#### 1. Workflow Intent Interface

对外暴露用户意图入口，而不是要求用户手动串联多个底层 command。

主路径应尽量减少用户需要记忆的命令：

```text
/brainstorm-pro "复杂需求描述"
/brainstorm-pro --resume
/brainstorm-pro --status
```

`--resume` 是状态感知入口：如果存在多个 pending workflow，它先让用户选择 topic；随后根据当前状态展示下一步可选操作，例如选择 review mode、批准 artifact、请求 revision、重试 failed phase 或查看 blocker。用户不需要记住 `approve design`、`review --mode minimal` 等细粒度命令。

未来也可以暴露 tool：

```ts
brainstorming_pro({
  action: "start" | "resume" | "status",
  topic?: string,
  request?: string
})
```

该接口只表达意图。它不能直接越过 runtime 的状态检查。细粒度 approve/review action 可以作为未来自动化 API 或高级快捷方式，但不应成为默认 UX。

#### 2. Workflow Runtime Orchestrator

全局重构的核心。负责：

- workflow state machine；
- legal transition enforcement；
- approval gate enforcement；
- artifact version tracking；
- event append；
- resume/status；
- phase adapter 调度；
- failure/block handling。

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

关键 gate：

```text
design review decision gate:
  user selects skip | minimal | full for exact latest design version

design approval gate:
  selected design review mode completed or explicitly skipped, then exact latest design approved by user

plan review decision gate:
  user selects skip | minimal | full for exact latest requirements/tasks versions

plan approval gate:
  selected plan review mode completed or explicitly skipped, then exact latest requirements/tasks approved by user
```

`skip` 必须是用户显式选择并记录的结果，不能是隐式 no-op。`full` 在 review panel 尚未实现时应明确提示 unavailable，不能静默降级。

#### 3. Phase Adapters

将现有成熟能力包装为 workflow phase，而不是让用户手动调用。

目标 adapters：

```text
BrainstormingPhaseAdapter
DesignReviewPhaseAdapter
SpecPlanPhaseAdapter
PlanReviewPhaseAdapter
SpecExecPhaseAdapter
ExecutionReviewPhaseAdapter
```

Phase adapter 只能：

- 读取 runtime 提供的 artifacts/context；
- 调用 skill、agent 或 internal implementation；
- 返回结构化 output；
- 请求 artifact commit。

Phase adapter 不能：

- 直接跳过 review decision 或 approval gate；
- 私自改写 workflow state；
- 批准自己的产物；
- 在未授权状态下进入下一阶段。

#### 4. Agent Execution Runtime

底层提供可靠的 agent 启动与结果收集能力。

可参考 `nicobailon/pi-subagents` 的生产实践：

- 子 Agent 独立 Pi 子进程。
- prompt 文件化。
- system prompt 文件化。
- foreground child 不 detached。
- 显式 `stdio`。
- 显式 `--no-session`。
- 显式 `--no-skills`。
- child env metadata。
- depth / recursion guard。
- schema validation。
- timeout / retry / output limit。
- temp file cleanup。

但注意：

```text
pi-subagents 的通用委派能力是参考对象，不是 Brainstorming Pro 的顶层产品模型。
```

Brainstorming Pro 应优先暴露 workflow，而不是完全自由的 subagent orchestration。

#### 5. Multi-Agent Review Panels

后续设计应引入多个 review panel：

```text
Design Review Panel
  ├─ Product Reviewer
  ├─ Architecture Reviewer
  ├─ Risk / Security Reviewer
  ├─ Testing Reviewer
  └─ Scope / Simplicity Reviewer

Plan Review Panel
  ├─ Coverage Reviewer
  ├─ Dependency / Ordering Reviewer
  ├─ Testability Reviewer
  └─ Risk Reviewer

Execution Review Panel
  ├─ Diff Reviewer
  ├─ Requirement Coverage Reviewer
  ├─ Test Reviewer
  └─ Regression Risk Reviewer
```

Review panel 输出结构化 findings，不直接改写主 artifact。Runtime 或专门 triage phase 负责聚合、裁决、触发 revision 或请求用户决策。

#### 6. Artifact Store / Review Ledger / Event Log

所有关键产物都必须可追溯：

```text
specs/<topic>/
  design.md
  requirements.md
  tasks.md

  .workflow/
    state.json
    events.jsonl
    artifacts/
    reviews/
    approvals/
    decisions/
    runs/
```

原则：

- 顶层 markdown 是 latest mirror。
- `.workflow/artifacts/*/vN.md` 是版本历史。
- `.workflow/events.jsonl` 是 append-only audit trail。
- review decisions、reviews 和 approvals 记录 exact artifact versions。
- review decision 或 approval mismatch 时拒绝进入下一阶段。

### Components

本全局重构应拆成多个子 spec，而不是一次性实现。

#### Spec 1: `workflow-runtime-orchestrator`

路径：

```text
specs/workflow-runtime-orchestrator/design.md
```

定位：建立顶层 workflow 骨架。

包含：

- workflow state machine；
- artifact store；
- event log；
- review decision gates 和 approval gates；
- phase adapter interface；
- start / resume / status；
- 用户可选择的 skip/minimal review phase placeholder。

不包含：

- 完整 multi-agent review panel；
- reviewer prompt；
- agent execution runtime 细节；
- execution diff review。

依赖：无，是后续所有 spec 的基础。

#### Spec 2: `pi-subagents-infrastructure-reuse`

建议路径：

```text
specs/pi-subagents-infrastructure-reuse/design.md
```

定位：系统性评估并复用 `nicobailon/pi-subagents` 中业务逻辑无关的成熟基础设施代码。

包含：

- reuse inventory；
- license / attribution policy；
- vendoring / derived code 目录策略；
- TUI helpers、progress snapshot、formatters、atomic/jsonl writers 的复用规则；
- Pi spawn / output handling / child lifecycle 的适配规则；
- 明确不复用 generic `subagent` tool、intercom、background async product model；
- upstream sync policy；
- product boundary tests。

依赖：

- 无强依赖，但应参考 `workflow-runtime-orchestrator` 的状态机和 gate 原则。
- 是 `agent-execution-runtime` 和 `workflow-tui-live-progress` 的前置基础设计。

#### Spec 3: `agent-execution-runtime`

建议路径：

```text
specs/agent-execution-runtime/design.md
```

定位：可靠启动和管理内部 agent/subagent。

包含：

- role-based `runAgent()`；
- launch spec builder；
- prompt/system prompt temp files；
- child process isolation；
- no-session/no-skills；
- recursion guard；
- tool/model policy；
- structured output validation；
- timeout/retry/output limit；
- cleanup；
- observability hooks。

依赖：

- `workflow-runtime-orchestrator`。
- `pi-subagents-infrastructure-reuse`，用于复用或改造 launch、spawn、output、progress 相关基础设施。

#### Spec 4: `skill-phase-adapters`

建议路径：

```text
specs/skill-phase-adapters/design.md
```

定位：把 `brainstorming`、`spec-plan`、`spec-exec` 封装为 workflow phases。

包含：

- BrainstormingPhaseAdapter；
- SpecPlanPhaseAdapter；
- SpecExecPhaseAdapter；
- adapter input/output schema；
- artifact commit contract；
- failure/block semantics；
- resume semantics。

依赖：

- `workflow-runtime-orchestrator`。
- 部分依赖 `agent-execution-runtime`，取决于 adapter 是直接调用内部逻辑还是通过子 agent 调用 skill。

#### Spec 5: `design-review-panel`

建议路径：

```text
specs/design-review-panel/design.md
```

定位：自动化复杂需求下的多 Agent design 交叉评审。

包含：

- reviewer roles；
- review schemas；
- parallel execution；
- review aggregation；
- triage；
- blocking/non-blocking 分类；
- design revision loop；
- max review rounds；
- user questions；
- review ledger。

依赖：

- `workflow-runtime-orchestrator`。
- `agent-execution-runtime`。
- `skill-phase-adapters` 中的 brainstorming adapter。

#### Spec 6: `plan-review-panel`

建议路径：

```text
specs/plan-review-panel/design.md
```

定位：验证 `requirements.md` 和 `tasks.md` 是否覆盖已批准 design，并确保任务顺序、粒度和测试策略稳定。

包含：

- coverage review；
- dependency/order review；
- testability review；
- risk review；
- task gap detection；
- plan revision loop；
- plan approval readiness report。

依赖：

- `workflow-runtime-orchestrator`。
- `agent-execution-runtime`。
- `skill-phase-adapters` 中的 spec-plan adapter。
- 最好在 `design-review-panel` 之后，因为两者共享 review/triage 模型。

#### Spec 7: `execution-review-panel`

建议路径：

```text
specs/execution-review-panel/design.md
```

定位：执行完成后验证实现没有偏离 approved design 和 approved tasks。

包含：

- diff review；
- requirement coverage review；
- test review；
- regression risk review；
- failed execution recovery；
- post-exec fix loop；
- final done criteria。

依赖：

- `workflow-runtime-orchestrator`。
- `agent-execution-runtime`。
- `skill-phase-adapters` 中的 spec-exec adapter。
- `plan-review-panel`。

#### Spec 8: `workflow-ux-interface`

建议路径：

```text
specs/workflow-ux-interface/design.md
```

定位：统一用户入口和状态展示。

包含：

- `/brainstorm-pro` command；
- `--resume` 作为主恢复和决策入口；
- `--status`；
- 多 pending workflow 选择；
- review mode decision 展示；
- approval decision 展示；
- review summary 展示；
- blocked/failed recovery hints；
- optional future Pi tool interface。

不应把 `--approve design`、`--approve plan`、`--review --mode` 等细粒度命令作为默认主路径；它们最多是未来高级快捷方式或自动化 API。

依赖：

- `workflow-runtime-orchestrator`。
- 可在 review panels 之前先做基础 UX，后续再增强展示。

#### Spec 9: `workflow-tui-live-progress`

建议路径：

```text
specs/workflow-tui-live-progress/design.md
```

定位：参考 `nicobailon/pi-subagents` 的 TUI 经验，为 Brainstorming Pro workflow 提供可观察、可压缩、可展开的 live progress UI。

包含：

- workflow 顶部/底部 live widget；
- phase timeline；
- reviewer/agent 并发进度；
- 当前 activity、tool、token、耗时、输出路径展示；
- compact / expanded 两种视图；
- approval gate 卡片；
- blocked/failed 诊断卡片；
- status 页面与 artifact links；
- animation lifecycle 与 stale context cleanup；
- non-TUI fallback 输出。

设计灵感来源：

- `pi-subagents` 使用 `ctx.ui.setWidget()` 展示后台/前台 agent 进度；
- running agent 使用 spinner animation 和定时 `requestRender()`；
- compact view 保持低噪声，expanded view 展示 live detail；
- parallel/chain 模式显示 step/agent 列表、状态 glyph、tool count、tokens、duration、output path；
- slash command live snapshot 用 versioned snapshot 驱动 UI 刷新，避免直接耦合执行逻辑。

依赖：

- `workflow-runtime-orchestrator`。
- `pi-subagents-infrastructure-reuse`，用于复用或改造 TUI rendering、snapshot、formatter、animation lifecycle。
- `agent-execution-runtime` 的 progress event。
- `design-review-panel` / `plan-review-panel` / `execution-review-panel` 的 reviewer status schema。
- 可先实现最小 phase timeline widget，再逐步增强 reviewer detail。

### Data Flow

全局目标路径：

```text
User starts workflow
  ↓
Workflow Runtime creates state/events/artifact layout
  ↓
BrainstormingPhaseAdapter produces design draft
  ↓
Runtime pauses at awaiting-design-review-decision
  ↓
User resumes and selects design review mode: skip | minimal | full
  ↓
DesignReviewPanel reviews design, or review is explicitly skipped by user decision
  ↓
Triage/revision loop resolves blocking issues when review runs
  ↓
Runtime pauses at awaiting-design-approval
  ↓
User resumes and approves exact design version
  ↓
SpecPlanPhaseAdapter produces requirements/tasks
  ↓
Runtime pauses at awaiting-plan-review-decision
  ↓
User resumes and selects plan review mode: skip | minimal | full
  ↓
PlanReviewPanel validates coverage/order/testability, or review is explicitly skipped by user decision
  ↓
Runtime pauses at awaiting-plan-approval
  ↓
User resumes and approves exact requirements/tasks versions
  ↓
SpecExecPhaseAdapter executes approved tasks
  ↓
ExecutionReviewPanel validates implementation
  ↓
Runtime marks workflow done or blocked
```

第一阶段落地时，review panels 可以是用户可选择的 placeholder：

```text
DesignReviewAdapter: user-selected skip or minimal
PlanReviewAdapter: user-selected skip or minimal
ExecutionReviewAdapter: skipped/minimal according to later execution-review UX
```

`skipped` 必须来自用户显式选择或明确策略记录，不能是隐式 no-op。但状态机必须从一开始保留这些节点，避免后续重构主流程。

## Error Handling

全局错误处理原则：

### 1. Fail closed

任何状态损坏、artifact 缺失、review decision mismatch、approval mismatch、非法 transition 都应拒绝继续推进，而不是猜测用户意图。

### 2. Runtime owns transitions

Phase adapter、agent、reviewer、父 LLM 都不能直接推进状态。它们只能返回结果，由 runtime 检查并提交。

### 3. Review decisions and approvals must bind exact versions

Design review decision 和 design approval 必须绑定 exact design artifact version。

Plan review decision 和 plan approval 必须绑定 exact requirements/tasks artifact versions。

如果 artifact 在 review decision、review 或 approval 前发生变化，必须重新选择 review mode、重新 review 或重新请求 approval。

### 4. Review findings do not mutate artifacts directly

Reviewer 输出 findings。Design/task 修改应由 revision phase 或 adapter 完成，并生成新 artifact version。

### 5. Resume must be deterministic

`--resume` 必须基于 `state.json` 和 `events.jsonl` 恢复，不应依赖对话上下文猜测当前阶段。`--resume` 可以自动推进非决策阶段，但在 review decision 和 approval gate 处必须展示用户选择，不能静默选择 review mode 或自动 approve。

### 6. User gates are non-bypassable

进入 planning 前必须有 design review decision 和 design approval。

进入 execution 前必须有 plan review decision 和 plan approval。

即使父 LLM 或 subagent 请求继续，也必须由代码拒绝非法推进。

## Testing

全局重构的测试策略应覆盖多个层级。

### Runtime-level tests

- 状态机合法/非法 transition。
- review decision gate enforcement。
- approval gate enforcement。
- resume/status。
- artifact version matching。
- event log append。
- corrupted state fail closed。

### Adapter-level tests

- 每个 adapter 声明 required artifacts。
- adapter output schema validation。
- adapter failure 转换为 blocked/failed。
- adapter 不能跳过 review decision 或 approval gate。

### Agent runtime tests

- child process isolation。
- no-session/no-skills。
- prompt file/system prompt file。
- recursion guard。
- timeout/retry/output limit。
- structured output parse failure。

### Review panel tests

- 多 reviewer 并发执行。
- findings aggregation。
- conflicting reviews triage。
- blocking issue 阻止 approval readiness。
- revision loop 最大轮次。

### End-to-end tests

- start → design → awaiting design review decision → choose review mode → design review/skipped → design approval → plan → awaiting plan review decision → choose review mode → plan review/skipped → plan approval → exec → execution review → done。
- design review decision 或 design approval 前不能 planning。
- plan review decision 或 plan approval 前不能 execution。
- artifact 被篡改后 stale review decision 或 approval 被拒绝。
- interrupted workflow 可以通过 `--resume` 恢复。

### Security tests

- topic path traversal rejected。
- artifact refs cannot escape topic dir。
- review decisions and approvals cannot reference external files。
- project-local agents/tools/config policy 不被子 agent 隐式放宽。
- child process 不注册父级 workflow commands unless explicitly allowed by a future spec。

## Open Questions

这些问题应在后续子 spec 中解决，而不是在本文档中一次性定死：

1. `brainstorming`、`spec-plan`、`spec-exec` skill adapter 应直接调用内部模块，还是通过 isolated child Pi process 调用？
2. Multi-agent review 的默认 reviewer 数量和角色是否可配置？
3. Review triage 是单独 agent，还是 runtime deterministic merge + optional agent summary？
4. Design revision loop 是否自动执行，还是遇到 blocking finding 后先询问用户？
5. Plan review failed 后是否自动重新生成 tasks？
6. Execution review failed 后是否自动进入 fix loop？
7. 是否需要 background async runner？如果需要，应在 workflow runtime 稳定后单独设计。
8. 是否公开 Pi tool interface？如果公开，如何避免父 LLM 绕过 workflow command/gate？
9. 是否支持从 `events.jsonl` 自动重建损坏的 `state.json`？
10. 当前已有 `/clarify`、`/spec-plan`、`/spec-exec` 是否保留为低层命令，还是最终被 `/brainstorm-pro` 取代？

## Recommended Spec Order

推荐落地顺序：

```text
1. workflow-runtime-orchestrator
   ↓
2. pi-subagents-infrastructure-reuse
   ↓
3. agent-execution-runtime
   ↓
4. skill-phase-adapters
   ↓
5. workflow-ux-interface minimal
   ↓
6. workflow-tui-live-progress minimal
   ↓
7. design-review-panel
   ↓
8. plan-review-panel
   ↓
9. execution-review-panel
   ↓
10. workflow-ux-interface / workflow-tui-live-progress polish
```

`workflow-ux-interface` 和 `workflow-tui-live-progress` 应分开设计：前者定义 `/brainstorm-pro --resume`、status、多 workflow 选择、review decision、approval 等交互语义；后者定义 TUI widget、live progress、expanded detail、approval/blocked cards 等显示体验。基础 UX 和最小 TUI 可在 review panels 前提前落地，让后续 multi-agent review 从第一天就接入统一可视化通道。

## Global Acceptance Criteria

后续所有子 spec 和实现都必须满足以下全局约束：

- 不能依赖父 LLM 自觉遵循生命周期；生命周期必须由代码强制。
- 未完成 design review decision 和 design approval 时不能进入 planning。
- 未完成 plan review decision 和 plan approval 时不能进入 execution。
- 所有关键 artifacts 必须版本化。
- Review decision 和 approval 必须绑定 exact artifact versions。
- Events 必须记录关键状态变化。
- Agent/reviewer 不能直接修改 workflow state。
- Review finding 不能直接覆盖主 artifact。
- Workflow 必须可 status、resume、blocked/failed 诊断。
- 可复用 `nicobailon/pi-subagents` 的业务无关基础设施代码，但不得继承其 generic `subagent` product model；derived code 必须保留 MIT license attribution。
- 长时间运行或多 Agent 并发阶段必须有可观察 UI：至少提供 compact progress、expanded detail、artifact path 和 non-TUI fallback。
- UI 只能展示 runtime state/progress snapshot，不能成为状态真相来源，也不能绕过 approval gate。
- 子 spec 必须说明自己在全局架构中的位置、依赖和非目标。
