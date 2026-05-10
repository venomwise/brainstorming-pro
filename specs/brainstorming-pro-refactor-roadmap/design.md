# Brainstorming Pro 全局重构路线设计

## Summary

本文档记录 Brainstorming Pro 颠覆式重构的全局设计思路、核心架构决策、长期目标和分阶段 spec 拆分。它不是某一个具体子系统的实现设计，而是后续所有重构 spec 的上位约束文档，用于确保 `workflow-runtime-orchestrator`、agent execution runtime、multi-agent review panel、skill phase adapters、plan review、controlled execution 等后续设计不会偏离总体方向。全局目标是巩固当前以 `/brainstorm-pro` 为唯一公开入口的 runtime-first 架构，把需求澄清、artifact 生成、review/approval gate、planning 和 controlled execution 都收敛到代码强制状态机中，形成可恢复、可审计、支持多 Agent 交叉评审的复杂需求澄清与稳定实现平台。

## Goals

- 明确 Brainstorming Pro 重构后的长期产品目标和架构方向。
- 记录关键设计决策，避免后续单个 spec 只关注局部而偏离整体。
- 将大规模重构拆成多个可独立设计、实现和验证的子 spec。
- 规定子 spec 之间的依赖关系、边界和落地顺序。
- 明确哪些能力应由代码强制，哪些能力可以由 LLM/agent 负责。
- 明确用户确认 gate、artifact/version/event store、phase adapter、multi-agent review 的整体关系。
- 为后续 planning/execution phase adapter 和实现阶段提供全局验收标准。

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
- 本文档不设计多入口命令编排；当前项目以 `/brainstorm-pro` 作为唯一公开 workflow 入口，仍处于可破坏式重构阶段，应优先选择长期更稳的架构。

## Context

Brainstorming Pro 当前采用单一 `/brainstorm-pro` workflow intent interface。

当前 public command surface：

```text
/brainstorm-pro "<request>"
/brainstorm-pro "<request>" --topic <existing-topic>
/brainstorm-pro --resume [topic]
/brainstorm-pro --status [topic]
```

当前已落地的基础包括：

- 单一 `/brainstorm-pro` command handler；
- request-to-topic proposal；
- strict topic validation；
- runtime state schema；
- persisted run state under `specs/<topic>/.workflow/runs/<run-id>/state.json`；
- review decision / approval gate phase names；
- explicit `skip | minimal | full` review decision model；
- design/plan approval decision model；
- `blocked` / `failed` fail-closed behavior；
- package-owned `brainstorming-pro`、`spec-plan-pro`、`spec-exec-pro` skill methodology docs；
- planning/execution/review phase adapter skeletons。

当前尚未完整落地或仍为 placeholder 的能力包括：

- phase adapters 实际调用 LLM/skill/agent 生成 artifacts；
- durable artifact version commit 的完整 runtime 集成；
- append-only event log 的完整 runtime 写入；
- multi-agent design/plan review panel；
- agent execution runtime；
- live TUI progress；
- 真正的 planning/execution 自动化。

因此当前核心痛点是：

```text
单一 `/brainstorm-pro` runtime 骨架已经存在，但真实 phase adapter、artifact/event 集成、agent execution 和 multi-agent review 仍需补齐。
```

对于复杂需求，系统目标是由 runtime 驱动完整自动化：

1. 通过 `/brainstorm-pro` 表达需求意图。
2. runtime 创建 topic/run state 并进入 designing。
3. 后续 BrainstormingPhaseAdapter 生成或修订 `design.md`。
4. runtime 暂停在 design review decision / approval gate。
5. 后续 review panel 从产品、架构、风险、测试等角度评审 design。
6. runtime 记录用户 review mode、approval 或 revision 决策。
7. 后续 SpecPlanPhaseAdapter 生成 requirements/tasks。
8. runtime 暂停在 plan review decision / approval gate。
9. 后续 Controlled SpecExecPhaseAdapter 按 code-owned task loop 执行 approved tasks、checkpoint 和 evidence validation。
10. 执行完成且无 blocker 后，runtime 记录 execution report 并进入 done。

因此，全局重构的目标不是简单增加一个 command 或一个通用 subagent tool，而是建立一个稳定的需求交付工作流平台：

```text
复杂需求输入
  → 自动澄清
  → 多 Agent 交叉评审 design
  → 用户批准 design
  → 自动生成 requirements/tasks
  → 多 Agent 评审 plan
  → 用户批准 plan
  → 稳定执行 tasks/checkpoints
  → 记录 execution report
  → done
```

## Discovery

### Key Discoveries

- 项目的核心价值不是 slash command 本身，而是“多 Agent 交叉评审来澄清复杂需求并稳定实现”。
- `brainstorming`、`spec-plan`、`spec-exec` skill 的方法论应作为 workflow phase adapter 的行为约束被吸收，由 runtime 统一调度。
- 最大架构缺口是已有 runtime skeleton，但还缺少真实 phase adapter、artifact/event 集成、agent execution runtime 和 review panel。
- 对复杂需求来说，`design.md` 的可信度非常关键。它不应由单个 agent 一次生成后直接进入 planning，而应经过多 Agent review、triage 和必要 revision。
- 不能依赖父 LLM 通过 prompt 自觉遵循生命周期，也不能让父 LLM 直接推进 planning/execution。父 LLM 可以表达意图，但状态迁移必须由代码强制。
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
- Plan review 和 controlled execution。
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

将当前 phase adapter skeleton 落实为真正的 workflow phase，而不是要求用户手动串联底层流程。当前 adapter 名称已经保留在 runtime 结构中，但多数仍是 placeholder/skeleton，后续 spec 需要补齐实际 artifact 生成、执行和验证能力。

目标 adapters：

```text
BrainstormingPhaseAdapter
DesignReviewPhaseAdapter
SpecPlanPhaseAdapter
PlanReviewPhaseAdapter
SpecExecPhaseAdapter
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
- terminal execution review 或 execution diff review。

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

定位：把 package-owned `brainstorming`、`spec-plan` skill 的方法论和当前 adapter skeleton 落实为 workflow-owned design/planning phase adapters，并为 controlled execution adapter 建立共享 prompt/schema/context 基础。该 spec 只设计 runtime-owned phase 行为，不新增独立 public command surface。

包含：

- BrainstormingPhaseAdapter；
- SpecPlanPhaseAdapter；
- adapter input/output schema；
- artifact commit contract；
- failure/block semantics；
- SpecExecPhaseAdapter 的 deferred boundary。

依赖：

- `workflow-runtime-orchestrator`。
- `agent-execution-runtime`。

#### Spec 4.1: `controlled-spec-exec-adapter`

建议路径：

```text
specs/controlled-spec-exec-adapter/design.md
```

定位：把 `spec-exec` skill 的执行纪律升级为 code-owned task execution loop。代码解析 `tasks.md`、选择当前 task/checkpoint、调用 LLM single-task worker、校验结构化结果、更新 checkbox、记录 execution report；LLM 不控制全局执行顺序，也不修改 progress markers。执行完成且无 blocker 后进入 `done`，不设置默认 execution-review phase。

包含：

- TaskPlanParser；
- ExecutionLoopController；
- TaskCheckboxWriter；
- Single-task `task-executor` prompt/schema；
- optional execution mode；
- checkpoint-as-task execution；
- task run records；
- execution report；
- unauthorized tasks.md mutation guard；
- blocked/failed recovery semantics。

依赖：

- `workflow-runtime-orchestrator`。
- `agent-execution-runtime`。
- `skill-phase-adapters` shared adapter foundation。

#### Spec 5: `design-review-panel`

建议路径：

```text
specs/design-review-panel/design.md
```

定位：建立 Design Review Panel foundation，为自动化复杂需求下的多 Agent design 交叉评审定义稳定 runtime contract。该 spec 设计完整 reviewer panel 的上位架构、review run 生命周期、exact design version binding、finding schema、review ledger、基础 aggregation/readiness、adapter 集成和 full review capability boundary；但不一次性实现完整五角色 full reviewer prompt、advanced triage 或自动 revision loop。`full` review 在 Spec 5 首版可以显式返回 `unavailable`，但必须通过正式 capability 状态和事件记录表达，不能静默降级为 `minimal` 或 `skip`。

包含：

- `DesignReviewPanel` foundation；
- design review phase adapter 替换 placeholder；
- review run lifecycle：`created | running | collecting | aggregated | passed | blocked | failed | unavailable`；
- `skip | minimal | full` review mode handling，其中 `full` 首版允许 `full-review-unavailable`；
- exact `design` artifact version/checksum binding；
- reviewer role abstraction 和 full reviewer set contract；
- `minimal` review 的真实执行路径，且使用与 full review 相同的 review run / finding / ledger schema；
- unified `DesignReviewFinding` schema；
- reviewer result schema 和 malformed output handling；
- basic finding aggregation；
- basic blocking/non-blocking/readiness result；
- review ledger layout under `.workflow/reviews/design/<review-run-id>/`；
- stale artifact detection；
- reviewer timeout/failure/block semantics；
- progress/audit hooks for future TUI；
- follow-up 子 spec 的 extension points。

不包含：

- 完整 full reviewer role pack 的 prompt/schema 实现；
- 五个 reviewer 的并发 full execution；
- advanced triage、冲突归并和 approval readiness refinement；
- automatic design revision loop；
- plan review；
- execution review；
- public command surface 变更；
- review panel 自动 approve design；
- reviewer 直接修改 `design.md`、approval、decision 或 workflow state。

依赖：

- `workflow-runtime-orchestrator`。
- `agent-execution-runtime`。
- `skill-phase-adapters` 中的 brainstorming adapter。

后续子 spec：

```text
Spec 5.1: design-reviewer-role-pack
Spec 5.2: design-review-execution-control
Spec 5.3: design-review-triage-and-readiness
Spec 5.4: design-revision-loop
```

#### Spec 5.1: `design-reviewer-role-pack`

建议路径：

```text
specs/design-reviewer-role-pack/design.md
```

定位：在 Spec 5 定义的 review run、finding schema、ledger 和 version-binding contract 上，实现完整 `full` design review reviewer role pack。该 spec 让 `full` review 从 `unavailable` 变成可执行，但不能重新定义 Spec 5 的生命周期、ledger、approval gate 或 state authority。Spec 5.1 聚焦 reviewer capability 本身；用户可选择 reviewer subset、partial aggregation、failed reviewer retry 和 accept incomplete review 属于后续 Spec 5.2 `design-review-execution-control`。

包含：

- Product Reviewer；
- Architecture Reviewer；
- Risk / Security Reviewer；
- Testing Reviewer；
- Scope / Simplicity Reviewer；
- reviewer role registration / role policy 扩展；
- per-role prompt/system prompt；
- per-role structured output schema；
- full mode reviewer set resolution，首版默认解析为完整五角色集合；
- parallel reviewer execution through `agent-execution-runtime`；
- per-reviewer timeout、failure、invalid-output policy；
- reviewer result normalization into Spec 5 `DesignReviewFinding`；
- 为后续 Spec 5.2 预留 internal selected-role execution extension point，但不暴露用户选择 UX；
- role-specific fixtures and tests。

不包含：

- review run lifecycle 重新设计；
- review ledger layout 重新设计；
- approval readiness contract 重新设计；
- user-selectable reviewer subset；
- partial-success aggregation；
- failed reviewer retry；
- accept incomplete review decision；
- advanced triage；
- automatic design revision loop；
- design approval automation。

依赖：

- `design-review-panel`。
- `agent-execution-runtime`。
- `skill-phase-adapters` 中的 brainstorming adapter。

#### Spec 5.2: `design-review-execution-control`

建议路径：

```text
specs/design-review-execution-control/design.md
```

定位：在 Spec 5.1 full reviewer role pack 可用后，为 design review 增加用户可控的 reviewer subset、partial-success aggregation、failed reviewer retry 和 explicit accept-incomplete gate。该 spec 处理 review execution control 和 recovery semantics，不实现 reviewer prompt，不做 advanced triage，不自动 revise design，也不自动 approve design。

包含：

- reviewer selection decision model，作为 design review decision 的扩展并绑定 exact design artifact version/checksum；
- full review 默认全选五个 reviewer，但允许用户选择一个或多个 reviewer subset；
- selected / unselected / succeeded / failed reviewer coverage model；
- partial-success aggregation：成功 reviewer 的 findings 进入 aggregation，失败 reviewer 记录 diagnostics；
- `partial` review status 和 `incomplete-review` readiness；
- failed reviewer retry，优先只重试失败 reviewer，并保持同一 design artifact binding；
- explicit accept-incomplete decision：当至少一个 selected reviewer 成功、无 blocking findings、且仍有 failed reviewer 时，用户可显式接受 incomplete review 并进入 design approval gate；
- retry / accept-incomplete / reviewer selection 的 event log 和 ledger attempt model；
- `--resume` / status 的 recovery contract，供 Spec 7 UX 实现展示。

不包含：

- 五个 reviewer prompt / system prompt；
- reviewer role implementation；
- advanced triage、deduplication 或 conflict resolution；
- automatic design revision loop；
- plan review；
- design approval automation。

依赖：

- `design-review-panel`。
- `design-reviewer-role-pack`。
- `workflow-runtime-orchestrator` 的 review decision / resume gate contract。

#### Spec 5.3: `design-review-triage-and-readiness`

建议路径：

```text
specs/design-review-triage-and-readiness/design.md
```

定位：增强 Spec 5 的基础 aggregation/readiness 和 Spec 5.2 的 reviewer coverage/incomplete review 结果，把多 reviewer findings 转换成更稳定、用户可理解、可驱动 revision 的 triage 和 approval readiness report。该 spec 聚焦 finding deduplication、冲突处理、must-fix/should-fix/note 分类和 unresolved question summary，不负责 reviewer prompt、reviewer selection/retry 或 revision 写作。

包含：

- finding deduplication；
- conflicting reviewer result handling；
- blocking vs non-blocking classification refinement；
- must-fix / should-fix / note 分层；
- approval readiness report；
- incomplete review coverage summary；
- unresolved user question summary；
- user-facing review summary；
- deterministic merge + optional agent summary 的边界；
- stale readiness invalidation when design version changes。

不包含：

- reviewer role prompt；
- full reviewer pack；
- reviewer selection / retry mechanics；
- design artifact mutation；
- automatic revision loop；
- design approval automation。

依赖：

- `design-review-panel`。
- `design-reviewer-role-pack` 可选但 recommended；Spec 5.3 应能处理 minimal、full、custom subset 和 incomplete review result set。
- `design-review-execution-control`。

#### Spec 5.4: `design-revision-loop`

建议路径：

```text
specs/design-revision-loop/design.md
```

定位：根据 blocking findings 和 unresolved questions 驱动受控 design revision loop。该 spec 使用 Spec 4 的 brainstorming/design reviser 基础和 Spec 5/5.3 的 review outputs 生成新版 `design.md`，然后重新绑定新 artifact version 并重新 review。它不能自动 approve design，且必须有 max revision/review rounds 和用户问题回退机制。

包含：

- `DesignRevisionRequest` schema；
- design-reviser role integration；
- revision prompt/system prompt；
- revised design output schema；
- artifact commit request for new design version；
- stale review invalidation；
- max revision rounds / max review rounds；
- unresolved user question handling；
- blocked recovery semantics；
- review-after-revision loop；
- revision ledger / event integration。

不包含：

- reviewer role pack；
- advanced triage 规则重新设计；
- plan review；
- plan regeneration；
- execution；
- automatic design approval。

依赖：

- `design-review-panel`。
- `design-review-triage-and-readiness`。
- `design-review-execution-control`。
- `skill-phase-adapters` 中的 brainstorming adapter / design reviser foundation。
- `agent-execution-runtime`。

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

#### Spec 7: `workflow-ux-interface`

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
- design full review reviewer selection 展示，包括默认全选、选择一个或多个 reviewer、展示 reviewer role 说明和 exact design artifact binding；
- partial / incomplete review 状态展示，包括 selected / unselected / succeeded / failed reviewer coverage；
- failed reviewer retry 交互，包括只重试失败 reviewer、重新选择 reviewer set、退出或查看 ledger/status；
- accept incomplete review 交互，包括明确提示 incomplete coverage、失败 reviewer 列表、已聚合 findings，以及用户显式确认后才允许进入 design approval gate；
- approval decision 展示；
- review summary 展示；
- blocked/failed recovery hints；
- optional future Pi tool interface。

不应把 `--approve design`、`--approve plan`、`--review --mode` 等细粒度命令作为默认主路径；它们最多是未来高级快捷方式或自动化 API。

依赖：

- `workflow-runtime-orchestrator`。
- `design-review-execution-control`，用于 reviewer selection、partial retry 和 accept incomplete review 的完整交互；基础 UX 可先定义 extension slots，待 Spec 5.2 后增强。
- 可在 review panels 之前先做基础 UX，后续再增强展示。

#### Spec 8: `workflow-tui-live-progress`

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
- `design-review-panel` / `plan-review-panel` 的 reviewer status schema，以及 controlled execution 的 task progress schema。
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
If full, user may also select reviewer subset for the current design version
  ↓
DesignReviewPanel reviews design, or review is explicitly skipped by user decision
  ↓
Successful reviewer findings enter aggregation; failed reviewer attempts remain retryable
  ↓
If review is incomplete, user may retry failed reviewers or explicitly accept incomplete review
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
Controlled SpecExecPhaseAdapter executes approved tasks/checkpoints
  ↓
Runtime records execution report
  ↓
Runtime marks workflow done or blocked
```

第一阶段落地时，review panels 可以分层演进：

```text
DesignReviewPanel foundation: user-selected skip/minimal/full，minimal 走真实 review run + finding schema + ledger，full 可显式 unavailable，后续由 Spec 5.1 实现五角色 role pack，并由 Spec 5.2 增强 reviewer selection、partial retry 和 accept incomplete review
PlanReviewAdapter: user-selected skip or minimal
Controlled SpecExecAdapter: code-owned task loop with per-task evidence and blockers
```

`skipped` 必须来自用户显式选择或明确策略记录，不能是隐式 no-op。`full` unavailable 必须是显式 capability 状态和事件，不能静默降级为 `minimal` 或 `skip`。Design/plan review 节点必须保留；execution correctness 则内嵌在 controlled task loop、checkpoint tasks、evidence validation 和 blocker escalation 中，不再设置默认终局 execution-review 节点。

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

- design review run 绑定 exact design artifact version/checksum。
- `minimal` review 使用统一 finding schema、aggregation 和 ledger。
- `full` review 在 role pack 未实现时显式返回 unavailable，且不能静默降级。
- 多 reviewer 并发执行。
- full reviewer role pack 默认执行完整五角色集合。
- reviewer selection、partial aggregation、failed reviewer retry 和 accept incomplete review 的 execution-control 行为。
- findings aggregation。
- conflicting reviews triage。
- blocking issue 阻止 approval readiness。
- revision loop 最大轮次。

### End-to-end tests

- start → design → awaiting design review decision → choose review mode → design review/skipped → design approval → plan → awaiting plan review decision → choose review mode → plan review/skipped → plan approval → controlled exec → done。
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

1. `brainstorming-pro`、`spec-plan-pro`、`spec-exec-pro` phase adapter 应直接调用内部模块，还是通过 isolated child Pi process 调用？
2. Multi-agent review 的默认 reviewer 数量和角色是否可配置？Spec 5.2 已确认 design review 应支持用户选择 reviewer subset；默认值、快捷选项和 UX 细节仍需在该 spec / Spec 7 中细化。
3. Spec 5.2 中 failed reviewer retry 应复用同一 review run 追加 attempts，还是创建 linked retry run？
4. Spec 5.2 中 accept incomplete review 的 decision/ref/event schema 应如何绑定 failed reviewer coverage，才能避免被误认为完整 review passed？
5. `design-review-triage-and-readiness` 中 advanced triage 应采用多大比例的 deterministic merge 与 optional agent summary？
6. `design-revision-loop` 中哪些 blocking findings 可以自动修订，哪些必须先询问用户？
7. Plan review failed 后是否自动重新生成 tasks？
8. Controlled execution blocked 后应如何通过 `--resume` 选择 retry、abort、处理 missing dependency 或请求 plan revision？
9. 是否需要 background async runner？如果需要，应在 workflow runtime 稳定后单独设计。
10. 是否公开 Pi tool interface？如果公开，如何避免父 LLM 绕过 workflow command/gate？
11. 是否支持从 `events.jsonl` 自动重建损坏的 `state.json`？

Planning 和 execution 行为必须通过 runtime phases/adapters 暴露，并由 `/brainstorm-pro` runtime 统一触发、校验和持久化。

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
4.1 controlled-spec-exec-adapter
   ↓
5. workflow-ux-interface minimal
   ↓
6. workflow-tui-live-progress minimal
   ↓
7. design-review-panel foundation
   ↓
7.1 design-reviewer-role-pack
   ↓
7.2 design-review-execution-control
   ↓
7.3 design-review-triage-and-readiness
   ↓
7.4 design-revision-loop
   ↓
8. plan-review-panel
   ↓
9. workflow-ux-interface / workflow-tui-live-progress polish
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
