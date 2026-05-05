# Brainstorming Pro 执行流程说明

本文面向不熟悉 TypeScript 和 pi extension 机制的读者，解释 **Brainstorming Pro** 从“用户输入命令”到“生成 clarification 结果并交给 `spec-plan`”的完整执行过程。

相关代码位置：

- `extensions/clarification-orchestrator/index.ts`：扩展入口，注册命令。
- `extensions/clarification-orchestrator/commands/*.ts`：命令处理器。
- `extensions/clarification-orchestrator/workflow.ts`：工作流状态机。
- `extensions/clarification-orchestrator/phases/*.ts`：各阶段实现。
- `extensions/clarification-orchestrator/runner.ts`：子 agent 进程执行。
- `extensions/clarification-orchestrator/artifact-store.ts`：运行目录、状态和工件写入。
- `extensions/clarification-orchestrator/user-gate.ts`：用户决策门。
- `extensions/clarification-orchestrator/progress.ts`、`execution-log.ts`、`debug-artifacts.ts`：进度、日志、调试工件。

---

## 1. 先理解：pi extension 是什么

pi 的扩展是一个 TypeScript 模块。它不是普通“脚本”，而是会被 pi 在启动时加载，然后通过 `ExtensionAPI` 注册：

- **命令**：例如 `/clarify`
- **事件监听**：例如 `session_start`、`tool_call`
- **工具**：让 LLM 可调用的自定义工具
- **快捷键/标志**：CLI 或 UI 控制

在本项目中，Brainstorming Pro 主要使用的是 **命令** 模式，而不是在聊天里直接监听很多事件。

入口文件是：

```ts
extensions/clarification-orchestrator/index.ts
```

它会在 pi 加载扩展时执行，向 pi 注册：

- `/clarify`
- `/clarify-status`
- `/clarify-diff`
- `/clarify-clean`

换句话说：**用户输入命令 → pi 找到对应 command handler → handler 进入我们自己的工作流代码**。

---

## 2. 资源是怎么被 pi 发现的

这个项目是一个 pi package。`package.json` 里的 `pi` 字段声明了资源路径：

```json
{
  "pi": {
    "extensions": ["./extensions/clarification-orchestrator"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

这意味着 pi 启动时会发现：

- 扩展代码：`extensions/clarification-orchestrator/`
- skill：`skills/brainstorming-pro/SKILL.md`
- prompt 模板：`prompts/*.md`

另外，`agents/*.md` 不是 pi 核心自动发现的资源，所以本项目在扩展里自己实现了 agent discovery。

---

## 3. 用户输入 `/clarify` 后发生什么

### 3.1 命令进入 `handleClarifyCommand`

当用户输入：

```bash
/clarify My Topic --mode hybrid --reviewers product,architecture
```

pi 会把命令交给：

```ts
extensions/clarification-orchestrator/commands/clarify.ts
```

这里的步骤大致是：

1. 解析参数
2. 规范化 topic
3. 读取配置
4. 创建 clarification run
5. 决定是 dry-run、resume，还是正常执行
6. 启动 workflow

---

## 4. 参数解析：把字符串变成结构化配置

`parseClarifyArgs()` 在 `options.ts` 里。

它把一整串命令文本拆成对象，例如：

```ts
{
  topic: "My Topic",
  mode: "hybrid",
  maxRounds: 2,
  threshold: "P1",
  reviewers: ["product", "architecture", "risk", "testing"],
  resume: false,
  verbose: false,
  dryRun: false
}
```

这一步很重要，因为后续流程不再依赖原始字符串，而是依赖 **结构化数据**。

好处：

- 错误更早暴露
- 不用在每个阶段重新解析字符串
- 单元测试更容易
- 后续状态写入 `state.json` 时也更稳定

如果参数无效，比如：

- 缺少 topic
- `--mode` 不是合法值
- `--max-rounds` 不是数字
- `--threshold` 非法

命令会直接报错并停止，不会开始写流程工件。

---

## 5. topic 规范化：为什么要把主题变成 slug

用户输入的 topic 是给人看的，不一定适合做文件名。

例如：

```text
Improve login flow
```

会被规范化为类似：

```text
improve-login-flow
```

这在 `path-guard.ts` 里完成。

它的职责包括：

- 保留原始显示名 `displayName`
- 生成安全 slug
- 拒绝路径穿越、绝对路径、`..`
- 限制极端情况导致的非法路径

最终会得到一个 `TopicInfo`，其中包括：

- `displayName`
- `slug`
- `specDir`
- `designPath`
- `clarificationDir`

这些路径最终都会落到：

```text
specs/<slug>/...
```

---

## 6. 配置加载：默认值 + 用户配置 + 项目配置 + 命令覆盖

配置逻辑在 `config.ts`。

加载顺序是：

1. bundled defaults
2. `~/.pi/agent/brainstorming-pro/config.json`
3. `<project>/.pi/brainstorming-pro/config.json`
4. `<project>/.pi/brainstorming-pro/config.local.json`
5. 命令行参数覆盖

这意味着：

- 用户可以在全局设置里定义默认模型、重试策略、debug 开关
- 项目可以局部覆盖
- 单次命令也能临时修改

但是项目级别的敏感配置不会被“无脑信任”。

如果项目想启用：

- project-local agents
- 更宽的 tool 权限
- raw debug artifacts

这些都会触发确认逻辑，避免项目文件偷偷扩大权限。

---

## 7. 创建 run：每次 clarification 都有独立运行目录

新运行由 `artifact-store.ts` 里的 `createRun()` 创建。

它会创建一个新的 run ID，例如：

```text
run-20260504-142613
```

并生成：

- `current.json`
- `current` symlink（如果系统支持）
- `state.json`
- `debug/` 目录

目录结构大致像这样：

```text
specs/my-topic/clarification/
  current.json
  current -> run-...
  run-20260504-142613/
    state.json
    execution.log.json
    execution.log.txt
    ...
```

`current.json` 用来快速找到当前活跃 run；`state.json` 是 canonical 状态。

---

## 8. 工作流的核心：`workflow.ts`

### 8.1 工作流不是“一个大函数”，而是状态机

`workflow.ts` 定义了 `ClarificationWorkflow`。

它负责：

- 维护 phase 顺序
- 触发每个阶段
- 保存和恢复状态
- 判断是否终止

主要阶段包括：

- `INIT`
- `DISCOVERY`
- `INITIAL_DESIGN`
- `REVIEW`
- `TRIAGE`
- `USER_DECISION`
- `REFINE`
- `VERIFY`
- `FINAL_APPROVAL`
- `COMPLETE`

### 8.2 为什么要先写状态，再执行阶段

这是为了可恢复性。

如果中途崩溃或取消，`state.json` 仍然能告诉我们：

- 当前阶段到哪一步了
- 哪些工件已经写出
- 哪些决定待处理
- 哪些错误发生过
- 是否可以 resume

也就是说：**状态先行，行为后续**。

---

## 9. 各阶段具体做什么

### 9.1 Discovery：先让 designer 产出初稿

文件：

```ts
extensions/clarification-orchestrator/phases/discovery.ts
```

做的事：

1. 设置 phase = `DISCOVERY`
2. 组装 prompt
3. 启动 designer 子 agent
4. 校验结构化输出
5. 写入：
   - `01-discovery.md`
   - `01-discovery.json`
   - `design.md`
   - `02-design-v1.md`
6. 更新 state

如果 designer 持续失败，整个 workflow 会终止，因为没有初始 design，后面无法继续。

### 9.2 Review：多个 reviewer 并发审查

文件：

```ts
extensions/clarification-orchestrator/phases/review.ts
```

做的事：

- 同时跑多个 reviewer
- 每个 reviewer 只产出独立 findings，不允许改 design
- 结果写成 review JSON / markdown
- 更新 reviewer 状态

这里会用到 `concurrency.ts`，限制 reviewer 并发数。

### 9.3 Triage：把多个 reviewer 结果合并成 canonical issues

文件：

```ts
extensions/clarification-orchestrator/phases/triage.ts
```

做的事：

- 把 reviewer 输出视为 untrusted data
- 去重
- 统一 issue ID
- 校验依赖/冲突
- 写 triage 工件
- 把待决 issue 写进 `pendingDecisions`

这个阶段输出的是更“规范”的问题列表，后续决策门使用它。

### 9.4 User Decision：用户决定哪些 issue 采纳

文件：

```ts
extensions/clarification-orchestrator/user-gate.ts
```

这里实现了三种模式：

- `manual`
- `hybrid`
- `auto`

区别大致是：

- **manual**：大部分问题都让用户决定
- **hybrid**：只让高优先级/高风险问题打断用户
- **auto**：低风险问题自动处理，冲突/高风险/歧义时才打断

如果 `ctx.hasUI === false`：

- manual / hybrid 会停止
- 写 `pending-decisions.md`
- 更新状态
- 给出 resume 指令

### 9.5 Refine：只把采纳的决策送给 refiner

文件：

```ts
extensions/clarification-orchestrator/phases/refine.ts
```

做的事：

- 只传递 accepted decisions
- 明确拒绝/延后项不应成为当前需求
- refiner 返回结构化 revisedDesign + changeLog
- orchestrator 自己写 `design.md`

这一步很关键：

> refiner 不直接写文件，只有 orchestrator 写文件。

这样可以保证写入边界和安全性。

### 9.6 Verify：检查采纳项是否真的落在 design 中

文件：

```ts
extensions/clarification-orchestrator/phases/verify.ts
```

做的事：

- verifier 检查每个 accepted issue
- 每项必须有 verification result
- 结果分类为 completed / partially-completed / missing / over-implemented
- 写 verification 工件

如果发现缺失的 P0/P1 项，并且还没到 `maxRounds`，工作流可以回到 refine 进行定向修复，而不是重新大范围复审。

### 9.7 Final Approval：最终确认并 handoff 到 spec-plan

文件：

```ts
extensions/clarification-orchestrator/phases/final-approval.ts
```

它会：

- 生成最终 summary
- 显示 design 路径
- 显示 verification 状态
- 显示 unresolved risks / skipped phases
- 告知下一步手动运行 `spec-plan`
- 明确 **不会自动调用 spec-plan**

---

## 10. 子 agent 是怎么运行的

子 agent 执行逻辑在：

```ts
extensions/clarification-orchestrator/runner.ts
```

核心思想：**每个子 agent 都是一个独立的 `pi` 子进程**。

### 10.1 `runSubagent()` 做了什么

它会：

1. 选择模型
2. 计算工具列表
3. 组装 prompt
4. 调用 `spawnPiProcess()`
5. 捕获 stdout / stderr
6. 解析 JSON 输出
7. 校验 schema
8. 必要时进行一次 repair pass
9. 返回结构化结果

### 10.2 为什么要启动独立进程

这样做的好处是：

- 每个 agent 有独立上下文
- 互相不会污染状态
- 可以单独设置模型、工具、超时
- 可以失败重试
- 可以记录 raw output 和 debug artifact

### 10.3 为什么要设置 `BRAINSTORMING_PRO_SUBAGENT=1`

这是为了防止递归：

- 子 agent 自己再触发 Brainstorming Pro 主流程
- 造成无限嵌套

因此子进程环境里会带这个标记。

---

## 11. 为什么需要 schema 校验

LLM 输出本质上不稳定，所以所有结构化结果都必须校验。

相关文件：

- `schemas.ts`
- `validation.ts`

比如：

- reviewer 输出必须符合 `ReviewerOutputSchema`
- triager 输出必须符合 `TriageOutputSchema`
- refiner 输出必须符合 `RefinerOutputSchema`
- verifier 输出必须符合 `VerifierOutputSchema`

如果第一次不符合：

1. 收集 validation error
2. 生成 repair prompt
3. 再让模型修正一次
4. 仍失败则走阶段失败逻辑

这就是“**one repair pass**”的思路。

---

## 12. 状态、日志、调试工件分别是什么

### 12.1 `state.json`

这是 canonical 状态。

它保存：

- 当前 phase
- round
- accepted/rejected/deferred issue IDs
- verification 结果
- 错误
- 已完成工件
- 执行摘要

status/resume 主要看它，不依赖 markdown。

### 12.2 `execution.log.json` / `execution.log.txt`

这是执行日志：

- 阶段开始/结束
- agent run
- retry
- model info
- usage metadata

用于排查性能、成本和失败点。

### 12.3 debug/ 目录

里面存放：

- 输入 prompt
- 原始输出
- 解析失败原因
- 修复后的输出
- prompt hash

可配置：

- `enabled`
- `redacted`
- `disabled`

如果可能包含敏感内容，默认会 redacted 或关闭。

---

## 13. 为什么要有 progress reporter

长工作流需要可视化反馈。

`progress.ts` 会输出：

- 当前 phase
- 当前 activity
- reviewer 状态
- 已完成工件数
- pending decisions
- 恢复提示

这样用户不会面对“卡住了但不知道卡在哪”的情况。

---

## 14. diff / clean / status 是怎么工作的

### 14.1 `/clarify-status`

读取：

- `current.json`
- `state.json`

然后显示：

- run id
- 当前阶段
- 进度
- 工件数
- pending decisions
- 错误
- resume 指令

### 14.2 `/clarify-diff`

比较两个 run：

- design 是否变化
- issues 增删
- decisions 增删

如果不指定 run id，就比较当前 run 和上一个 run。

### 14.3 `/clarify-clean`

根据保留策略删除旧 run，但保护：

- 当前 run
- 最近的两个 run

支持：

- `--dry-run`
- `--keep N`

---

## 15. 安全边界

这是这个项目很重要的一部分。

### 15.1 untrusted data

以下内容都视为不可信：

- 项目文件
- project-local config
- project-local agents/prompts/skills/extensions
- subagent 输出

### 15.2 为什么要包起来

下游 prompt 会把这些内容包在：

```xml
<untrusted-data> ... </untrusted-data>
```

并明确告诉模型：不要把里面的指令当作要执行的命令。

### 15.3 为什么要限制写入和删除

防止：

- 路径穿越
- 写出到项目外
- 误删非目标目录

所以 artifact 写入和清理都做了路径约束。

---

## 16. 最终用户视角：一次完整执行长什么样

从用户角度，最常见的完整过程是：

1. 输入 `/clarify <topic>`
2. 解析参数、规范 topic
3. 读取配置
4. 创建 clarification run
5. designer 生成初始 design
6. reviewers 并发审查
7. triager 规范化问题
8. 用户在决策门接受/拒绝/延后
9. refiner 根据 accepted items 修改 design
10. verifier 检查修改是否到位
11. 若仍有缺失且没到 maxRounds，则定向 refine
12. 最终审批
13. 用户手动运行 `spec-plan`

如果中途崩溃或取消：

- `state.json` 还在
- `interrupted.md` 会记录恢复信息
- `/clarify --resume` 可接着走

---

## 17. 用一句话理解整个系统

你可以把 Brainstorming Pro 理解成：

> 一个由 pi extension 驱动的、带状态持久化、带子进程隔离、带用户决策门和恢复机制的 clarification 工作流引擎。

它不是“一个 prompt”，而是一整套流程编排系统。

---

## 18. 对照源码阅读顺序

如果你想按“最容易懂”的顺序读代码，建议这样看：

1. `README.md`（整体概览）
2. `extensions/clarification-orchestrator/index.ts`（入口）
3. `commands/clarify.ts`（命令入口）
4. `options.ts`（参数解析）
5. `path-guard.ts`（路径安全）
6. `artifact-store.ts`（状态与工件）
7. `workflow.ts`（状态机）
8. `phases/discovery.ts` → `review.ts` → `triage.ts` → `refine.ts` → `verify.ts` → `final-approval.ts`
9. `runner.ts`（子 agent 如何执行）
10. `user-gate.ts`（人机决策）
11. `progress.ts` / `execution-log.ts` / `debug-artifacts.ts`
12. `quality-gates.ts`（质量和安全校验）

---

如果你愿意，我还可以继续帮你写一份：

- **“从 `/clarify` 命令到最终设计文件的时序图版说明”**
- 或者 **“按文件逐个解释每个 TypeScript 模块在干什么”**
