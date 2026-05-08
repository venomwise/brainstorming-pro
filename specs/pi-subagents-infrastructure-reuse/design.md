# pi-subagents 基础设施复用设计

## Summary

本设计定义 Brainstorming Pro 如何复用 `nicobailon/pi-subagents` 中成熟且业务逻辑无关的基础设施代码。目标是吸收其在 Pi 子进程启动、live progress、TUI rendering、snapshot 更新、formatting、atomic write、JSONL、output handling 等方面的生产实践，同时避免继承其通用 `subagent` tool、arbitrary chain/async orchestration、intercom 和 builtin agent product model。复用策略采用“基础设施可复用，产品抽象不继承”：所有引入代码都必须重新包装到 Brainstorming Pro 的 workflow runtime、agent execution runtime 和 UI snapshot layer 中，并保持 approval gates 与 workflow 状态机由代码强制。

## Goals

- 系统性评估 `pi-subagents` 中可复用的业务无关代码。
- 降低 Brainstorming Pro 在 TUI、progress snapshot、subagent launch、output handling 等基础设施上的重复造轮子成本。
- 保留 `pi-subagents` 已经验证过的稳定性实践：
  - foreground child process lifecycle；
  - prompt/system prompt 文件化；
  - child env metadata；
  - recursion guard；
  - progress snapshot；
  - compact / expanded TUI；
  - spinner animation；
  - stale context cleanup；
  - width-aware rendering；
  - atomic/jsonl 文件写入。
- 明确哪些代码可直接 vendoring、哪些需要改造、哪些只能参考、哪些明确不复用。
- 保证复用不会引入 `pi-subagents` 的通用委派产品模型。
- 建立 license / attribution / upstream sync 策略。
- 为后续 `agent-execution-runtime`、`workflow-tui-live-progress`、`workflow-ux-interface` 等 spec 提供基础约束。

## Primary Users / Roles

- **Brainstorming Pro maintainer**：希望复用成熟基础设施，同时保持 Brainstorming Pro 的 workflow-first 架构。
- **Implementation agent**：需要清晰知道哪些 `pi-subagents` 文件可以参考或迁移，迁移后应如何命名、裁剪和测试。
- **Security reviewer**：需要确认复用代码不会引入 generic subagent tool、绕过 approval gates 或扩大子进程能力边界。
- **UI designer / implementer**：需要复用 `pi-subagents` 的 TUI rendering、live widget、compact/expanded view 和 animation lifecycle 经验。
- **Future upstream sync maintainer**：需要知道 derived code 的来源、改动和同步策略。

## Non-Goals

- 不把 `pi-subagents` 作为整体 runtime 依赖直接嵌入 Brainstorming Pro。
- 不复制或公开 `pi-subagents` 的 generic `subagent` tool。
- 不继承 arbitrary `single` / `parallel` / `chain` / `async` product model 作为 Brainstorming Pro 顶层抽象。
- 不引入 `pi-subagents` 的 intercom 能力。
- 不直接复用 `pi-subagents` builtin agents 或 agent discovery 业务模型。
- 不实现 background async runner；如未来需要，应单独 spec。
- 不允许复用代码绕过 Brainstorming Pro 的 workflow state machine、approval gates、topic/path safety 和 config security policy。

## Context

`nicobailon/pi-subagents` 是一个成熟的 Pi subagent extension，提供：

```text
父 Pi 会话
  → generic subagent tool
  → single / parallel / chain / async child agents
  → foreground/background progress UI
  → result/status/notification
```

Brainstorming Pro 的长期目标不同：

```text
复杂需求输入
  → workflow runtime 强制生命周期
  → brainstorming / design review / planning / execution phases
  → design 和 plan approval gates
  → 多 Agent 交叉评审
  → 稳定实现
```

因此，`pi-subagents` 不能被当作完整产品模型复用。但其中许多基础设施与业务无关，尤其是：

- TUI rendering；
- live progress snapshot；
- Pi 子进程启动和 args/env 设计；
- output collection / truncation；
- atomic/jsonl file helpers；
- formatting utilities；
- stale UI context cleanup；
- foreground child lifecycle。

`pi-subagents` 的 `package.json` 声明 license 为 MIT，因此从许可角度可以复制、修改和分发代码，但必须保留版权和 license notice。

## Discovery

### Key Discoveries

- `pi-subagents` 中最值得复用的不是 generic subagent tool，而是其底层基础设施和 TUI 经验。
- 其 TUI 层已经处理了许多容易被低估的细节：Unicode grapheme-safe truncation、ANSI-safe truncation、terminal width budget、compact/expanded rendering、spinner lifecycle、stale context cleanup。
- 其 live snapshot 设计用 versioned snapshot 驱动 UI 更新，能避免 UI 直接耦合执行逻辑，这与 Brainstorming Pro “UI 不是 truth source” 的原则一致。
- 其 foreground child process 实践与 Brainstorming Pro 新 agent execution runtime 方向一致：prompt 文件化、system prompt 文件化、`--no-session`、`--no-skills`、child env marker、depth guard。
- 其 background async、intercom、generic chain、public subagent tool 是产品逻辑，不应在 Brainstorming Pro 第一阶段继承。
- 如果没有单独的 reuse spec，后续 agent runtime 和 TUI spec 很可能重复造轮子，或者无意中复制过多 product semantics。

### Scope Decisions

包含：

- Reuse inventory。
- License / attribution policy。
- Vendoring / derived code 目录策略。
- Module mapping。
- Adaptation rules。
- Upstream sync policy。
- Tests strategy。
- 对后续 spec 的约束。

排除：

- 实现 agent execution runtime。
- 实现 workflow TUI。
- 实现 background async。
- 实现 generic subagent tool。
- 实现 review panels。

## Proposed Solution

采用三层复用策略：

```text
A. 小型纯工具模块：可直接 vendoring
B. 核心基础设施模块：复制后改造成 Brainstorming Pro internal runtime
C. 长期共享包：未来可考虑抽取，但不是第一阶段目标
```

推荐短期策略：

```text
B + 少量 A
```

即：

1. 对 formatter、render helper、atomic/jsonl writer 等小型通用模块，可直接 vendoring 并保留来源声明。
2. 对 TUI widget、live snapshot、Pi spawn、output handling 等核心基础设施，复制后改造成 Brainstorming Pro 内部模块，替换术语和状态模型。
3. 不直接依赖 `pi-subagents` extension package。
4. 不公开 generic `subagent` tool。
5. 不继承 async/intercom/product workflow。
6. 为所有 derived code 建立 attribution 和同步记录。

### Architecture

复用后的目标位置：

```text
extensions/clarification-orchestrator/
  vendor/
    pi-subagents/
      LICENSE
      NOTICE.md
      README.md
      ...small copied helpers if needed

  workflow/
    live-snapshot-store.ts
    progress-types.ts

  runtime/
    agent-execution/
      launch-spec.ts
      spawn.ts
      output.ts
      progress.ts

  tui/
    workflow-widget.ts
    workflow-result.ts
    render-helpers.ts
    formatters.ts
```

也可以选择：

```text
extensions/clarification-orchestrator/shared/pi-subagents-derived/
```

但无论目录如何，必须满足：

- derived files 标明来源；
- license notice 可追溯；
- Brainstorming Pro domain model 包装在外层；
- UI 和 execution runtime 都不直接依赖 `pi-subagents` 的 product types。

### Reuse Classification

#### 1. 可直接 vendoring 的模块

适合业务无关、小型、稳定的工具函数。

候选来源：

```text
src/tui/render-helpers.ts
src/shared/formatters.ts
src/shared/atomic-json.ts
src/shared/jsonl-writer.ts
src/shared/file-coalescer.ts
```

复用方式：

- 复制到 Brainstorming Pro vendor 或 shared derived 目录。
- 保留 MIT license / notice。
- 文件头注明来源 commit 或版本。
- 允许小幅命名调整。
- 添加本项目测试。

典型用途：

- duration formatting；
- token formatting；
- path shortening；
- width-aware row/header/footer rendering；
- atomic state write；
- event JSONL append。

#### 2. 复制后改造复用的模块

适合成熟但带有 `pi-subagents` product terminology 的基础设施。

候选来源：

```text
src/tui/render.ts
src/slash/slash-live-state.ts
src/shared/status-format.ts
src/shared/types.ts
src/runs/shared/pi-args.ts
src/runs/shared/pi-spawn.ts
src/runs/shared/model-fallback.ts
src/runs/shared/single-output.ts
src/runs/shared/completion-guard.ts
src/runs/shared/long-running-guard.ts
src/shared/artifacts.ts
src/shared/temp-paths.ts
```

改造方向：

```text
SubagentProgress      → AgentRunProgress / ReviewerProgress
AsyncJobState         → WorkflowProgressSnapshot / WorkflowRunSnapshot
SingleResult          → AgentRunResultSnapshot
chain/parallel labels → phase/reviewer panel labels
subagent result       → workflow phase result / reviewer result
```

必须移除或替换：

- generic subagent mode；
- arbitrary chain semantics；
- public tool assumptions；
- background async job as truth source；
- intercom references；
- bundled subagent agent assumptions。

#### 3. 仅参考、不直接复制的模块

候选来源：

```text
src/extension/index.ts
src/slash/slash-commands.ts
src/slash/slash-bridge.ts
src/slash/prompt-template-bridge.ts
src/runs/background/*
src/agents/*
agents/*.md
src/intercom/*
```

原因：

- 与 `pi-subagents` 产品模型强绑定。
- 包含 public generic `subagent` tool。
- 包含 arbitrary chain/async/background 状态模型。
- 包含 agent discovery 和 builtin role 逻辑。
- 容易污染 Brainstorming Pro workflow-first 架构。

可以参考的点：

- extension lifecycle cleanup；
- stale context handling；
- slash result component pattern；
- status/notification 展示经验；
- child registration guard 思路；
- async architecture 的未来可选方向。

#### 4. 明确不复用的能力

- Generic public `subagent` tool。
- Intercom。
- Background async runner 第一阶段实现。
- Builtin subagent roles。
- Agent selection product model。
- Runtime extension injection product semantics。
- Arbitrary user-defined chain orchestration。

### Module Mapping

建议映射表：

| pi-subagents 来源 | Brainstorming Pro 目标 | 复用方式 |
| --- | --- | --- |
| `src/tui/render-helpers.ts` | `tui/render-helpers.ts` | 直接 vendoring 或轻改 |
| `src/shared/formatters.ts` | `tui/formatters.ts` 或 `shared/formatters.ts` | 直接 vendoring 或轻改 |
| `src/tui/render.ts` | `tui/workflow-widget.ts`, `tui/workflow-result.ts` | 改造复用 |
| `src/slash/slash-live-state.ts` | `workflow/live-snapshot-store.ts` | 改造复用 |
| `src/shared/status-format.ts` | `workflow/status-format.ts` | 改造复用 |
| `src/runs/shared/pi-args.ts` | `runtime/agent-execution/launch-spec.ts` | 改造复用 |
| `src/runs/shared/pi-spawn.ts` | `runtime/agent-execution/spawn.ts` | 改造复用 |
| `src/runs/shared/single-output.ts` | `runtime/agent-execution/output.ts` | 改造复用 |
| `src/shared/atomic-json.ts` | `workflow/atomic-json.ts` | 直接 vendoring 或轻改 |
| `src/shared/jsonl-writer.ts` | `workflow/events.ts` helper | 直接 vendoring 或轻改 |
| `src/shared/artifacts.ts` | `workflow/artifact-store.ts` helper | 改造复用 |
| `src/extension/index.ts` | 无直接目标 | 仅参考 |
| `src/runs/background/*` | future background spec | 仅参考 |
| `src/intercom/*` | 无第一阶段目标 | 不复用 |

### License and Attribution Policy

因为 `pi-subagents` 使用 MIT license，复用代码必须遵循：

1. 在 Brainstorming Pro 仓库保留 `pi-subagents` 的 MIT license notice。
2. 新增：

```text
extensions/clarification-orchestrator/vendor/pi-subagents/LICENSE
extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md
```

3. `NOTICE.md` 记录：

```text
This project includes code derived from nicobailon/pi-subagents.
Source: https://github.com/nicobailon/pi-subagents
License: MIT
Imported version/commit: <commit>
Imported modules: <list>
Local modifications: <summary>
```

4. 每个 derived file 文件头包含：

```ts
// Derived from nicobailon/pi-subagents (<commit>, MIT License).
// Adapted for Brainstorming Pro workflow runtime semantics.
```

5. 如果某个文件重写程度很高，也仍应在 commit 和 NOTICE 中说明参考来源。

### Adaptation Rules

所有复用代码必须遵循以下规则：

#### Rule 1: Workflow-first terminology

避免把 `subagent` product terminology 暴露到 Brainstorming Pro 顶层 API。

内部可用：

```text
AgentRun
ReviewerRun
PhaseRun
WorkflowProgress
WorkflowSnapshot
```

避免顶层使用：

```text
AsyncJobState
SubagentParams
SubagentResult
ChainStep
```

除非是低层 compatibility 类型，且不出现在 public interface。

#### Rule 2: UI snapshot is not source of truth

UI snapshot 只能从 runtime state/progress events 派生。

```text
state.json + events.jsonl + in-memory progress
  → WorkflowLiveSnapshot
  → TUI render
```

TUI 不得直接推进 workflow，也不得批准 gate。

#### Rule 3: No gate bypass

任何复用的 execution 或 progress code 都不能绕过：

- design approval gate；
- plan approval gate；
- topic/path validation；
- artifact version matching；
- config security policy。

#### Rule 4: No generic orchestration inheritance

不能从 `pi-subagents` 继承 arbitrary chain/parallel/async 作为用户可见能力。

Brainstorming Pro 的并发只允许由 workflow-defined review panels 触发，例如：

```text
DesignReviewPanel runs product/architecture/risk/testing reviewers
```

而不是用户自由传入任意 chain。

#### Rule 5: Keep child process boundary strict

从 `pi-subagents` 复用 Pi spawn 思路时，Brainstorming Pro 仍必须保留自身安全默认：

- `PI_COMMAND` 是单一 executable path override；
- provider-qualified model validation；
- `--no-session` 默认；
- `--no-skills` 默认；
- child env marker；
- depth guard；
- child 不注册 Brainstorming Pro commands；
- project-local tools/agents 默认不信任。

#### Rule 6: Preserve non-TUI fallback

所有 UI 复用都必须提供 non-TUI fallback。非交互环境中仍应输出可读 markdown/text status。

### Data Flow

复用基础设施后的典型 flow：

```text
Workflow Runtime starts phase
  ↓
AgentExecutionRuntime emits progress events
  ↓
WorkflowLiveSnapshotStore applies versioned updates
  ↓
TUI widget renders compact phase/reviewer progress
  ↓
User presses expand key / tools expanded mode enabled
  ↓
TUI renders detailed current tool/recent output/output path
  ↓
Phase completes
  ↓
Runtime commits artifacts/events/state
  ↓
TUI renders approval card or next phase progress
```

对于 design review panel：

```text
DesignReviewPanel starts 5 reviewer runs
  ↓
Each reviewer produces AgentRunProgress
  ↓
Snapshot store aggregates reviewer statuses
  ↓
Widget shows:
  Product Reviewer       running / completed
  Architecture Reviewer  running / completed
  Risk Reviewer          blocked / finding count
  Testing Reviewer       pending / running
  Scope Reviewer         completed
  ↓
Triage phase starts after reviewers finish
  ↓
Approval card appears when review/revision complete
```

## Error Handling

### License notice missing

如果 derived code 存在但 license/notice 文件缺失：

```text
validate-package should fail
```

### Unsupported product semantics detected

如果复用代码暴露 generic subagent tool、async job command、intercom 或 arbitrary chain public API：

```text
security/unit tests should fail
```

### UI snapshot corruption

如果 live snapshot 更新失败：

```text
TUI degrades to status text
workflow state remains unaffected
error event may be appended if runtime-observable
```

### Stale UI context

沿用 `pi-subagents` stale context cleanup 思路：

```text
catch known stale context errors
stop animation timer
clear latest ctx reference
avoid crashing workflow
```

### Spawn helper mismatch

如果复用 spawn helper 与 Brainstorming Pro 安全策略冲突，例如允许 shell command parsing：

```text
reject at adaptation review
do not import helper directly
wrap or rewrite to satisfy Brainstorming Pro policy
```

### Upstream sync conflict

如果后续从 `pi-subagents` 同步代码导致 API 或行为变化：

```text
record sync commit
run derived module tests
run workflow safety tests
manual review required for product-semantics leakage
```

## Testing

### Reuse inventory tests

- 确认 derived files 有来源注释。
- 确认 vendor license/notice 文件存在。
- 确认 package validation 检查 attribution。

### TUI helper tests

- ANSI-safe truncation。
- Unicode/emoji width handling。
- narrow terminal rendering。
- compact/expanded line budget。
- spinner animation lifecycle。
- stale context cleanup。
- non-TUI fallback。

### Live snapshot tests

- initial workflow snapshot。
- phase progress update。
- reviewer progress update。
- version increments。
- final snapshot restore。
- snapshot update failure 不影响 workflow state。

### Agent execution adaptation tests

- prompt file/system prompt file args。
- `--no-session` / `--no-skills`。
- child env metadata。
- depth guard。
- timeout/retry/output limit。
- output truncation artifact。
- no shell parsing for `PI_COMMAND`。

### Product boundary tests

- 不注册 generic `subagent` tool。
- 不暴露 arbitrary chain/parallel/async public API。
- 不引入 intercom。
- child process 不能注册 Brainstorming Pro workflow commands。
- phase adapter 不能绕过 approval gates。

### Regression tests from upstream

对于直接 vendoring 或高度相似的模块，应尽可能移植 `pi-subagents` 中对应 unit tests，并补充 Brainstorming Pro domain-specific tests。

## Open Questions

- 是否将 vendored helpers 放在 `vendor/pi-subagents/`，还是放在 `shared/pi-subagents-derived/`？推荐实现时根据 import ergonomics 决定，但 license/notice 必须集中可见。
- 是否在 `validate-package` 中强制扫描 derived file header？推荐做。
- 是否记录 imported upstream commit？推荐做，即使初期只记录 tag/version。
- 是否未来推动通用 TUI/progress helpers 抽成独立 npm 包？这是长期选项，不阻塞本阶段。
- 是否允许直接依赖 `pi-subagents` npm package？当前建议不允许，避免 product semantics 和 extension lifecycle 耦合。

## Recommended Implementation Order

1. 确认 upstream version/commit 和 license text。
2. 创建 vendor/notice 目录。
3. 建立 reuse inventory markdown 或 JSON manifest。
4. 迁移小型 formatter/render helper/atomic writer。
5. 为 derived helpers 添加测试。
6. 在 `agent-execution-runtime` 中按适配规则迁移 spawn/output/progress 思路。
7. 在 `workflow-tui-live-progress` 中按适配规则迁移 widget/snapshot/render 思路。
8. 添加 package validation，确保 attribution 和 product boundary。
