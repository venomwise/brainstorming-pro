# Controlled Spec Exec Adapter 设计

## Summary

新增 **Controlled Spec Exec Adapter**，作为 Spec 4 `skill-phase-adapters` 的 execution follow-up。它把 `spec-exec` skill 的执行纪律升级为 code-owned task execution loop：代码解析 `tasks.md`、选择下一个 task、控制 optional/checkpoint/progress、调用 LLM 只执行当前 task，并在结构化结果通过校验后由代码更新 checkbox。该 adapter 只在 workflow runtime 已通过 plan approval gate 并进入 `executing` phase 后运行；执行完成、required tasks/checkpoints 全部通过且无 blocker 后直接进入 `done`。

核心原则：

```text
Code owns execution order.
LLM executes one current task at a time.
Checkpoints are tasks executed by LLM.
Code owns checkbox updates.
Requirements are acceptance truth.
Design is background only.
No plan or requirements revision during execution.
```

## Goals

- 实现 `SpecExecPhaseAdapter` 的真实 execution behavior。
- 将 `spec-exec` skill 中的 task loop、checkpoint、evidence validation 和 blocker escalation 规则变成 code-enforced workflow behavior。
- 由代码解析 `specs/<topic>/tasks.md` 的 `## Tasks` section。
- 由代码选择下一个可执行 task，包括普通 task、checkpoint/verify task、无子任务 phase-level task。
- 通过 Spec 3 `runAgent()` 调用受控 child Pi，让 LLM 只执行当前 task。
- 让 checkpoint 作为当前 task 交给 LLM 执行，不引入单独 deterministic checkpoint validator。
- 禁止 LLM 更新 `tasks.md` checkbox；checkbox 只能由 code-owned `TaskCheckboxWriter` 更新。
- 每完成一个 task 后立即更新 checkbox 并记录 progress event。
- 支持 optional task 的 one-time execution mode：`mvp` 或 `full`。
- 生成结构化 execution report，供 runtime status、audit trail 和用户审阅使用。
- 对 conflict、underspecified、validation failure、scope change、destructive operation、missing dependency 等 blocker fail closed。
- 确保执行不能 revise approved requirements、approved design 或 task plan structure。
- 执行完成后 transition 到 `done`；不设置默认终局 execution-review phase，避免 LLM 在最后一步制造不稳定阻塞。

## Primary Users / Roles

- **Workflow user**：批准 plan 后，希望系统按 approved tasks 稳定执行，并在真实 blocker 出现时收到结构化报告。
- **Brainstorming Pro maintainer**：需要 execution adapter 具备可恢复、可审计、可测试的 deterministic control flow。
- **Implementation agent**：作为 single-task worker，只负责当前 task 的实现或验证，不负责全局 task loop。
- **Security / reliability reviewer**：需要确认 execution 不能绕过 plan approval、不能修改 approved requirements/design、不能让 LLM 任意改写 `tasks.md`。

## Non-Goals

- 不实现默认 execution review phase 或 execution review panel。
- 不实现 diff reviewer、requirement coverage reviewer、test reviewer 或 regression risk reviewer。
- 不实现 automatic fix loop。
- 不实现 plan revision。
- 不实现 requirements revision。
- 不允许 execution adapter 自动修改 approved design。
- 不允许 execution adapter 自动修改 approved requirements。
- 不允许 LLM 黑盒执行整份 `tasks.md`。
- 不允许 LLM 更新 `tasks.md` checkbox。
- 不实现 parallel task execution。
- 不实现 background async runner。
- 不公开 generic subagent command/tool。
- 不新增 public command surface。
- 不把 checkpoint 设计成 user approval gate。
- 不引入单独 deterministic checkpoint validator；checkpoint 由 LLM 按当前 task 执行。

## Context

全局重构路线要求 `/brainstorm-pro` runtime-first：workflow state、artifact version、event log、review decision 和 approval gate 都由代码强制。Spec 1 已经定义 runtime state machine 和 gates。Spec 3 已经定义受控 child Pi execution substrate。Spec 4 `skill-phase-adapters` 已经将 design/planning adapters 设计为 agent-backed artifact generation phases，并明确 execution 部分拆到本 spec。

`spec-exec` skill 的关键执行纪律包括：

- `tasks.md` 是 execution plan。
- `requirements.md` 是 acceptance source of truth。
- `design.md` 只能作为 background，不能替代 acceptance criteria。
- checkpoint tasks 是 validation tasks，不是 user approval gates。
- before marking a task complete, validate using concrete evidence whenever possible。
- after completing each task, immediately update checkbox before starting next task。
- one task, one write。
- do not mark failed/interrupted/skipped tasks complete。
- do not alter task numbering, titles or descriptions。
- do not introduce requirement changes during execution。
- stop only on genuine blockers。
- blockers must be reported using structured template。

本 spec 将这些 prompt-level rules 转换为 code-owned execution loop。LLM 仍负责具体实现和 checkpoint validation，但不再负责整体 loop、task selection 或 checkbox mutation。

## Discovery

### Key Discoveries

- 让 LLM 自己读取完整 `tasks.md` 并循环执行容易产生不可控行为：跳 task、一次做多个 task、忘记更新 checkbox、错误处理 checkpoint、失败后继续执行或改动 task plan。
- 把 task loop 移到代码层更符合 Brainstorming Pro 的 runtime-first 原则：不依赖 LLM 自觉遵守生命周期。
- Checkpoint 不需要单独 deterministic validator；它只是由代码选择的当前 task，交给 LLM 执行 evidence-based validation 即可。
- LLM 不应更新 checkbox；checkbox update 是 deterministic progress mutation，应由代码在结构化 result 校验后执行。
- `tasks.md` 在 execution 中既是 approved plan，又需要记录 progress。必须限制 allowed mutation：只允许 code-owned checkbox marker transition。
- `requirements.md` 必须保持 acceptance source of truth。如果 current task 无法从 tasks/requirements 解析，execution 应 blocked，而不是让 LLM自行补需求。
- Execution correctness 应内嵌在 code-owned task loop 中，通过 per-task evidence、checkpoint tasks、blocker escalation 和 final execution report 保证；不再设置默认终局 execution-review phase，避免最后一步 LLM review 产生不稳定阻塞。

### Scope Decisions

包含：

- `TaskPlanParser`。
- `ExecutionLoopController`。
- `TaskCheckboxWriter`。
- Single-task `task-executor` prompt/schema。
- Optional execution mode decision model。
- Checkpoint-as-task execution semantics。
- Task run records。
- Execution report artifact。
- Blocker schema。
- Unauthorized `tasks.md` mutation detection。
- Execution completion transition to `done`。

排除：

- Execution review panel。
- Automatic post-review fixes。
- Parallel execution。
- Plan/requirements revision。
- Background execution。

## Proposed Solution

实现一个 code-owned `SpecExecPhaseAdapter` execution loop。Runtime 只有在 plan approval gate 满足后才进入 `executing` 并调用 adapter。Adapter 读取 approved `requirements.md`、approved `tasks.md` 和 background `design.md`，解析 `tasks.md`，根据 persisted execution settings 选择 `mvp` 或 `full` mode，然后循环选择下一个 executable task。

每次循环中，adapter 构造 single-task prompt，调用 `runAgent<SingleTaskExecutionResult>()`。Child Pi 只负责当前 task：普通 task 则实现代码并验证；checkpoint task 则检查 scope 内已完成任务是否满足 requirements 并给出 evidence。LLM 返回结构化 result。代码校验 result 后，如果 task completed，则 `TaskCheckboxWriter` 更新对应 checkbox 并记录 event；如果 blocked/failed，则停止并返回 structured execution report。

### Architecture

```text
Workflow Runtime Orchestrator
  ├─ plan approval gate
  ├─ phase = executing
  └─ SpecExecPhaseAdapter
       ├─ ExecutionContextBuilder
       ├─ TaskPlanParser
       ├─ ExecutionModeResolver
       ├─ ExecutionLoopController
       ├─ SingleTaskPromptBuilder
       ├─ runAgent(role = task-executor)
       ├─ SingleTaskResultValidator
       ├─ TaskCheckboxWriter
       ├─ TaskMutationGuard
       └─ ExecutionReportWriter
            ↓
         phase = done | blocked | failed
```

### Components

#### 1. `ExecutionContextBuilder`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts
```

Responsibilities:

- Load approved requirements artifact.
- Load approved tasks artifact.
- Load approved design as background if available.
- Verify plan approval references exact latest requirements/tasks versions.
- Verify all artifact refs remain topic-scoped and checksum-valid.
- Build task execution context for prompt generation.

Suggested type:

```ts
type SpecExecAdapterContext = {
  topic: string;
  runId: string;
  projectRoot: string;
  topicDir: string;
  approvedDesign?: {
    ref: VersionedArtifactRef;
    content: string;
  };
  approvedRequirements: {
    ref: VersionedArtifactRef;
    content: string;
  };
  approvedTasks: {
    ref: VersionedArtifactRef;
    content: string;
  };
  planApproval: ApprovalRef;
};
```

#### 2. `TaskPlanParser`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts
```

Responsibilities:

- Locate `## Tasks` section.
- Parse checkbox task lines.
- Preserve line numbers for exact checkbox updates.
- Identify phases, sub-tasks and phase-level tasks.
- Identify optional tasks and optional phase inheritance.
- Identify checkpoint/verification tasks using keywords such as `Checkpoint`, `Verify`, `检查点`, `验证`.
- Extract indented description lines.
- Extract `_Requirements: ..._` metadata.
- Distinguish task lines from description/metadata lines.
- Reject malformed task structures that cannot be executed safely.

Suggested type:

```ts
type ParsedTask = {
  id: string;
  title: string;
  kind: "phase" | "task" | "checkpoint";
  optional: boolean;
  optionalInherited: boolean;
  completed: boolean;
  parentId?: string;
  requirementIds: string[];
  descriptionLines: string[];
  originalLine: string;
  lineNumber: number;
  indent: number;
  children: string[];
};

type ParsedTaskPlan = {
  tasks: ParsedTask[];
  tasksSectionStartLine: number;
  tasksSectionEndLine: number;
  completedCount: number;
  remainingCount: number;
  optionalCount: number;
  malformed: Array<{
    lineNumber: number;
    reason: string;
  }>;
};
```

Expected accepted checkbox examples:

```text
- [ ] 1. Phase 1: Title
  - [ ] 1.1 Sub-task title
    - Description line
    - _Requirements: 1.1, 1.2_
  - [ ]* 1.2 Optional sub-task
- [ ] 2. Checkpoint - Verify scope
- [✅] 3. Completed phase
```

#### 3. `ExecutionModeResolver`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-mode.ts
```

Responsibilities:

- Detect optional tasks.
- If optional tasks exist and no execution mode is recorded, request a one-time user decision through runtime/resume.
- Persist selected mode bound to exact approved tasks artifact version.
- Reject stale execution mode if tasks artifact version changes.

Execution modes:

```ts
type ExecutionMode = "mvp" | "full";
```

Semantics:

- `mvp`: skip optional tasks and optional phase children.
- `full`: execute all tasks.

Persisted decision shape:

```ts
type ExecutionModeDecision = {
  target: "execution";
  mode: "mvp" | "full";
  selectedAt: string;
  selectedBy: "user";
  artifactVersions: {
    requirements: string;
    tasks: string;
  };
  path: string;
};
```

This is not an approval gate. It is a one-time execution setting needed to avoid silent optional task skipping.

#### 4. `ExecutionLoopController`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-loop.ts
```

Responsibilities:

- Re-parse `tasks.md` before selecting each task.
- Select the first incomplete executable task in order.
- Skip completed tasks.
- Skip optional tasks in `mvp` mode.
- Skip nested children of skipped optional phases in `mvp` mode.
- Treat checkpoint tasks as normal executable tasks with checkpoint-specific prompt instructions.
- Mark phase lines complete only after all executable children are complete.
- Stop immediately on blocked/failed result.
- Build final execution report.

Selection rules:

1. If a phase has incomplete executable children, do not execute the phase line directly.
2. If a phase has no children, treat the phase line as executable task.
3. If all executable children of a phase are complete, mark the phase checkbox complete by code.
4. Checkpoint tasks are selected in normal order.
5. Optional tasks are skipped only in `mvp` mode and are not marked complete.

Pseudo-code:

```ts
while (true) {
  const plan = parseTasks(readTasksMarkdown());
  const next = selectNextExecutableTask(plan, executionMode);

  if (!next) {
    return completedExecutionReport();
  }

  if (next.kind === "phase" && hasAllExecutableChildrenComplete(next, plan)) {
    checkboxWriter.markComplete(next);
    recordPhaseCompletion(next);
    continue;
  }

  const result = await runSingleTaskAgent(next, context, executionMode);

  if (result.status === "completed") {
    validateSingleTaskResult(result, next);
    mutationGuard.verifyTasksPlanWasNotMutatedByAgent();
    checkboxWriter.markComplete(next);
    recordTaskCompletion(next, result);
    continue;
  }

  if (result.status === "blocked") {
    return blockedExecutionReport(next, result.blocker);
  }

  return failedExecutionReport(next, result.error);
}
```

#### 5. `SingleTaskPromptBuilder`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/prompts.ts
```

Prompt must include:

- Current task only.
- Relevant task description lines.
- Referenced requirements excerpts.
- Full requirements file or scoped excerpts, depending implementation simplicity.
- Background design context if available.
- Current task kind: `task` or `checkpoint`.
- Execution mode.
- Already completed task summary.
- Explicit forbidden actions.
- Required structured output schema.

Core instructions:

```text
You are executing exactly one task from an approved tasks.md.
Do not execute later tasks.
Do not update tasks.md checkboxes.
Do not modify requirements.md.
Do not modify design.md.
Do not revise the plan.
Use requirements.md as acceptance source of truth.
Use design.md only as background context.
Validate with concrete evidence whenever possible.
If this is a checkpoint task, validate completed tasks in scope against requirements.md. It is not a user approval gate.
If blocked, return structured blocker and stop.
```

#### 6. `SingleTaskExecutionResult` schema

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/schemas.ts
```

```ts
type SingleTaskExecutionResult = {
  kind: "single-task-result";
  taskId: string;
  status: "completed" | "blocked" | "failed";
  changedFiles: string[];
  validation: {
    commands: Array<{
      command: string;
      status: "passed" | "failed" | "not-run";
      summary: string;
    }>;
    evidence: string[];
  };
  blocker?: ExecutionBlocker;
  error?: {
    kind: string;
    message: string;
    retryable: boolean;
  };
  summary: string;
};
```

Validation rules:

- `taskId` matches selected task.
- `status = completed` requires evidence or validation summary.
- `status = blocked` requires `blocker`.
- `status = failed` requires `error`.
- `changedFiles` must be relative project paths.
- `changedFiles` must not include `requirements.md` or `design.md` under the spec topic.
- `changedFiles` should not include `tasks.md`; progress mutation is code-owned.
- Checkpoint tasks require evidence describing what was validated.

#### 7. `ExecutionBlocker` schema

```ts
type ExecutionBlocker = {
  task: string;
  type:
    | "conflict"
    | "underspecified"
    | "validation_failure"
    | "scope_change"
    | "destructive_op"
    | "missing_dependency";
  context: {
    taskExcerpt: string;
    requirements: string;
  };
  tried: string[];
  risk: string;
  options: string[];
  neededFromUser: string;
};
```

Blocker mapping:

- `conflict`: `tasks.md` and `requirements.md` conflict.
- `underspecified`: current task cannot be executed from task/requirements/design context.
- `validation_failure`: implementation or checkpoint validation fails and cannot be safely fixed within current task.
- `scope_change`: completing task would require changing approved requirements or task plan.
- `destructive_op`: task requires destructive or irreversible operation.
- `missing_dependency`: credentials, services, files or environment dependencies unavailable.

#### 8. `TaskCheckboxWriter`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/checkbox-writer.ts
```

Responsibilities:

- Update exactly one checkbox per call.
- Use parser-provided line number and original line.
- Allow only these transitions:

```text
- [ ]  -> - [✅]
- [ ]* -> - [✅]*
```

- Preserve task id, title, indentation, optional marker and descriptions.
- Re-read file before write and verify original line still matches.
- Write atomically where practical.
- Append `task.completed` or `phase.completed` workflow event.

Disallowed mutations:

- Changing task title.
- Changing task numbering.
- Changing descriptions.
- Changing `_Requirements:` lines.
- Adding/removing tasks.
- Marking skipped optional tasks complete.
- Marking blocked/failed/interrupted tasks complete.

#### 9. `TaskMutationGuard`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/mutation-guard.ts
```

Responsibilities:

- Snapshot `tasks.md` before each agent run.
- Compare `tasks.md` after agent run before code checkbox update.
- Detect whether child modified `tasks.md`.
- Reject unauthorized mutation.

First-version policy:

```text
Child task-executor must not modify tasks.md at all.
```

If `tasks.md` changes during child run before `TaskCheckboxWriter` acts:

```text
execution blocks
blocker.type = scope_change or validation_failure
reason = unauthorized-tasks-mutation
```

Rationale: progress mutation belongs to code. This prevents agent from silently rewriting task plan or marking unchecked tasks complete.

#### 10. `ExecutionReportWriter`

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-report.ts
```

Suggested report:

```ts
type ExecutionReportOutput = {
  kind: "execution-report";
  topic: string;
  status: "completed" | "blocked" | "failed";
  mode: "mvp" | "full";
  taskRuns: TaskRunRecord[];
  completedTasks: string[];
  remainingTasks: string[];
  skippedOptionalTasks: string[];
  changedFiles: string[];
  validationCommands: Array<{
    command: string;
    status: "passed" | "failed" | "not-run";
    summary: string;
  }>;
  blockers: ExecutionBlocker[];
  summary: string;
};

type TaskRunRecord = {
  taskId: string;
  title: string;
  kind: "task" | "checkpoint" | "phase";
  status: "completed" | "skipped" | "blocked" | "failed";
  startedAt: string;
  completedAt?: string;
  agentRunId?: string;
  changedFiles: string[];
  evidence: string[];
};
```

Suggested layout:

```text
specs/<topic>/.workflow/runs/<run-id>/execution-report.json
specs/<topic>/.workflow/runs/<run-id>/execution-report.md
```

At execution stop, runtime should also commit the current `tasks.md` as a new versioned tasks artifact, even if execution is blocked, so progress is auditable.

### Data Flow

#### Execution start

```text
runtime phase = awaiting-plan-approval
  ↓
user approves exact requirements/tasks versions
  ↓
runtime records plan approval
  ↓
runtime phase = executing
  ↓
SpecExecPhaseAdapter starts
  ↓
ExecutionContextBuilder loads approved requirements/tasks/design
  ↓
TaskPlanParser parses tasks.md
  ↓
ExecutionModeResolver checks optional tasks
```

If optional tasks exist and no mode is recorded:

```text
runtime pauses for one-time execution mode decision: mvp | full
```

If no optional tasks exist:

```text
execution mode = full or not-applicable internally
```

For simplicity, implementation may normalize no-optional mode to `full`.

#### Single task execution

```text
ExecutionLoopController selects next task
  ↓
TaskMutationGuard snapshots tasks.md
  ↓
SingleTaskPromptBuilder builds prompt for current task
  ↓
runAgent<SingleTaskExecutionResult>(role = task-executor)
  ↓
LLM implements or validates current task
  ↓
LLM returns structured result
  ↓
SingleTaskResultValidator validates result
  ↓
TaskMutationGuard verifies child did not mutate tasks.md
  ↓
if completed:
    TaskCheckboxWriter marks current task complete
    event task.completed appended
    loop continues
  else if blocked:
    execution-report written
    phase = blocked
  else failed:
    execution-report written
    phase = failed
```

#### Checkpoint execution

```text
ExecutionLoopController selects checkpoint task
  ↓
SingleTaskPromptBuilder adds checkpoint-specific instruction
  ↓
runAgent(role = task-executor)
  ↓
LLM validates completed tasks in checkpoint scope against requirements.md
  ↓
if validation evidence sufficient and status completed:
    code marks checkpoint checkbox complete
  else:
    blocked/failed report
```

Checkpoint is not a user approval gate. It is a validation task executed by LLM and accepted only through structured evidence.

#### Execution completion

```text
no remaining executable required tasks
  ↓
ExecutionReportWriter writes final report
  ↓
runtime commits current tasks.md as new versioned tasks artifact
  ↓
runtime appends phase.completed
  ↓
runtime phase = done
```

No default `execution-review` placeholder is inserted. The execution report is the audit artifact, and execution correctness is enforced during the task loop rather than by a terminal LLM review.

## Error Handling

### Missing approved plan

If requirements/tasks approval is missing or stale:

```text
runtime rejects before adapter runs
state unchanged
error event appended
```

### Malformed tasks.md

If `TaskPlanParser` cannot safely parse `## Tasks`:

```text
execution blocks
blocker.type = underspecified or conflict
state = blocked
```

### Optional mode missing

If optional tasks exist and no mode is recorded:

```text
runtime pauses for user decision
no task is executed
```

### Child invalid output

If `runAgent()` returns malformed or schema-invalid output:

```text
current task remains unchecked
execution report records failed task
state = failed
```

### Child modifies tasks.md

If `TaskMutationGuard` detects `tasks.md` changed during child run:

```text
current task remains unchecked by code
execution blocks
blocker.type = scope_change or validation_failure
reason = unauthorized-tasks-mutation
```

Implementation may choose to preserve the mutated file for diagnostics, but must not treat agent-written checkbox updates as valid progress.

### Child modifies requirements.md or design.md

If changed files or file checksums show approved requirements/design were modified:

```text
execution blocks
blocker.type = scope_change
risk = approved artifact mutation
```

### Task completed without evidence

If result says `completed` but includes no validation evidence:

```text
result rejected
current task remains unchecked
state = failed or blocked
```

Recommended first implementation: treat as `failed` if malformed, `blocked` if agent explicitly states evidence could not be produced.

### Checkpoint validation failure

If checkpoint task returns `blocked` due to failed validation:

```text
checkpoint remains unchecked
state = blocked
blocker.type = validation_failure
```

### Destructive operation

If task requires destructive/irreversible operation:

```text
state = blocked
blocker.type = destructive_op
current task remains unchecked
```

### Plan/requirements need change

If completing current task requires changing approved requirements or task plan:

```text
state = blocked
blocker.type = scope_change
no automatic revision
```

### Interruption / resume

Since checkbox updates are one task one write and events are appended, resume should:

```text
re-parse current tasks.md
load execution report/progress if present
continue from first incomplete executable task
```

If a task agent was interrupted before checkbox update, that task remains incomplete and may be retried.

## Testing

### Unit tests: task parser

- Parses `## Tasks` section.
- Parses phases and sub-tasks.
- Parses completed `[✅]` tasks.
- Parses optional `[ ]*` tasks.
- Applies optional phase inheritance to children.
- Extracts `_Requirements:` IDs.
- Identifies checkpoint/verify/检查点 tasks.
- Ignores description and metadata lines as tasks.
- Rejects malformed checkbox/task numbering structures.

### Unit tests: execution mode

- No optional tasks proceeds without user mode decision.
- Optional tasks require one-time mode decision.
- MVP mode skips optional tasks.
- MVP mode skips children of optional phases.
- Full mode includes optional tasks.
- Stale execution mode decision rejected when tasks artifact version changes.

### Unit tests: task selection

- Selects first incomplete executable sub-task.
- Does not execute phase with incomplete children.
- Marks phase complete after children complete.
- Selects checkpoint in order.
- Skips completed tasks.
- Stops when no required executable task remains.

### Unit tests: checkbox writer

- Updates exactly one checkbox.
- Converts `[ ]` to `[✅]`.
- Converts `[ ]*` to `[✅]*`.
- Preserves title, numbering, indentation and descriptions.
- Refuses update if original line changed.
- Does not mark skipped optional task complete.
- Appends task completion event.

### Unit tests: mutation guard

- Detects child mutation of `tasks.md`.
- Detects child mutation of `requirements.md`.
- Detects child mutation of `design.md`.
- Allows code-owned checkbox update after guard check.
- Rejects task title/numbering/description mutations.

### Unit tests: single-task result schema

- Valid completed result accepted.
- Completed result without evidence rejected.
- Blocked result without blocker rejected.
- Failed result without error rejected.
- Mismatched taskId rejected.
- Changed files outside project root rejected.
- Changed files containing approved requirements/design rejected.
- Checkpoint completed without validation evidence rejected.

### Unit tests: execution loop

- Executes one task per `runAgent()` call.
- Does not pass entire `tasks.md` as uncontrolled execution instruction.
- Stops on blocked result.
- Stops on failed result.
- Continues after completed task and checkbox update.
- Writes execution report on completed/blocked/failed stop.
- Commits updated `tasks.md` artifact version when execution stops.
- Transitions completed execution to `done`.

### Integration tests with fake child

- Approved plan executes multiple tasks in order.
- Fake child completes first task; code updates only first checkbox.
- Fake child completes checkpoint; code updates checkpoint checkbox.
- Fake child blocks; workflow enters blocked and later tasks remain unchecked.
- Fake child emits invalid output; workflow enters failed.
- Fake child attempts to modify `tasks.md`; mutation guard blocks.
- Resume after interruption continues from first unchecked task.
- MVP mode leaves optional tasks unchecked and completes required tasks.
- Full mode executes optional tasks.

### Security tests

- Execution cannot start before plan approval.
- Execution cannot run with stale plan approval.
- Child still uses `--no-session`.
- Child still uses `--no-skills`.
- No generic subagent tool exposed.
- No arbitrary chain/parallel/async public API introduced.
- LLM cannot update progress markers directly.
- Execution adapter cannot revise approved requirements.
- Execution adapter cannot revise approved design.
- Execution does not transition directly to `done`.

## Open Questions

1. Should every checkbox update create a new versioned tasks artifact, or should runtime append task progress events and commit a final tasks artifact version when execution stops?
   - Recommendation: first implementation appends per-task progress events and commits current `tasks.md` as a new versioned artifact when execution completes, blocks or fails.
2. Should execution mode be stored under `.workflow/decisions/` or a dedicated `.workflow/execution/` directory?
   - Recommendation: store it as a workflow decision bound to requirements/tasks versions, because it is a user-selected execution setting.
3. Should `SingleTaskPromptBuilder` include full requirements.md or only referenced requirement excerpts?
   - Recommendation: start with full requirements for simplicity and reliability; optimize later if prompt size becomes a problem.
4. How should AGENTS.md guidance sync be represented?
   - Recommendation: treat it as a final ordinary task-like execution step controlled by code after required tasks complete, only if repository guidance actually changed.
5. Should failed task retry happen automatically?
   - Recommendation: no automatic retry in first implementation except Agent Execution Runtime's bounded retry for transient child failures. Semantic task failure should stop and require resume/recovery decision.
