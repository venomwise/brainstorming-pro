# Skill Phase Adapters 设计

## Summary

新增真实的 **Skill Phase Adapters**，将 Brainstorming Pro package-owned `brainstorming` 与 `spec-plan` 方法论落实为 workflow-owned runtime phases，并为后续 controlled execution adapter 预留稳定接口。Adapters 通过 Spec 3 `Agent Execution Runtime` 的 `runAgent()` 启动受控 child Pi process，生成结构化 phase output；但 artifact commit、event append、state transition、review decision 和 approval gate 仍全部由 Spec 1 `Workflow Runtime Orchestrator` 强制执行。本 spec 聚焦设计与规划产物生成，不实现完整 `SpecExecPhaseAdapter` task execution loop；execution 的 code-owned task loop 将由后续 `controlled-spec-exec-adapter` spec 单独设计。

## Goals

- 将 `brainstorming` 和 `spec-plan` skill methodology 固化为 runtime-owned phase adapters。
- 替换当前 pass-through placeholder adapters，使 workflow 能真实生成：
  - `design.md`
  - `requirements.md`
  - `tasks.md`
- 通过 `runAgent()` 调用受控 child Pi process 生成 phase output。
- 保持 child Pi 固定使用 Spec 3 的安全边界：
  - `--no-session`
  - `--no-skills`
  - role policy
  - recursion guard
  - provider-qualified model validation
  - bounded output capture
  - structured output validation
- 定义 shared adapter foundation：
  - adapter context builder
  - prompt template modules
  - phase output schemas
  - artifact commit request contract
  - failure/block semantics
- 实现或设计以下 adapters：
  - `BrainstormingPhaseAdapter`
  - `SpecPlanPhaseAdapter`
- 明确 `SpecExecPhaseAdapter` 后续必须采用 code-owned task loop + LLM single-task worker 模型，不能将整份 `tasks.md` 交给 LLM 黑盒执行。
- 保证 adapters 不能绕过 design review decision、design approval、plan review decision 或 plan approval gates。
- 保证 adapters 不能写 approvals、decisions 或直接修改 workflow state truth。

## Primary Users / Roles

- **Workflow user**：通过 `/brainstorm-pro` 自动生成 design 和 plan，只在 review decision / approval gates 介入。
- **Brainstorming Pro maintainer**：需要真实 phase adapters 替换 skeleton，同时保持 runtime-first 架构。
- **Spec author / implementation agent**：需要清楚 adapter 如何调用 child Pi、如何校验 output、如何请求 artifact commit。
- **Security / reliability reviewer**：需要确认 adapters 不能绕过 runtime gates、扩大 child 权限或直接改写 state。
- **Future controlled execution designer**：需要在本 spec 建立的 prompt/schema/context/adapter contract 基础上实现 code-owned task execution loop。

## Non-Goals

- 不实现完整 `SpecExecPhaseAdapter` task execution loop；该能力由后续 `controlled-spec-exec-adapter` spec 设计。
- 不让 LLM 以黑盒方式执行整份 `tasks.md`。
- 不实现 task parser、checkbox writer、optional execution mode、per-task execution report 或 tasks.md progress versioning。
- 不实现 full design review panel。
- 不实现 full plan review panel。
- 不新增 public command surface。
- 不公开 generic `subagent` command 或 tool。
- 不实现 arbitrary `single` / `parallel` / `chain` / `async` orchestration。
- 不实现 background async runner。
- 不允许 child Pi 加载 skills。
- 不允许 adapter 自动 approve design 或 plan。
- 不允许 adapter 写 review decisions 或 approvals。
- 不允许 adapter 直接修改 `state.json` 或作为 workflow state truth。
- 不实现 automatic revision loop。

## Context

Spec 1 `workflow-runtime-orchestrator` 已经定义 workflow state machine、artifact store、event log、review decision gates、approval gates、phase adapter interface 和 start/resume/status 流程。Spec 2 `pi-subagents-infrastructure-reuse` 已经明确 Brainstorming Pro 可以复用 `pi-subagents` 的基础设施经验，但不能继承 generic subagent product model。Spec 3 `agent-execution-runtime` 已经定义受控 `runAgent()` substrate，包括 role policy、prompt/system prompt files、`--no-session`、`--no-skills`、recursion guard、structured output validation 和 progress hooks。

当前代码已经存在 adapter skeleton：

```text
extensions/clarification-orchestrator/workflow/adapters/
  brainstorming.ts
  spec-plan.ts
  spec-exec.ts
  design-review.ts
  plan-review.ts
  registry.ts
  types.ts
```

但 `brainstorming.ts`、`spec-plan.ts` 和 `spec-exec.ts` 仍是 placeholder：它们接收已经存在的 artifact refs 或 done flag，不负责调用 child agent，也不生成真实 markdown artifacts。本 spec 将 `BrainstormingPhaseAdapter` 和 `SpecPlanPhaseAdapter` 变成真实 agent-backed phase adapters，同时为后续 execution adapter 明确边界。

当前全局重构路线要求：

```text
User expresses intent.
Workflow Runtime owns lifecycle.
Phase adapters produce artifacts.
Agents provide reasoning and drafting.
Code enforces gates.
Artifacts are versioned.
Events are append-only.
```

因此本 spec 的设计重点不是“直接调用现有 skill 文件”，而是把 skill methodology 编译进 package-owned prompt/system prompt templates，让 adapters 通过受控 child Pi 生成结构化结果。

## Discovery

### Key Discoveries

- 当前最大缺口不是 workflow state machine，而是 phase adapters 尚无真实 artifact generation 能力。
- `brainstorming` / `spec-plan` skills 应作为 methodology source，而不是 runtime authority。
- 第一版不应让 child Pi 加载 skills；child 固定 `--no-skills` 可以显著降低 recursion、command registration 和 project-local trust boundary 风险。
- Adapter prompt/system prompt 比直接调用 user skill 更适合绑定 runtime context、artifact refs、output schema 和 phase boundary。
- Agent output 必须视为 untrusted；只有 schema validation 和 adapter validation 通过后，runtime 才能 commit artifacts。
- Adapter 不应直接写 versioned artifact、approval、decision 或 state；它只返回 commit intent。
- `SpecExecPhaseAdapter` 风险和复杂度显著高于 design/plan adapters，因为 execution 会修改项目文件并更新 `tasks.md` progress；应拆到 follow-up spec。
- Execution 后续应采用 code-owned task loop + LLM single-task worker 模型：代码控制 task selection、checkpoint selection、progress update 和 stop conditions；LLM 只执行当前 task，包括 checkpoint task。

### Scope Decisions

包含：

- Agent-backed adapter strategy。
- Shared adapter context builder。
- Prompt template framework。
- Structured output schemas。
- `BrainstormingPhaseAdapter`。
- `SpecPlanPhaseAdapter`。
- Artifact commit request contract。
- Adapter failure/block semantics。
- `SpecExecPhaseAdapter` 的 deferred contract 和 boundary。

排除：

- Full execution task loop。
- Checkpoint execution implementation。
- Checkbox writer。
- Full review panels。
- Revision loops。
- Child skill loading。
- Public subagent API。
- Background execution。
- Automatic approval。

## Proposed Solution

采用 agent-backed adapter 架构：

```text
Workflow Runtime Orchestrator
  ↓
Phase Adapter
  ↓
Adapter Context Builder
  ↓
Package-owned Prompt Template + Structured Output Schema
  ↓
Agent Execution Runtime runAgent()
  ↓
Validated Adapter Output
  ↓
Runtime Artifact Commit / Event Append / State Transition
```

核心原则：

```text
Skills are methodology sources, not runtime authority.
Adapters own phase behavior, not workflow lifecycle.
Child output is untrusted until schema-validated.
Runtime owns artifacts, events, gates and transitions.
```

### Architecture

```text
Workflow Runtime Orchestrator
  ├─ State machine
  ├─ Artifact store
  ├─ Event log
  ├─ Gate manager
  └─ Phase adapter registry
       ↓
Skill Phase Adapters
  ├─ BrainstormingPhaseAdapter
  ├─ SpecPlanPhaseAdapter
  ├─ SpecExecPhaseAdapter deferred boundary
  ├─ Adapter context builder
  ├─ Prompt templates
  ├─ Output schemas
  └─ Commit request contract
       ↓
Agent Execution Runtime
  ├─ runAgent()
  ├─ role policy
  ├─ prompt/system prompt files
  ├─ child Pi process
  └─ structured result validation
```

#### Adapter authority boundary

Adapters may:

- read runtime-provided context;
- read latest/approved artifacts through safe helper functions;
- build phase-specific prompt/system prompt text;
- call `runAgent()` with an allowed role for the current phase;
- validate structured output;
- return artifact commit requests;
- return blocked/failed results with diagnostics.

Adapters must not:

- write approval files;
- write review decision files;
- mutate `state.json` directly;
- transition workflow phases directly;
- bypass review decision or approval gates;
- write artifacts outside artifact store;
- auto-select review mode;
- auto-approve artifacts;
- expose generic subagent orchestration.

### Components

#### 1. Adapter context builder

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/context.ts
```

Responsibilities:

- Build typed context for each adapter.
- Load topic/run/project metadata.
- Load existing design when augmenting a topic.
- Load approved design for planning.
- Verify artifact refs are topic-scoped.
- Verify referenced artifact checksums/versions match state.
- Return artifact content as plain strings.
- Prevent adapters from resolving arbitrary paths directly.

Suggested types:

```ts
type BrainstormingAdapterContext = {
  topic: string;
  runId: string;
  request: string;
  projectRoot: string;
  topicDir: string;
  existingDesign?: {
    ref: VersionedArtifactRef;
    content: string;
  };
};

type SpecPlanAdapterContext = {
  topic: string;
  runId: string;
  approvedDesign: {
    ref: VersionedArtifactRef;
    content: string;
  };
  designApproval: ApprovalRef;
};
```

#### 2. Adapter output schemas

Suggested module:

```text
extensions/clarification-orchestrator/workflow/adapters/schemas.ts
```

##### `DesignDraftOutput`

```ts
type DesignDraftOutput = {
  kind: "design-draft";
  topic: string;
  summary: string;
  designMarkdown: string;
  assumptions: string[];
  nonGoals: string[];
  risks: string[];
  openQuestions: string[];
};
```

Validation rules:

- `kind === "design-draft"`.
- `topic` matches workflow topic.
- `designMarkdown` is non-empty.
- `designMarkdown` includes required template headings:
  - `## Summary`
  - `## Goals`
  - `## Primary Users / Roles`
  - `## Non-Goals`
  - `## Context`
  - `## Proposed Solution`
  - `## Error Handling`
  - `## Testing`
  - `## Open Questions`
- Markdown must not include `requirements.md` or `tasks.md` content as generated artifacts.
- Markdown must not claim design has been reviewed or approved.

##### `PlanDraftOutput`

```ts
type PlanDraftOutput = {
  kind: "plan-draft";
  topic: string;
  requirementsMarkdown: string;
  tasksMarkdown: string;
  traceability: Array<{
    requirementId: string;
    designSection?: string;
    taskIds: string[];
  }>;
  assumptions: string[];
  risks: string[];
};
```

Validation rules:

- `kind === "plan-draft"`.
- `topic` matches workflow topic.
- `requirementsMarkdown` is non-empty.
- `tasksMarkdown` is non-empty.
- `tasksMarkdown` includes `## Tasks`.
- Task lines use checkbox format.
- Generated tasks are not pre-marked complete.
- Actionable tasks include requirement references where applicable.
- Generated plan must not instruct execution before plan approval.
- Generated tasks must not require modifying approved design/requirements during execution.

#### 3. Prompt template modules

Suggested modules:

```text
extensions/clarification-orchestrator/workflow/adapters/prompts/brainstorming.ts
extensions/clarification-orchestrator/workflow/adapters/prompts/spec-plan.ts
```

Common prompt type:

```ts
type AdapterPrompt = {
  systemPrompt: string;
  prompt: string;
};
```

##### Brainstorming prompt constraints

The prompt must include:

- project context;
- user request;
- topic;
- design doc template headings;
- instruction to record assumptions, non-goals, risks and open questions;
- required structured JSON output schema;
- instruction not to create `requirements.md` or `tasks.md`;
- instruction not to approve anything;
- instruction not to claim review completion;
- instruction to keep markdown suitable for artifact store commit.

##### Spec-plan prompt constraints

The prompt must include:

- approved design content;
- approved design artifact version/checksum metadata;
- design approval metadata;
- requirements/tasks expected structure;
- traceability requirement from requirements to tasks;
- required structured JSON output schema;
- instruction not to execute tasks;
- instruction not to change approved design;
- instruction not to approve the plan;
- instruction to produce unchecked tasks only.

#### 4. Adapter commit request contract

Adapters should return commit intent rather than writing artifacts directly.

Recommended result type:

```ts
type AdapterPhaseResult =
  | {
      kind: "artifact-commit-request";
      artifacts: Array<{
        kind: ArtifactKind;
        content: string;
        summary?: string;
      }>;
      metadata?: Record<string, unknown>;
    }
  | {
      kind: "blocked";
      reason: string;
      diagnostics?: Record<string, unknown>;
    }
  | {
      kind: "failed";
      error: {
        kind: string;
        message: string;
        retryable: boolean;
      };
    };
```

Runtime remains responsible for:

- artifact version allocation;
- mirror writes;
- checksum calculation;
- event append;
- state transition;
- blocked/failed state;
- retry/recovery decisions.

The existing `PhaseAdapter` interface may be evolved in implementation to preserve compatibility while enforcing this authority boundary. If `commit()` remains on the adapter interface, it must only return a state patch or commit request through runtime-approved helpers; it must not write state, approvals or decisions directly.

#### 5. `BrainstormingPhaseAdapter`

Role:

```text
design-author
```

Allowed phase:

```text
designing
```

Required artifacts:

```text
none
```

Input context:

- request;
- topic;
- run id;
- project root;
- topic dir;
- optional existing design for augment flow.

Flow:

```text
build BrainstormingAdapterContext
  ↓
build brainstorming prompt/system prompt
  ↓
runAgent<DesignDraftOutput>(role = design-author)
  ↓
validate DesignDraftOutput
  ↓
return design artifact commit request
```

Commit request:

```ts
{
  kind: "artifact-commit-request",
  artifacts: [
    {
      kind: "design",
      content: output.designMarkdown,
      summary: output.summary
    }
  ],
  metadata: {
    assumptions: output.assumptions,
    nonGoals: output.nonGoals,
    risks: output.risks,
    openQuestions: output.openQuestions
  }
}
```

Runtime then commits:

```text
.workflow/artifacts/design/vN.md
design.md mirror
phase -> awaiting-design-review-decision
```

#### 6. `SpecPlanPhaseAdapter`

Role:

```text
plan-author
```

Allowed phase:

```text
planning
```

Required artifacts:

```text
approved design
```

Precondition enforced by runtime, before adapter runs:

```text
latest design artifact exists
AND design review decision exists for exact latest design version
AND selected review mode completed or explicitly skipped
AND design approval exists for exact latest design version
```

Flow:

```text
runtime verifies design approval gate
  ↓
build SpecPlanAdapterContext from approved design
  ↓
build spec-plan prompt/system prompt
  ↓
runAgent<PlanDraftOutput>(role = plan-author)
  ↓
validate PlanDraftOutput
  ↓
return requirements/tasks artifact commit request
```

Commit request:

```ts
{
  kind: "artifact-commit-request",
  artifacts: [
    {
      kind: "requirements",
      content: output.requirementsMarkdown
    },
    {
      kind: "tasks",
      content: output.tasksMarkdown
    }
  ],
  metadata: {
    traceability: output.traceability,
    assumptions: output.assumptions,
    risks: output.risks
  }
}
```

Runtime then commits:

```text
.workflow/artifacts/requirements/vN.md
.workflow/artifacts/tasks/vN.md
requirements.md mirror
tasks.md mirror
phase -> awaiting-plan-review-decision
```

#### 7. Deferred `SpecExecPhaseAdapter` boundary

This spec does not implement full execution. However, it records the required future architecture:

```text
SpecExecPhaseAdapter must use a code-owned task execution loop and LLM single-task worker model.
```

Required future principles:

- Code parses `tasks.md`.
- Code selects the next executable task.
- Code handles optional mode.
- Code selects checkpoint tasks just like ordinary tasks.
- LLM executes exactly one current task at a time.
- Checkpoints are executed by LLM as validation tasks, not by a separate deterministic checkpoint validator.
- LLM must not update `tasks.md` checkboxes.
- Code owns checkbox updates.
- Code stops on blocker/failure.
- Code records task evidence and execution report.
- `requirements.md` remains acceptance source of truth.
- `design.md` is background only.
- No plan or requirements revision occurs during execution.

Until the follow-up spec lands, `SpecExecPhaseAdapter` should either remain a safe unavailable stub or return a controlled blocked/unavailable result when execution is requested. It must not implement a temporary black-box “give the whole tasks.md to an LLM” flow.

### Data Flow

#### Designing

```text
/brainstorm-pro "<request>"
  ↓
runtime creates topic/run
  ↓
phase = designing
  ↓
BrainstormingPhaseAdapter builds context and prompt
  ↓
runAgent(role = design-author)
  ↓
child returns DesignDraftOutput
  ↓
adapter validates design markdown and schema
  ↓
adapter returns design commit request
  ↓
runtime commits design v1
  ↓
runtime appends artifact.created / phase.completed events
  ↓
phase = awaiting-design-review-decision
```

#### Planning

```text
user approves exact design version through --resume
  ↓
runtime records design approval
  ↓
phase = planning
  ↓
runtime verifies design approval gate
  ↓
SpecPlanPhaseAdapter loads approved design
  ↓
runAgent(role = plan-author)
  ↓
child returns PlanDraftOutput
  ↓
adapter validates requirements/tasks markdown and traceability
  ↓
adapter returns requirements/tasks commit request
  ↓
runtime commits requirements v1 + tasks v1
  ↓
runtime appends artifact.created / phase.completed events
  ↓
phase = awaiting-plan-review-decision
```

#### Execution placeholder

```text
user approves exact requirements/tasks versions
  ↓
runtime records plan approval
  ↓
phase = executing
  ↓
SpecExecPhaseAdapter checks controlled execution availability
  ↓
if follow-up controlled execution is not implemented:
      return blocked/unavailable with recovery message
  else future spec-owned flow runs code-owned task loop
```

## Error Handling

### Agent invalid output

If `runAgent()` returns `invalid-output` or schema validation fails:

```text
adapter returns failed
runtime records phase failure
state = failed
resume can offer retry
```

### Agent timeout / non-zero exit

If child times out or exits non-zero:

```text
adapter returns failed with retryable flag according to AgentRunResult
runtime records error and enters failed or blocked according to recoverability
```

### Design markdown missing required headings

If `DesignDraftOutput` is structurally valid JSON but `designMarkdown` is missing required headings:

```text
adapter validation rejects output
runtime records adapter-validation error
state = failed or blocked
```

Recommended first implementation: treat this as `failed` and allow retry, because the adapter can regenerate from the same request.

### Plan output missing valid tasks

If `PlanDraftOutput` lacks `## Tasks`, checkbox task lines, or usable requirements/tasks markdown:

```text
adapter validation rejects output
runtime records adapter-validation error
state = failed
```

### Planning without approved design

Runtime must reject before invoking `SpecPlanPhaseAdapter`:

```text
state unchanged
error event appended
adapter is not invoked
```

### Adapter attempts forbidden mutation

If tests or runtime guards detect adapter writing approvals, decisions, state or external paths:

```text
operation rejected
security/product-boundary tests fail
```

### Execution requested before controlled execution lands

If plan is approved but controlled execution is not implemented yet:

```text
SpecExecPhaseAdapter returns blocked/unavailable
runtime records diagnostic
state = blocked or failed according to implementation recovery model
```

This is safer than running uncontrolled full-`tasks.md` LLM execution.

## Testing

### Unit tests: schemas

- Valid `DesignDraftOutput` accepted.
- Design output with mismatched topic rejected.
- Empty design markdown rejected.
- Design markdown missing required headings rejected.
- Design markdown that claims approval/review completion rejected if detectable.
- Valid `PlanDraftOutput` accepted.
- Empty requirements markdown rejected.
- Empty tasks markdown rejected.
- Missing `## Tasks` rejected.
- Tasks without checkbox format rejected.
- Pre-completed generated tasks rejected.
- Plan output instructing execution before approval rejected if detectable.

### Unit tests: adapter context

- Brainstorming context includes request/topic/run metadata.
- Brainstorming augment context can load existing design safely.
- Planning context loads only approved design.
- Planning context rejects missing approval.
- Planning context rejects stale approval version.
- Artifact refs outside topic dir rejected.
- Checksum mismatch rejected.

### Unit tests: `BrainstormingPhaseAdapter`

- Calls `runAgent()` with role `design-author`.
- Uses workflow phase `designing`.
- Supplies prompt and system prompt files through Agent Execution Runtime.
- Produces design artifact commit request on valid output.
- Does not write state directly.
- Does not write approval or decision files.
- Handles invalid child output as failed result.
- Handles timeout/non-zero child result as failed result.

### Unit tests: `SpecPlanPhaseAdapter`

- Calls `runAgent()` with role `plan-author`.
- Requires approved design context.
- Produces requirements/tasks artifact commit request on valid output.
- Does not execute tasks.
- Does not modify design.
- Does not write approval or decision files.
- Handles invalid child output as failed result.

### Unit tests: `SpecExecPhaseAdapter` deferred boundary

- Does not hand full `tasks.md` to LLM for uncontrolled execution.
- If controlled execution is unavailable, returns blocked/unavailable result.
- Does not mark plan complete or workflow done.
- Does not introduce an uncontrolled execution-review lifecycle.

### Integration tests

- Start workflow with fake child produces versioned `design.md`.
- Design generation stops at `awaiting-design-review-decision`.
- Approve design then planning produces versioned `requirements.md` and `tasks.md`.
- Planning stops at `awaiting-plan-review-decision`.
- No planning before design approval.
- No execution before plan approval.
- Adapter failure is recoverable through resume/retry.
- Fake child malformed output fails closed.

### Security tests

- Adapters do not write approvals.
- Adapters do not write decisions.
- Adapters do not directly mutate `state.json`.
- Adapters cannot commit artifacts outside topic dir.
- Child invocation still uses `--no-session`.
- Child invocation still uses `--no-skills`.
- No generic subagent public API introduced.
- No arbitrary chain/parallel/async public API introduced.
- Execution placeholder does not perform uncontrolled task execution.

## Open Questions

The following questions are intentionally deferred to the follow-up `controlled-spec-exec-adapter` spec:

1. How exactly should `tasks.md` be parsed into phases, tasks, optional tasks and checkpoints?
2. Where should one-time optional execution mode be selected and persisted?
3. What is the exact schema for single-task LLM execution result?
4. How should `TaskCheckboxWriter` update `tasks.md` and record progress events?
5. Should every task checkbox update create a new versioned tasks artifact, or should runtime append task progress events and commit a final tasks artifact version when execution stops?
6. How should unauthorized `tasks.md` mutations be detected if child modifies the file directly?
7. What should the exact execution report artifact layout be?
8. How should blocked execution resume from the failed/current task?

Confirmed decisions for that follow-up spec:

- Execution must use code-owned task loop.
- LLM executes one current task at a time.
- Checkpoints are executed by LLM as current tasks, not by a separate deterministic checkpoint validator.
- Code owns checkbox updates.
- LLM must not update `tasks.md` progress markers.
- `requirements.md` is acceptance source of truth.
- `design.md` is background only.
- Execution must not revise approved plan or approved requirements.
- Execution completion should transition directly to `done` when required tasks/checkpoints complete, blockers are absent, and execution report/progress are recorded. Default execution-review is intentionally out of scope to avoid terminal LLM review loops.
