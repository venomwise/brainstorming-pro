# Agent Execution Runtime 设计

## Summary

新增一个 **Agent Execution Runtime**，为 Brainstorming Pro 的 workflow-owned phase adapters 和未来 review panels 提供安全、可观测、可测试的内部 foreground child Pi execution 能力。它通过 role-based `runAgent()` 启动受控 child Pi process，使用 prompt/system prompt 文件化、`--no-session`、`--no-skills`、child env marker、recursion guard、timeout、bounded output capture 和 structured output validation 收集结果。该 runtime 只负责执行和返回结构化结果，不拥有 workflow state transition、artifact commit、review decision 或 approval 权限。

## Goals

- 提供 role-based `runAgent()`，供 Brainstorming Pro 内部 phase adapters / review panels 使用。
- 构建安全的 child Pi launch spec：foreground process、`shell: false`、显式 args/env/stdio。
- 固定 child Pi invocation 使用 `--no-session` 和 `--no-skills`。
- 使用 prompt file 和 system prompt file，避免长 argv、shell quoting 和 prompt 泄漏到命令行。
- 通过 child env marker 和 recursion depth guard 防止 child 注册 workflow command 或无限递归启动 child。
- 支持 provider-qualified model validation 和 role/phase policy validation。
- 支持 timeout、有限 retry、bounded stdout/stderr/raw output capture、output truncation metadata。
- 支持 structured output parsing / validation，拒绝 malformed 或 schema mismatch output。
- 写入 per-agent-run audit files，便于调试和后续 workflow status/TUI 展示。
- 提供 progress event hooks，为后续 `workflow-tui-live-progress` 和 review panels 接入 live progress 打基础。
- 保持与 `workflow-runtime-orchestrator` 解耦：agent runtime 不直接改写 workflow state，不提交 artifacts，不批准 gates。

## Primary Users / Roles

- **Phase adapter implementer**：需要从 `BrainstormingPhaseAdapter`、`SpecPlanPhaseAdapter`、`SpecExecPhaseAdapter` 中受控启动内部 agent，并拿到结构化结果。
- **Future review panel implementer**：需要在 design/plan/execution review panel 中启动多个固定 reviewer role，并统一收集 findings。
- **Brainstorming Pro maintainer**：需要一个小而严格的 child execution substrate，而不是通用 subagent product model。
- **Security / reliability reviewer**：需要确认 child process 不继承 session/skills，不绕过 workflow lifecycle，不暴露 generic orchestration，不产生 unbounded recursion。
- **Workflow user**：不直接使用本 runtime，但会从更稳定的 artifact generation、review 和 execution 中受益。

## Non-Goals

- 不暴露 public `subagent` command 或 tool。
- 不实现 generic `single` / `parallel` / `chain` / `async` orchestration。
- 不实现 background async runner。
- 不实现 intercom。
- 不复用 `pi-subagents` builtin agent discovery 或 builtin agent product model。
- 不允许 child Pi process 加载 skills；第一版所有 child invocation 固定 `--no-skills`。
- 不允许 child Pi process 继承 parent session；第一版固定 `--no-session`。
- 不设计 multi-agent review panel 的 reviewer role、并发、triage、revision loop；这些属于后续 review panel specs。
- 不实现 phase adapter 业务逻辑；Spec 4 `skill-phase-adapters` 负责把 `runAgent()` 用到具体 phases 中。
- 不提交 `design.md`、`requirements.md`、`tasks.md` artifact version。
- 不写 review decisions 或 approvals。
- 不推进 workflow state machine。
- 不自动跳过或批准任何 user gate。

## Context

Brainstorming Pro 全局重构路线要求以 `/brainstorm-pro` 为唯一公开 workflow intent interface，由 runtime state machine 强制 lifecycle：designing、review decision、approval、planning、execution 和 review 等阶段都必须由代码校验和持久化。Spec 1 `workflow-runtime-orchestrator` 已经定义 workflow state、artifact store、event log、phase adapter interface、review decision gates 和 approval gates。Spec 2 `pi-subagents-infrastructure-reuse` 已经明确：可以复用 `nicobailon/pi-subagents` 的 foreground child lifecycle、prompt file、output capture、progress 和 TUI 等基础设施实践，但不能继承其 generic subagent tool、arbitrary orchestration、intercom、background async 和 builtin agents。

当前代码中已有预留目录：

```text
extensions/clarification-orchestrator/runtime/agent-execution/
  README.md
```

该 scaffold 明确未来实现必须保留：

- `PI_COMMAND` 是单一 executable path override，不做 shell parsing；
- model 必须先通过 provider-qualified validation；
- child Pi 使用 `--no-session`；
- child Pi 使用 `--no-skills`；
- child env 包含 Brainstorming Pro child marker；
- depth guard 防止递归 child execution；
- child command registration prevention 保持 workflow command surface parent-owned；
- 不暴露 generic `single`、`parallel`、`chain`、`async`、public subagent tool、intercom 或 background runner。

Spec 3 的任务就是把该 scaffold 设计成正式的 execution substrate，供后续 specs 复用。

## Discovery

### Key Discoveries

- Spec 3 的核心不是“做一个 subagent 产品”，而是“为 workflow-owned phases 提供可控 child execution substrate”。
- 如果把 `pi-subagents` 的 generic orchestration model 带入 Brainstorming Pro，会破坏 `/brainstorm-pro` runtime-first 架构，并增加绕过 approval gates 的风险。
- `runAgent()` 应以 Brainstorming Pro 内部 role 为入口，而不是以用户自由 prompt delegation 为入口。
- Child process 的结果必须视为 untrusted output，只有通过 structured schema validation 后才能交给 phase adapter 处理。
- Agent runtime 即使成功生成内容，也不能直接 commit artifact；artifact versioning 和 state transition 必须仍由 workflow runtime 处理。
- 第一版统一 `--no-skills` 可以显著降低递归、skill side effect、command registration 和 project-local trust 边界复杂度。
- 后续如果要吸收 `brainstorming`、`spec-plan`、`spec-exec` skills 的方法论，应在 package-owned adapter prompt/system prompt 中表达，而不是让 child 直接加载 skills。
- Progress event hook 应从第一版预留，否则后续 TUI/review panel 会难以观测长时间 agent execution。

### Scope Decisions

包含：

- Role-based `runAgent()` API。
- Internal agent role registry。
- Safe launch spec builder。
- Prompt/system prompt file writer。
- Foreground child process spawn wrapper。
- Bounded stdout/stderr/raw output capture。
- Structured output parser/validator hook。
- Timeout、有限 retry、non-zero exit handling。
- Recursion guard 和 child env marker。
- Per-agent-run audit output layout。
- Progress event types and callback。
- Tests covering launch safety、output validation、timeout、recursion、product boundary。

排除：

- Public subagent API。
- Generic orchestration modes。
- Background async execution。
- Multi-agent panel orchestration。
- Review role prompt 设计。
- Skill loading exceptions。
- Workflow state/artifact/gate mutation。

明确第一版策略：

```text
child Pi process always uses --no-session
child Pi process always uses --no-skills
max child depth = 1
foreground child process only
```

## Proposed Solution

实现一个 minimal but strict foreground `runAgent()` runtime。Phase adapter 或未来 review panel 只能通过内部 typed API 指定一个受支持的 Brainstorming Pro role、prompt、system prompt、model、workflow context、output schema 和 execution limits。Agent runtime 校验 role/phase/model/depth/path policy 后，将 prompt 和 system prompt 写入 topic-scoped `.workflow/runs/<run-id>/agents/<agent-run-id>/`，构建安全 Pi child launch spec，以 foreground child process 运行，并在 timeout/output limits 内捕获输出。Child output 经过 structured parser/schema validation 后作为 `AgentRunResult<T>` 返回调用方。

关键原则：

```text
Workflow runtime owns lifecycle.
Phase adapters request execution.
Agent execution runtime runs child processes.
Child agents return structured output.
Phase adapters interpret results.
Workflow runtime commits artifacts/events/state.
```

### Architecture

```text
Workflow Runtime Orchestrator
  ↓
Phase Adapter / Future Review Panel
  ↓
Agent Execution Runtime
  ├─ role policy
  ├─ model / launch policy validation
  ├─ recursion guard
  ├─ prompt/system prompt file writer
  ├─ launch spec builder
  ├─ foreground spawn wrapper
  ├─ bounded output capture
  ├─ structured result validation
  ├─ progress event emitter
  └─ audit file writer
      ↓
Child Pi Process
  ├─ --no-session
  ├─ --no-skills
  ├─ child env marker
  └─ no workflow command registration
```

Recommended internal API:

```ts
export type AgentRunRequest<TOutput> = {
  role: AgentRole;
  purpose: string;
  prompt: string;
  systemPrompt: string;
  model: ProviderQualifiedModel;
  workflow: AgentWorkflowContext;
  outputSchema: AgentOutputSchema<TOutput>;
  limits?: Partial<AgentRunLimits>;
  onProgress?: (event: AgentProgressEvent) => void | Promise<void>;
};

export async function runAgent<TOutput>(
  request: AgentRunRequest<TOutput>,
): Promise<AgentRunResult<TOutput>>;
```

`runAgent()` returns execution result only. It must not accept options that approve gates, mutate workflow phase, or commit artifacts.

### Components

#### `runtime/agent-execution/types.ts`

Defines shared execution types:

```ts
export type AgentRole =
  | "design-author"
  | "design-reviser"
  | "plan-author"
  | "task-executor"
  | "minimal-reviewer";

export type AgentWorkflowContext = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  projectRoot: string;
  topicDir: string;
  artifacts: Partial<Record<ArtifactKind, VersionedArtifactRef>>;
};

export type AgentRunStatus =
  | "succeeded"
  | "failed"
  | "timed-out"
  | "invalid-output";

export type AgentRunResult<TOutput> = {
  agentRunId: string;
  role: AgentRole;
  status: AgentRunStatus;
  output?: TOutput;
  paths: AgentRunPaths;
  startedAt: string;
  completedAt: string;
  attempts: number;
  error?: AgentRunError;
  outputCapture: AgentOutputCaptureSummary;
};
```

The initial role union should stay small. Later specs may extend it with review-specific roles such as `product-reviewer`, `architecture-reviewer`, `risk-reviewer`, `testing-reviewer`, `plan-coverage-reviewer`, and `execution-diff-reviewer`.

#### `runtime/agent-execution/roles.ts`

Defines role registry and role policy:

```ts
export type AgentRoleDefinition = {
  role: AgentRole;
  description: string;
  allowedPhases: WorkflowPhase[];
  defaultTimeoutMs: number;
  defaultMaxRetries: number;
  defaultMaxStdoutBytes: number;
  defaultMaxStderrBytes: number;
  defaultMaxOutputBytes: number;
  expectedResultKind: "artifact-draft" | "review-findings" | "execution-report";
  allowSkills: false;
  allowSession: false;
};
```

First-version role policy:

| Role | Allowed phases | Result kind | Notes |
| --- | --- | --- | --- |
| `design-author` | `designing` | `artifact-draft` | Produces candidate design content for adapter validation. |
| `design-reviser` | `awaiting-design-review-decision`, `awaiting-design-approval`, `design-review` | `artifact-draft` | Future revision support; may be placeholder initially. |
| `plan-author` | `planning` | `artifact-draft` | Produces candidate requirements/tasks content. |
| `task-executor` | `executing` | `execution-report` | Executes approved tasks only after workflow runtime enters executing. |
| `minimal-reviewer` | `design-review`, `plan-review`, `execution-review` | `review-findings` | Lightweight validation/review role until full panels exist. |

Every role has:

```text
allowSkills = false
allowSession = false
```

Role validation must reject unknown roles or roles not allowed in the current workflow phase.

#### `runtime/agent-execution/launch-spec.ts`

Builds safe child process invocation:

```ts
export type AgentLaunchSpec = {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  stdio: "pipe";
  shell: false;
  promptFilePath: string;
  systemPromptFilePath: string;
  outputDirectory: string;
};
```

Launch spec requirements:

- Resolve Pi executable through the approved deterministic resolver path.
- Treat `PI_COMMAND` as one executable path only.
- Never split `PI_COMMAND` into command fragments.
- Never use `shell: true`.
- Always include `--no-session`.
- Always include `--no-skills`.
- Pass prompt/system prompt via file arguments or the Pi-supported equivalent, not through shell-interpreted command strings.
- Set `cwd` to the trusted project root.
- Include child env metadata:

```text
BRAINSTORMING_PRO_CHILD=1
BRAINSTORMING_PRO_PARENT_RUN_ID=<workflow-run-id>
BRAINSTORMING_PRO_AGENT_RUN_ID=<agent-run-id>
BRAINSTORMING_PRO_AGENT_ROLE=<role>
BRAINSTORMING_PRO_DEPTH=<depth>
```

The extension entrypoint should use `BRAINSTORMING_PRO_CHILD=1` to prevent child process command registration, especially `/brainstorm-pro`.

#### `runtime/agent-execution/prompt-files.ts`

Writes prompt artifacts under the current topic workflow directory:

```text
specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/
  prompt.md
  system-prompt.md
```

Responsibilities:

- Ensure all paths remain under `specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/`.
- Create parent directories safely.
- Write UTF-8 files atomically where practical.
- Avoid exposing prompt content in command args.
- Return paths for launch spec and audit metadata.

#### `runtime/agent-execution/spawn.ts`

Runs foreground child process:

- Uses `child_process.spawn` with `shell: false`.
- Uses explicit `stdio: "pipe"` or equivalent pipe configuration.
- Does not detach.
- Waits for completion.
- Captures exit code and signal.
- Enforces timeout.
- Kills child on timeout.
- Surfaces spawn errors without throwing untyped exceptions across the public runtime boundary.

Spawn failure kinds:

```ts
export type AgentRunErrorKind =
  | "pi-command-not-found"
  | "unsafe-launch-spec"
  | "spawn-error"
  | "non-zero-exit"
  | "signal"
  | "timeout"
  | "output-limit-exceeded"
  | "invalid-output"
  | "schema-validation-failed"
  | "role-not-allowed"
  | "model-policy-violation"
  | "recursion-depth-exceeded";
```

#### `runtime/agent-execution/output.ts`

Captures bounded process output and writes audit files:

```text
specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/
  stdout.txt
  stderr.txt
  raw-output.txt
  result.json
  metadata.json
```

Responsibilities:

- Enforce max stdout/stderr/raw output bytes.
- Track truncation flags.
- Preserve raw output for diagnostics.
- Write metadata including command path, args redaction policy, role, phase, duration, exit code, signal, timeout, truncation and retry count.
- Avoid treating raw output as trusted artifact content.

Suggested summary type:

```ts
export type AgentOutputCaptureSummary = {
  stdoutBytes: number;
  stderrBytes: number;
  rawOutputBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  rawOutputTruncated: boolean;
};
```

#### `runtime/agent-execution/result-validation.ts`

Parses and validates structured output:

```ts
export type AgentOutputSchema<TOutput> = {
  name: string;
  parse(raw: string): unknown;
  validate(value: unknown): TOutput;
};
```

Spec 3 provides the validation framework. Specific phase adapters or review panels provide concrete schemas. If parsing or validation fails:

- Return `status = "invalid-output"`.
- Preserve raw output and validation error metadata.
- Do not commit artifacts.
- Do not alter workflow state directly.

A future adapter might define schemas for:

```text
DesignDraftOutput
PlanDraftOutput
ReviewFindingsOutput
ExecutionReportOutput
```

but Spec 3 should avoid overfitting to those business schemas.

#### `runtime/agent-execution/progress.ts`

Defines execution progress events:

```ts
export type AgentProgressEvent =
  | { type: "agent.started"; agentRunId: string; role: AgentRole; at: string }
  | { type: "agent.output"; agentRunId: string; stream: "stdout" | "stderr"; bytes: number; at: string }
  | { type: "agent.retrying"; agentRunId: string; attempt: number; reason: string; at: string }
  | { type: "agent.completed"; agentRunId: string; status: AgentRunStatus; at: string }
  | { type: "agent.failed"; agentRunId: string; error: AgentRunError; at: string };
```

These events are runtime observations, not workflow state truth. They can later feed `workflow-tui-live-progress` snapshots. Failure to render UI must not affect agent execution or workflow state.

#### `runtime/agent-execution/recursion-guard.ts`

Enforces depth policy:

```text
max depth = 1
```

Rules:

- Parent workflow process may launch one child process.
- If `BRAINSTORMING_PRO_CHILD=1` is already present, `runAgent()` refuses to launch another child.
- If `BRAINSTORMING_PRO_DEPTH >= 1`, `runAgent()` returns `recursion-depth-exceeded`.
- Extension registration should skip public command registration when child marker is present.

#### `runtime/agent-execution/model-policy.ts`

Validates model configuration before spawn:

- Model must be provider-qualified according to existing project policy.
- Invalid model prevents spawn.
- Role-specific model restrictions may be added later.
- No model fallback should silently change provider/model unless a future spec explicitly designs fallback behavior.

#### `runtime/agent-execution/run-agent.ts`

Orchestrates the full flow:

1. Generate `agentRunId`.
2. Load role policy.
3. Validate role is allowed for current workflow phase.
4. Validate model policy.
5. Check recursion guard.
6. Merge request limits with role defaults.
7. Create per-agent-run directory.
8. Write prompt/system prompt files.
9. Build launch spec.
10. Emit `agent.started`.
11. Spawn child with timeout/output capture.
12. Retry if allowed and failure kind is retryable.
13. Parse and validate structured result.
14. Write result/metadata.
15. Emit completion/failure progress event.
16. Return `AgentRunResult<TOutput>`.

### Data Flow

#### Primary successful path

```text
PhaseAdapter calls runAgent()
  ↓
runAgent validates role policy and current workflow phase
  ↓
model policy validates provider-qualified model
  ↓
recursion guard confirms parent process depth
  ↓
prompt/system prompt files are written under .workflow/runs/<run-id>/agents/<agent-run-id>/
  ↓
launch spec is built with --no-session and --no-skills
  ↓
foreground child Pi process is spawned
  ↓
stdout/stderr/raw output are captured with limits
  ↓
structured output is parsed and schema-validated
  ↓
result.json and metadata.json are written
  ↓
AgentRunResult<TOutput> is returned
  ↓
PhaseAdapter interprets result and returns adapter output
  ↓
WorkflowRuntime commits artifacts/events/state if appropriate
```

#### Invalid output path

```text
Child exits successfully but returns malformed or schema-invalid output
  ↓
raw-output.txt is preserved
  ↓
result validation fails
  ↓
AgentRunResult.status = invalid-output
  ↓
PhaseAdapter reports phase failure/blocker
  ↓
WorkflowRuntime decides failed/blocked according to phase semantics
```

#### Timeout path

```text
Child exceeds timeout
  ↓
spawn wrapper kills child
  ↓
partial stdout/stderr/raw output are preserved
  ↓
AgentRunResult.status = timed-out
  ↓
retry occurs only if role policy/request allows
  ↓
final failure returns to PhaseAdapter
```

#### Progress path

```text
runAgent emits agent.started
  ↓
spawn/output capture emits agent.output events
  ↓
retry emits agent.retrying when applicable
  ↓
completion emits agent.completed or agent.failed
  ↓
future snapshot/TUI layer derives display state from progress events
```

## Error Handling

### Unsafe launch spec

If launch spec would require shell parsing, missing command, disallowed args, missing `--no-session`, missing `--no-skills`, path escape, or invalid env depth:

```text
no child is spawned
AgentRunResult.status = failed
error.kind = unsafe-launch-spec
```

### Pi command not found

If the resolved Pi executable cannot be found or executed:

```text
AgentRunResult.status = failed
error.kind = pi-command-not-found or spawn-error
raw output paths may be absent or empty
```

### Non-zero exit

If child exits non-zero:

```text
stdout/stderr are preserved
metadata records exit code
AgentRunResult.status = failed
error.kind = non-zero-exit
```

If a retry is configured and the error is retryable, `runAgent()` may retry up to the configured limit. Retries must use new attempt metadata and preserve previous attempt output.

### Timeout

If timeout expires:

```text
child is killed
partial output is preserved
metadata records timeout
AgentRunResult.status = timed-out
error.kind = timeout
```

### Output limit exceeded

If stdout/stderr exceeds configured stream limits:

```text
capture truncates safely
truncation flags are recorded
execution may continue if structured output remains parseable
```

If raw structured output itself cannot be parsed because of limit/truncation:

```text
AgentRunResult.status = invalid-output
error.kind = output-limit-exceeded or invalid-output
```

### Invalid structured output

If output cannot be parsed or schema validation fails:

```text
raw output is preserved
result.json records validation error if safe
AgentRunResult.status = invalid-output
no artifact commit occurs
```

### Recursion attempt

If child process or depth-limited environment attempts to launch another child:

```text
no spawn occurs
AgentRunResult.status = failed
error.kind = recursion-depth-exceeded
```

### Role or phase mismatch

If an adapter requests a role that is not allowed in the current workflow phase:

```text
no spawn occurs
AgentRunResult.status = failed
error.kind = role-not-allowed
```

This protects against accidental planning/execution work before workflow gates allow those phases.

### Progress callback failure

Progress callback failures should not crash the child process by default. Recommended handling:

```text
record progress callback error in metadata or diagnostics
continue execution unless callback failure indicates a critical runtime invariant failure
```

UI/snapshot failures must not become workflow truth.

## Testing

### Unit tests: launch spec

- Launch spec includes `--no-session`.
- Launch spec includes `--no-skills`.
- Launch spec never uses `shell: true`.
- `PI_COMMAND` is treated as one executable path and is not shell-split.
- Prompt/system prompt are passed by file path, not embedded in shell command strings.
- Child env includes workflow child marker, parent run id, agent run id, role and depth.
- Unsafe launch spec is rejected before spawn.

### Unit tests: role and policy validation

- Unknown role is rejected.
- Role not allowed in current phase is rejected.
- All first-version roles have `allowSkills = false` and `allowSession = false`.
- Provider-qualified model validation is enforced before spawn.
- Recursion guard rejects `BRAINSTORMING_PRO_CHILD=1` or depth >= 1.

### Unit tests: prompt/output paths

- Agent run directory is created under `specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/`.
- Prompt and system prompt files are written safely.
- Path traversal in topic/run/agent identifiers is rejected or impossible by construction.
- stdout/stderr/raw-output/result/metadata paths remain topic-scoped.

### Unit tests: output and validation

- Successful JSON/structured output passes schema validation.
- Malformed JSON returns `invalid-output`.
- Schema mismatch returns `invalid-output`.
- stdout/stderr limits trigger truncation flags.
- Raw output limit prevents unbounded memory usage.
- Validation failure preserves raw output path.

### Integration tests with fake child command

Use deterministic fixture scripts instead of real LLM calls:

- Fake child returns valid structured output.
- Fake child exits non-zero.
- Fake child sleeps past timeout.
- Fake child emits huge stdout/stderr.
- Fake child emits malformed JSON.
- Fake child emits schema-invalid JSON.
- Fake child receives expected env marker and args.

### Security tests

- No generic public `subagent` command/tool is registered.
- No `single` / `parallel` / `chain` / `async` public API is exposed.
- Child environment prevents `/brainstorm-pro` command registration.
- Child invocation always uses `--no-skills`.
- Child invocation always uses `--no-session`.
- `PI_COMMAND` does not support shell command parsing.
- Agent runtime cannot write approval files.
- Agent runtime cannot directly transition workflow state.
- Agent runtime cannot directly commit artifact versions.
- Project-local skills/tools/config are not implicitly enabled for child process.

### Regression / package validation tests

- Any code derived from `pi-subagents` has required attribution header.
- `validate-package` continues to reject forbidden `pi-subagents` imports/dependencies.
- Product boundary tests verify no generic subagent product semantics leak into Brainstorming Pro public surface.

## Implementation Notes for Spec 4 Adapters

`BrainstormingPhaseAdapter`、`SpecPlanPhaseAdapter` 和 `SpecExecPhaseAdapter` should call `runAgent()` as an internal execution substrate only. They should supply package-owned prompt/system prompt text that captures the approved methodology, plus a phase-specific structured output schema. Child processes remain `--no-skills`; adapters must not rely on child skill loading. Adapter code remains responsible for interpreting `AgentRunResult` and returning phase output to the workflow runtime, while artifact commits and state transitions stay workflow-owned.

## Open Questions

1. Which exact Pi CLI arguments should be used for prompt and system prompt file inputs? Implementation should read the installed Pi CLI docs/API before coding and preserve the `--no-session` / `--no-skills` invariants.
2. Should structured output be extracted from stdout, a dedicated result file, or both? Recommendation: prefer a dedicated result file if Pi supports it cleanly; otherwise parse a clearly delimited JSON block from raw output.
3. Should retry policy be role-specific only, or can phase adapters override it per invocation? Recommendation: allow adapter override within strict role max bounds.
4. Should failed attempts be stored in separate attempt subdirectories? Recommendation: yes for auditability if retry is implemented.
5. How much command/env metadata can be safely written to `metadata.json` without leaking secrets? Implementation should redact sensitive env values and avoid writing full inherited env.
6. Should model fallback exist? Recommendation: no silent fallback in Spec 3; explicit fallback can be designed later if needed.
7. How should child command registration prevention be implemented in `index.ts`? Recommendation: skip registering `/brainstorm-pro` when `BRAINSTORMING_PRO_CHILD=1`, and add tests proving child mode has no public workflow command surface.
