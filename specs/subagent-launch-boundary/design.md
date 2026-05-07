# Subagent 启动边界设计

## Summary

重构 Brainstorming Pro 的 subagent 启动边界，使子 Agent 的启动方式更接近 `nicobailon/pi-subagents` 中经过生产验证的实践：父级 orchestrator 仍是唯一调度器；子 Agent 通过独立 Pi 子进程运行；启动参数、system prompt、task prompt、tools、skills、session、env、depth guard 都由父流程显式控制。默认阻止嵌套调度失控，子进程不注册 Brainstorming Pro commands。

## Goals

- 将 Brainstorming Pro subagent 启动层从“简单 spawn Pi”升级为“显式 launch spec”。
- 默认防止递归 subagent 调度失控。
- 子进程不注册 Brainstorming Pro slash commands。
- 对齐 `pi-subagents` 的成熟启动实践：
  - 使用 `-p` prompt mode / task wrapper。
  - 将 prompt 文件化，避免长 prompt 直接进入 argv。
  - 将 agent prompt 作为 system prompt 文件注入。
  - foreground child 不使用 detached。
  - 显式声明 `stdio`。
  - 显式 `--no-session`。
  - 显式 `--no-skills`。
  - 注入 child/depth metadata env。
- 保持 Brainstorming Pro 的领域专用 workflow，不新增通用 `subagent` tool。
- 保持安全默认收紧，尤其是 project-local tools、skills、commands。

## Primary Users / Roles

- **Brainstorming Pro maintainer**：希望子 Agent 启动行为稳定、可测试，并尽量接近生产验证模式。
- **Workflow user**：通过 `/clarify` 使用多 Agent clarification，不需要理解底层启动细节。
- **Security reviewer**：需要确认子 Agent 不隐式继承父会话能力，也不能无限递归调度。

## Non-Goals

- 不实现 `pi-subagents` 的通用 `subagent` tool。
- 不实现 single / parallel / chain / async 通用执行框架。
- 不实现 detached background runner。
- 不引入 intercom。
- 不引入 session-dir/session-file 恢复语义。
- 不引入 runtime extension 注入，除非后续 spec 明确需要。
- 不改变 `/clarify -> /spec-plan -> /spec-exec` 生命周期。
- 不放宽 `PI_COMMAND` 单一可执行路径约束。
- 不支持 path-like tool extension entries；本阶段仅支持明确的 builtin Pi tool names。

## Context

当前 Brainstorming Pro 已经通过 `runner.ts` 启动独立 Pi 子进程：

```text
pi --print --mode json --no-session <prompt>
```

并已有：

- model resolution；
- provider-qualified model validation；
- retry；
- timeout；
- output limit；
- JSON parse / schema validation；
- debug artifacts；
- child process registry；
- review bounded concurrency。

但与 `pi-subagents` 的启动层相比，当前仍有差距：

- prompt 直接放在 argv，长 prompt 有启动失败和泄露风险。
- agent prompt 没有作为 Pi system prompt 单独注入。
- 没有显式 `--no-skills`。
- foreground child 使用 `detached`，与 `pi-subagents` foreground 行为不同。
- `stdio` 没有显式声明。
- 没有 depth / max-depth guard。
- 子 Pi 进程加载同一 extension 时，当前没有 entrypoint guard。
- tools 解析展示和实际启动逻辑不完全统一。

## Discovery

### Key Discoveries

- `pi-subagents` 的成熟实践不是只 spawn Pi，而是先构造完整 launch spec：task prompt、system prompt file、tools、extensions、skills inheritance、session mode、env metadata、depth env、temp file cleanup。
- 当前 Brainstorming Pro 的调用链更集中：TypeScript workflow 固定调度 phase agents，而不是让父 LLM 调用通用 `subagent` tool。
- 因为 Brainstorming Pro 没有单独的 `subagent` tool，子进程 guard 应跳过整个 Brainstorming Pro command registration。
- `maxSubagentDepth > 1` 应只控制内部 `runSubagent()` spawn 权限，不恢复 child slash command registration。
- 对 Brainstorming Pro 来说，固定 `--no-session` 是合理安全默认，因为每个 phase 应只依赖显式 artifacts。
- 默认 `--no-skills` 更适合 clarification 子 Agent，避免 user/project skills 污染子 Agent 行为。

### Scope Decisions

包含：

- Depth guard 和可配置 `security.maxSubagentDepth`。
- Child process command-registration guard。
- Child Pi args/env/temp files 的 launch spec builder。
- Prompt/task 文件化。
- Agent prompt 作为 system prompt file 注入。
- 显式 `--no-session`。
- 显式 `--no-skills`。
- Foreground spawn 不再 detached。
- 显式 `stdio: ["ignore", "pipe", "pipe"]`。
- Builtin-only tool validation。

排除：

- Runtime extension injection：当前阶段通过 env/depth/commands/tools/skills 即可建立边界。
- Background async runner：`/clarify` 仍保持前台流程。
- Child session persistence：`--no-session` 对确定性 phase agents 更安全。
- 完整 subagent run status store：推迟到后续 artifact/state-model refactor。

## Proposed Solution

在 `runner.ts` 中引入新的内部 launch 层：

```ts
buildSubagentLaunchSpec(...)
```

该函数替代当前较窄的 `buildPiProcessArgs()` 责任。

目标输出：

```ts
type SubagentLaunchSpec = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  tempDir?: string;
  depth: {
    currentDepth: number;
    nextDepth: number;
    maxDepth: number;
  };
};
```

整体流程：

```text
runSubagent()
  -> depth preflight
  -> resolve model
  -> resolve allowed builtin tools
  -> buildSubagentLaunchSpec()
  -> spawnPiProcess()
  -> cleanup tempDir
  -> parse / validate output
```

## Architecture

```text
Parent Pi process
  └─ /clarify command
      └─ ClarificationWorkflow
          ├─ Discovery phase
          ├─ Review phase
          ├─ Triage phase
          ├─ Refine phase
          └─ Verify phase
              └─ runSubagent()
                  ├─ depth guard
                  ├─ capability resolution
                  ├─ launch spec builder
                  └─ child Pi process
```

Child process：

```text
Child Pi process
  env:
    BRAINSTORMING_PRO_SUBAGENT=1
    BRAINSTORMING_PRO_SUBAGENT_DEPTH=1
    BRAINSTORMING_PRO_MAX_SUBAGENT_DEPTH=1

  args:
    --mode json
    -p
    --no-session
    --no-skills
    --model <provider/model>
    --tools <builtin-tools>
    --append-system-prompt <0600 temp file>
    @<0600 task file>
```

Child Pi process 会加载 package extension，但 `index.ts` 检测到 child env 后直接返回，不注册任何 Brainstorming Pro commands。

## Components

### `types.ts`

扩展 config type：

```ts
security: {
  allowProjectAgents: boolean;
  allowProjectToolExpansion: boolean;
  debugArtifacts: "enabled" | "redacted" | "disabled";
  maxSubagentDepth: number;
}
```

### `schemas.ts`

扩展 `BrainstormingProConfigSchema`：

```ts
maxSubagentDepth: Type.Number({ minimum: 1 })
```

### `config.ts`

默认值：

```ts
security: {
  allowProjectAgents: false,
  allowProjectToolExpansion: false,
  debugArtifacts: "redacted",
  maxSubagentDepth: 1
}
```

### `index.ts`

增加 child process guard：

```ts
export function isBrainstormingProSubagentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.BRAINSTORMING_PRO_SUBAGENT === "1";
}

export default function clarificationOrchestrator(pi: ExtensionAPI) {
  if (isBrainstormingProSubagentProcess()) return;

  // existing command registration
}
```

### `runner.ts`

增加常量：

```ts
export const BRAINSTORMING_PRO_SUBAGENT_ENV = "BRAINSTORMING_PRO_SUBAGENT";
export const BRAINSTORMING_PRO_SUBAGENT_DEPTH_ENV = "BRAINSTORMING_PRO_SUBAGENT_DEPTH";
export const BRAINSTORMING_PRO_MAX_SUBAGENT_DEPTH_ENV = "BRAINSTORMING_PRO_MAX_SUBAGENT_DEPTH";
export const BRAINSTORMING_PRO_CHILD_AGENT_ENV = "BRAINSTORMING_PRO_CHILD_AGENT";
export const BRAINSTORMING_PRO_RUN_ID_ENV = "BRAINSTORMING_PRO_RUN_ID";
```

增加 helpers：

```ts
normalizeSubagentDepth(value: unknown): number | undefined;
resolveCurrentSubagentDepth(env?: NodeJS.ProcessEnv): number;
resolveMaxSubagentDepth(config: BrainstormingProConfig, env?: NodeJS.ProcessEnv): number;
getChildSubagentDepthEnv(...): NodeJS.ProcessEnv;
checkSubagentDepth(...): { blocked: boolean; currentDepth: number; maxDepth: number };
```

Depth rule：

```text
if currentDepth >= maxDepth:
  return failed AgentRunResult without spawn
else:
  child depth = currentDepth + 1
```

### `buildSubagentLaunchSpec()`

Inputs：

```ts
{
  agent: AgentDefinition;
  prompt: string;
  model?: string;
  tools?: string[];
  config: BrainstormingProConfig;
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
  runId?: string;
}
```

Responsibilities：

1. 通过现有 `resolvePiInvocationSync()` 解析 Pi invocation。
2. 创建安全临时目录：

```text
os.tmpdir()/brainstorming-pro-subagent-*
```

3. 写入 agent system prompt：

```text
<tempDir>/<agent-name>-system.md
```

文件权限使用 `0600`。

4. 写入 task prompt：

```text
<tempDir>/task.md
```

文件权限使用 `0600`。

5. 构造 args。

推荐目标：

```ts
[
  "--mode",
  "json",
  "-p",
  "--no-session",
  "--no-skills",
  "--model",
  model,
  "--tools",
  tools.join(","),
  "--append-system-prompt",
  systemPromptPath,
  `@${taskPromptPath}`,
]
```

无 tools 时：

```ts
"--no-tools"
```

无 model 时省略 `--model`。

6. 构造 env：

```ts
{
  ...process.env,
  ...params.env,
  BRAINSTORMING_PRO_SUBAGENT: "1",
  BRAINSTORMING_PRO_SUBAGENT_DEPTH: String(nextDepth),
  BRAINSTORMING_PRO_MAX_SUBAGENT_DEPTH: String(maxDepth),
  BRAINSTORMING_PRO_CHILD_AGENT: agent.name,
  BRAINSTORMING_PRO_RUN_ID: runId
}
```

### `spawnPiProcess()`

将 foreground spawn options 从：

```ts
{
  cwd,
  env,
  detached: process.platform !== "win32"
}
```

改为：

```ts
{
  cwd,
  env,
  stdio: ["ignore", "pipe", "pipe"]
}
```

原因：

- 匹配 `pi-subagents` foreground 行为。
- Parent owns child lifetime。
- 避免 foreground child orphan process。
- 显式阻止 stdin inheritance。

### Tool resolution

统一实际 launch 行为与 tool policy helpers。

新增或使用：

```ts
resolveSubagentTools(agent, config, explicitTools)
```

规则：

1. `explicitTools` 优先。
2. 其次 config agent tools。
3. 其次 agent frontmatter tools。
4. 其次 role defaults。
5. 空数组表示显式 `--no-tools`。

拒绝 unsupported tool entries：

```text
contains "/" OR endsWith ".ts" OR endsWith ".js"
```

除非未来设计明确实现 tool extension injection。

错误类型建议：

```ts
WorkflowError type: "config"
recoverable: true
```

原因是 invalid tool entries 通常来自 config 或 agent definitions。

### Temp cleanup

`runSubagentAttempt()` 应在 process 完成后 best-effort 删除 temp dir，包括失败路径。

模式：

```ts
let launchSpec: SubagentLaunchSpec | undefined;
try {
  launchSpec = buildSubagentLaunchSpec(...);
  processResult = await spawnPiProcess(...);
} finally {
  cleanupTempDir(launchSpec?.tempDir);
}
```

不要删除 debug artifacts 或 run artifacts；只删除启动临时文件。

## Data Flow

### Discovery example

1. `/clarify` 进入 discovery。
2. Workflow 选择 `designer`。
3. `runSubagent()` 检查 depth：
   - parent env 没有 marker；
   - `currentDepth = 0`；
   - config `maxSubagentDepth = 1`；
   - allowed。
4. Model resolves。
5. Tools resolve to：

```text
read,find,grep,ls
```

6. Launch spec 写入：
   - `designer-system.md`；
   - `task.md`。
7. Spawn child Pi：

```bash
pi --mode json -p \
  --no-session \
  --no-skills \
  --model anthropic/claude-sonnet-4 \
  --tools read,find,grep,ls \
  --append-system-prompt /tmp/brainstorming-pro-subagent-abc/designer-system.md \
  @/tmp/brainstorming-pro-subagent-abc/task.md
```

8. Child env includes：

```text
BRAINSTORMING_PRO_SUBAGENT=1
BRAINSTORMING_PRO_SUBAGENT_DEPTH=1
BRAINSTORMING_PRO_MAX_SUBAGENT_DEPTH=1
BRAINSTORMING_PRO_CHILD_AGENT=designer
```

9. Child extension entrypoint returns early。
10. Child 输出 JSON lines。
11. Parent 解析 final assistant output 并验证 schema。
12. Temp launch files 被删除。

### Blocked nested example

1. 某进程运行在：

```text
BRAINSTORMING_PRO_SUBAGENT=1
BRAINSTORMING_PRO_SUBAGENT_DEPTH=1
```

2. Config：

```json
"maxSubagentDepth": 1
```

3. `runSubagent()` 检查：

```text
currentDepth >= maxDepth
```

4. 不 spawn。
5. 返回 `AgentRunResult`：

```ts
{
  status: "failed",
  error: {
    type: "subagent",
    recoverable: true,
    message: "Subagent depth limit reached..."
  }
}
```

### Configured internal nested example

1. Current depth 是 `1`。
2. Config max depth 是 `2`。
3. 内部 `runSubagent()` 调用被允许。
4. Child depth 变为 `2`。
5. depth `2` 的进一步调用被阻止。

重要语义：

```text
maxSubagentDepth controls internal runSubagent() spawning only.
Brainstorming Pro slash commands remain unregistered in child processes regardless of maxSubagentDepth.
```

## Error Handling

### Depth exceeded

- 不 spawn。
- 返回 failed `AgentRunResult`。
- 使用已有 `WorkflowError.type = "subagent"`。
- `recoverable: true`。
- details 包含：
  - agent name；
  - current depth；
  - max depth。

### Invalid depth env

- Missing depth => `0`。
- Non-numeric / negative / non-finite depth => `0`。
- Invalid max depth from env 不应覆盖 schema-validated config。
- Config schema rejects `maxSubagentDepth < 1`。

### Invalid tools

- 拒绝 path-like 或 extension-like tools：
  - contains `/`；
  - ends with `.ts`；
  - ends with `.js`。
- 不把 unsupported entries 传给 `--tools`。
- 在 spawn 前返回 failed `AgentRunResult` 或抛出 recoverable workflow config error。

### Temp file write failure

- 返回 failed `AgentRunResult`。
- Error type 使用 `"artifact-write"` 或 `"subagent"`。
- 推荐：写 system/task temp files 失败时使用 `"artifact-write"`。

### Spawn failure

保留现有行为：

- child `error` event 填充 stderr 并返回 exit code `1`；
- non-zero exit 根据 stderr/stdout 分类；
- timeout kills child；
- output limit kills child；
- cancellation kills child。

### Cleanup failure

- Best effort only。
- 如果 child output 成功，不应因为 cleanup 失败使 run 失败。

## Testing

### Unit tests: config/schema

- `bundledDefaults.security.maxSubagentDepth === 1`。
- config validation accepts `maxSubagentDepth: 2`。
- config validation rejects `maxSubagentDepth: 0`。

### Unit tests: extension guard

- normal env registers commands。
- `BRAINSTORMING_PRO_SUBAGENT=1` registers no commands。

### Unit tests: launch spec

- builds args with：
  - `--mode json`；
  - `-p`；
  - `--no-session`；
  - `--no-skills`；
  - `--append-system-prompt`；
  - `@task.md`。
- writes system prompt file with agent prompt。
- writes task file with phase prompt。
- injects child/depth env。
- empty tools produces `--no-tools`。
- builtin tools produce `--tools read,grep`。
- no model omits `--model`。
- temp dir is returned for cleanup。

### Unit tests: depth guard

- parent depth 0 / max 1 allows spawn。
- child depth 1 / max 1 blocks spawn。
- child depth 1 / max 2 allows spawn。
- malformed depth env treated as 0。
- blocked run does not call `spawnProcess`。

### Unit tests: spawn options

- `spawnPiProcess()` uses `stdio: ["ignore", "pipe", "pipe"]`。
- foreground spawn does not set `detached`。

### Security tests

- path-like tools are rejected。
- `.ts` / `.js` tool entries are rejected。
- child env does not register Brainstorming Pro commands。
- child process receives `--no-skills`。

### Regression tests

- existing runner tests updated from old `buildPiProcessArgs()` expectations。
- review phase still runs bounded reviewers。
- discovery still parses structured designer output。
- debug artifact redaction still works。

## Open Questions

无阻塞问题。

实现时可以决定一个细节：

- task prompt 是始终文件化，还是只在超过阈值时文件化。
- 推荐：所有 subagent task prompts 都文件化，以提升隐私、一致性和跨平台稳定性。

## Recommended Implementation Order

1. 添加 config/schema/type 字段 `security.maxSubagentDepth`。
2. 添加 extension entrypoint guard 和测试。
3. 重构 runner launch builder：
   - constants；
   - depth helpers；
   - temp file helpers；
   - launch spec type。
4. 更新 spawn options。
5. 添加 tool validation / unified tool resolution。
6. 更新 tests。
7. 更新 README security/config section。
