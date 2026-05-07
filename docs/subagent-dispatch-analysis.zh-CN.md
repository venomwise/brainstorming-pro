# SubAgent 调度机制分析：`nicobailon/pi-subagents` 参考

本文记录对 [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) 的调度机制分析，用于后续评估和改进 Brainstorming Pro 当前 subAgent 调度实现。

分析基于仓库提交：`3ee17de53d1a430b71519889741569c3991f99b7`。

---

## 1. 核心结论

`pi-subagents` 的核心设计不是在当前 Pi 会话中直接调用一个“子 Agent 函数”，而是：

> 父会话注册一个 `subagent` 工具；真正执行时启动新的 Pi 子进程；父进程只负责调度、状态跟踪、结果聚合和防递归。

整体模型可以概括为：

```text
父调度
  → 子执行
  → 进程隔离
  → 显式上下文
  → 文件化状态
  → 防递归
```

对当前项目最有价值的启发是：**调度权应集中在父流程，子 Agent 只执行明确任务，不应继续拥有完整调度能力。**

---

## 2. 执行过程总览

`pi-subagents` 的执行链路如下：

```text
用户请求
  ↓
父 Pi LLM 决定调用 subagent 工具
  ↓
subagent tool executor
  ↓
解析执行模式：
  ├─ single
  ├─ parallel
  ├─ chain
  └─ async/background
  ↓
发现 agent 配置 / skills / model / cwd / context / session
  ↓
防递归检查：
  ├─ PI_SUBAGENT_CHILD
  └─ PI_SUBAGENT_DEPTH
  ↓
构造 Pi CLI 参数：
  pi --mode json -p "Task: ..."
  + model
  + tools
  + extensions
  + system prompt
  + session
  + env
  ↓
spawn 子 Pi 进程
  ↓
读取 stdout jsonl / stderr
  ↓
更新 progress / status / events
  ↓
聚合 result
  ↓
返回给父会话
```

---

## 3. 扩展启动：只在父会话注册 `subagent` 工具

入口文件是 `src/extension/index.ts`。

扩展启动时首先检查环境变量：

```ts
if (process.env[SUBAGENT_CHILD_ENV] === "1") return;
```

这意味着：**子 Agent 进程不会再注册 `subagent` 工具**。

目的：

- 避免子 Agent 继续调度子 Agent；
- 避免递归调度；
- 避免父子调度边界混乱；
- 保证调度权集中在父会话。

随后父会话创建 executor 并注册 `subagent` 工具。工具支持三类执行模式：

```text
SINGLE   { agent, task }
CHAIN    { chain: [...] }
PARALLEL { tasks: [...] }
```

此外还支持管理和控制动作：

```text
list / get / create / update / delete / status / interrupt / resume / doctor
```

---

## 4. 防递归机制

`pi-subagents` 有两层防递归机制。

### 4.1 子进程不注册 subagent 工具

子 Agent 启动时会带上：

```ts
env[SUBAGENT_CHILD_ENV] = "1";
```

扩展入口看到该变量后直接退出注册流程。

也就是说，子 Agent 进程不会再次拥有完整的 `subagent` 调度工具。

### 4.2 深度限制

它还维护：

```text
PI_SUBAGENT_DEPTH
PI_SUBAGENT_MAX_DEPTH
```

判断逻辑类似：

```ts
const depth = Number(process.env.PI_SUBAGENT_DEPTH ?? "0");
const maxDepth = resolveCurrentMaxSubagentDepth(configMaxDepth);
const blocked = Number.isFinite(depth) && depth >= maxDepth;
```

生成子进程环境时会把 depth 加一：

```ts
PI_SUBAGENT_DEPTH: String(nextDepth)
```

这层机制用于防止嵌套失控，即便某些场景允许子级继续调用，也可以被最大深度保护。

---

## 5. 子 Agent 本质：新的 Pi 子进程

单个子 Agent 的真正执行发生在 `runSingleAttempt()`。

它先构造 Pi CLI 参数：

```ts
baseArgs: ["--mode", "json", "-p"],
task,
sessionDir,
sessionFile,
model,
tools,
extensions,
systemPrompt,
...
```

然后使用 `spawn()` 启动新的 Pi 进程：

```ts
const proc = spawn(spawnSpec.command, spawnSpec.args, {
  cwd: options.cwd ?? runtimeCwd,
  env: spawnEnv,
  stdio: ["ignore", "pipe", "pipe"],
});
```

因此它的模型是：

```text
父 Pi 会话
  └─ subagent tool
      └─ spawn 子 Pi CLI 进程
          └─ 子 Agent system prompt + task + tools + model + session
```

这带来几个重要性质：

- 子 Agent 与父会话进程隔离；
- 子 Agent 能力由父调度器显式下发；
- 子 Agent 的 stdout/stderr/jsonl 可以被父进程捕获；
- 子 Agent 的 session 可以独立保存或恢复；
- 并行执行可以通过多个子进程自然实现。

---

## 6. `buildPiArgs()` 如何定义子 Agent 能力边界

`buildPiArgs()` 负责把子 Agent 的运行能力显式转换成 CLI 参数和环境变量。

它处理：

1. session / session-dir / no-session；
2. model 和 thinking 后缀；
3. tools / tool extensions；
4. extension 注入；
5. skills 继承开关；
6. system prompt 注入；
7. task 参数或 task 文件；
8. 子进程环境变量；
9. MCP direct tools；
10. subagent run id / child agent name / child index。

这意味着子 Agent 的能力边界不是隐式继承的，而是由父调度器显式决定：

```text
model
tools
extensions
skills
cwd
session
system prompt
task
max depth
```

这点对 Brainstorming Pro 很重要：如果当前实现中子 Agent 能力来自共享上下文或隐式继承，就容易出现权限边界不清、调度漂移和结果不可追踪的问题。

---

## 7. 同步 single 执行流程

同步单 Agent 的上层入口是 `runSync()`。

流程大致为：

```text
runSync()
  1. 查找 agent 配置
  2. 校验 output mode
  3. 解析 skills
  4. 拼接 system prompt + skill injection
  5. 构造 model candidates / fallback models
  6. 准备 artifacts / jsonl 路径
  7. 逐个模型尝试 runSingleAttempt()
  8. 聚合 usage / modelAttempts / result
```

它还支持 fallback model：如果某个模型失败且错误可重试，会尝试下一个候选模型。

---

## 8. foreground parallel：父进程并发调度多个子进程

前台并行的关键不是 prompt 中说“并行”，而是在运行时用 `mapConcurrent()` 控制并发。

逻辑类似：

```ts
return mapConcurrent(input.tasks, input.concurrencyLimit, async (task, index) => {
  return runSync(...);
});
```

每个 parallel task 都会解析自己的：

- `cwd`
- `outputPath`
- `skills`
- `modelOverride`
- `sessionDir/sessionFile`
- `intercomTarget`
- `maxSubagentDepth`

所以 parallel 的实际结构是：

```text
父进程
  ├─ child pi process A
  ├─ child pi process B
  └─ child pi process C
```

并发数量由 `concurrencyLimit` 控制。

---

## 9. chain：顺序步骤 + 可选并行 fan-out

chain 支持顺序流水线，也支持某一步 fan-out 成并行组。

模板变量包括：

```text
{task}       原始任务
{previous}   上一步输出
{chain_dir}  共享链路目录
```

顺序 chain 的核心语义是：

```text
step1 output -> previous
step2 task uses {previous}
step2 output -> previous
step3 task uses {previous}
...
```

并行 chain step 则是：

```text
previous output
  ├─ parallel child A
  ├─ parallel child B
  └─ parallel child C
       ↓
聚合 parallel results
       ↓
进入下一步
```

这说明 chain 的上下文传递是显式的，而不是让多个 Agent 隐式共享父会话上下文。

---

## 10. async/background：detached runner + 文件化状态

异步模式不是让父进程一直等待子 Agent，而是启动一个 detached runner。

`spawnRunner()` 做的事情：

1. 将异步执行配置写入临时 JSON 文件；
2. 找到 `subagent-runner.ts`；
3. 用 node + jiti 启动 runner；
4. `detached: true`；
5. `stdio: "ignore"`；
6. `proc.unref()`。

异步结构如下：

```text
父 Pi 会话
  └─ subagent tool
      └─ detached runner process
          ├─ child Pi process 1
          ├─ child Pi process 2
          └─ ...
```

父会话通过以下文件或事件观察后台任务：

```text
status.json
result json
events.jsonl
output-*.log
async started/completed events
```

这避免了父会话阻塞等待，也让后台任务可以被 status/resume/interrupt 管理。

---

## 11. 对 Brainstorming Pro 的直接启发

后续评估当前 subAgent 调度时，应重点检查以下问题。

### 11.1 调度权是否只属于父流程

应确认：

- 子 Agent 是否还能再次调度 subAgent；
- 子 Agent 是否能访问父流程专用工具；
- 子 Agent 是否会提出或执行新的调度计划；
- 子 Agent 是否只返回针对当前任务的结果。

建议方向：

```text
父 workflow/orchestrator 负责调度；
子 agent 只负责执行单一任务；
子 agent 默认不具备继续调度能力。
```

### 11.2 子 Agent 是否进程隔离

应确认：

- 子 Agent 是否通过独立 Pi 进程运行；
- 每个子 Agent 是否有明确 cwd；
- 是否显式传入 system prompt；
- 是否显式限制 tools/skills；
- 是否保存独立 session 或 artifact。

建议方向：

```text
不要让子 Agent 共享父 Agent 的隐式状态；
用显式 CLI/env/session/artifact 定义边界。
```

### 11.3 parallel 是否是真正运行时并发

应确认：

- parallel reviewer 是否真的并发启动；
- 是否有 concurrency limit；
- 是否有 fail-fast 或错误聚合策略；
- 并行任务是否会写同一个输出文件；
- 是否需要 worktree 或其他隔离机制。

建议方向：

```text
parallel 应由 runtime 调度实现，而不是只靠 prompt 让模型“想象并行”。
```

### 11.4 chain 的上下文传递是否显式

应确认：

- 上一步输出如何传给下一步；
- 是否有 `{previous}` 类似机制；
- 是否有共享目录；
- 是否能追踪每一步输入/输出；
- 是否避免多个 Agent 隐式读写同一上下文导致污染。

建议方向：

```text
chain step 输入输出应文件化、结构化、可追踪。
```

### 11.5 async 是否有独立 runner 和状态文件

如果 Brainstorming Pro 后续需要后台 clarification/review，应确认：

- 是否由 detached runner 负责后台执行；
- 父流程是否只观察 status/result；
- 是否能 interrupt/resume；
- 是否能在 Pi 会话恢复后重新发现后台任务。

### 11.6 是否有 depth guard / max concurrency / output guard

应确认：

- 是否限制 subAgent 嵌套深度；
- 是否限制并发数量；
- 是否限制输出大小；
- 是否记录超限错误；
- 是否对 retryable failure 做模型 fallback 或重试。

---

## 12. 可作为后续改造目标的设计原则

基于 `pi-subagents`，Brainstorming Pro 的 subAgent 调度可以考虑向以下原则收敛：

1. **父级唯一调度器**  
   workflow/orchestrator 是唯一能决定启动哪些子 Agent 的组件。

2. **子 Agent 无调度能力**  
   子 Agent 默认不能再调用 subAgent，也不应收到调度类 skill/prompt。

3. **进程级隔离**  
   每个子 Agent 通过独立 Pi 进程执行。

4. **显式能力下发**  
   model、tools、skills、cwd、system prompt、session 都由父流程显式决定。

5. **显式上下文传递**  
   chain 中通过 previous/output/artifact 传递，不依赖隐式共享会话。

6. **运行时并发控制**  
   parallel 使用 bounded concurrency，而不是 prompt-level 并行。

7. **状态文件化**  
   run status、events、outputs、artifacts 都应可恢复、可审计。

8. **安全边界默认收紧**  
   项目本地 agent、project-local config、debug artifacts、raw output 等都应按不可信输入处理。

9. **失败可追踪**  
   每个子 Agent 的 exit code、stderr、final output、model attempts、usage 都应入库。

10. **恢复和中断语义明确**  
    前台/后台任务都应有清晰的 status、interrupt、resume 语义。

---

## 13. 后续建议

下一步可以把本文作为 checklist，对当前 Brainstorming Pro 的实现做一次对照审计，重点看：

```text
extensions/clarification-orchestrator/runner.ts
extensions/clarification-orchestrator/workflow.ts
extensions/clarification-orchestrator/concurrency.ts
extensions/clarification-orchestrator/artifact-store.ts
extensions/clarification-orchestrator/process-lifecycle.ts
extensions/clarification-orchestrator/phases/*.ts
```

建议产出：

1. 当前实现与 `pi-subagents` 的差异表；
2. 当前 subAgent 调度的风险清单；
3. 可拆分的改造任务；
4. 是否引入 child env guard / depth guard / explicit capability boundary；
5. 是否需要重构 parallel/chain/async 的状态模型。
