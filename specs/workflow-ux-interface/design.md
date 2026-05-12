# Workflow UX Interface Design

## Summary

新增 **Workflow UX Interface**，将 `/brainstorm-pro` 收敛为 Brainstorming Pro 的统一用户入口和状态展示层。该 spec 负责把 workflow runtime、design review execution control、triage/readiness、design revision handoff、automatic plan review 和 approval gates 的状态以清晰、可恢复、可审计的方式呈现给用户，并把用户选择转换为 runtime 可验证的 decision input。UX 层不拥有生命周期权威：它不直接修改 workflow state、artifact、review ledger、approval 或 event log；所有状态迁移、artifact binding、review/retry/accept-incomplete/approval validation 仍由 runtime 代码强制执行。

## Goals

- 保持 `/brainstorm-pro` 作为唯一默认 public workflow command。
- 让 `/brainstorm-pro --resume [topic]` 成为主恢复和用户决策入口。
- 保留 `/brainstorm-pro --status [topic]` 作为只读状态与诊断入口。
- 支持多个 pending workflow 的安全选择展示，避免 UX 猜测用户想恢复哪个 topic。
- 清晰展示 workflow phase、pending decision、latest artifact refs、version 和 checksum binding。
- 展示 design review mode decision：`skip | minimal | full`。
- 展示 full design review reviewer selection，包括默认全选、选择一个或多个 reviewer、role 说明和 exact design artifact binding。
- 展示 partial / incomplete design review 状态，包括 selected / unselected / succeeded / failed reviewer coverage。
- 展示 failed reviewer retry 交互选项，包括只重试失败 reviewer、重新选择 reviewer set、退出或查看 ledger/status。
- 展示 accept incomplete review 交互，明确提示 incomplete coverage、失败 reviewer、已聚合 findings，并要求用户显式确认。
- 展示 design approval 和 plan approval gates，强调 review readiness 不等于 approval。
- 展示 review summary、triage/readiness summary、revision handoff 和 blocked/failed recovery hints。
- 展示 automatic plan review 结果，但不提供 plan review `skip | minimal | full` mode 或 reviewer subset 选择。
- 为 future Pi tool interface 保留稳定 intent contract。
- 为 Spec 8 `workflow-tui-live-progress` 提供可复用 view-model 边界，但不实现 live TUI widget。

## Primary Users / Roles

- **Workflow user**：希望只记住少量命令，就能启动、恢复、审阅、批准或处理 blocked workflow。
- **Brainstorming Pro maintainer**：需要一个可测试、可扩展、不会绕过 runtime gate 的 command UX 层。
- **Security / reliability reviewer**：需要确认 UX 不会把 partial/incomplete/stale/blocked 状态渲染成 passed 或 approved。
- **Design review operator**：需要在 full review 中选择 reviewer subset、理解 reviewer coverage、重试失败 reviewer 或显式接受 incomplete review。
- **Future TUI/tool implementer**：需要稳定 view-model 和 intent contract，后续可以在不改变 runtime authority 的前提下增加 live UI 或 tool interface。

## Non-Goals

- 不重新实现 workflow state machine。
- 不重新设计 artifact store、event log、review ledger、approval ledger 或 revision ledger。
- 不实现 design reviewer prompt、reviewer execution、triage algorithm、design revision loop、plan review panel 或 controlled execution loop。
- 不新增默认 public command surface，例如 `/brainstorm-pro approve-design`、`/brainstorm-pro approve-plan`、`/brainstorm-pro review --mode full`。
- 不把细粒度 helper flags 作为默认主路径；它们最多是测试、自动化或高级快捷方式，且必须通过 runtime validation。
- 不让 UX 层直接写 `state.json`、`.workflow/events.jsonl`、`.workflow/reviews/*`、`.workflow/approvals/*` 或 top-level markdown artifacts。
- 不让 UX 层自动 approve design、approve plan、accept incomplete review、retry reviewers 或 authorize revision。
- 不为 plan review 提供用户选择 mode、reviewer subset、partial accept 或 per-reviewer retry。
- 不实现 live progress widget、spinner、expanded/compact TUI 或 animation lifecycle；这些属于 Spec 8 `workflow-tui-live-progress`。
- 不暴露 generic subagent orchestration、arbitrary chain 或 background async runner。

## Context

Brainstorming Pro 当前 public command surface 已收敛为：

```text
/brainstorm-pro "<request>"
/brainstorm-pro "<request>" --topic <existing-topic>
/brainstorm-pro --topic <existing-topic>
/brainstorm-pro --resume [topic]
/brainstorm-pro --status [topic]
```

当前实现中 `extensions/clarification-orchestrator/commands/brainstorm-pro.ts` 已经包含基础 parser 和 command handler，并把 start / augment / resume / status 调用转发到 `workflow/runtime.ts`。`WorkflowRuntimeOrchestrator` 已经暴露 `startWorkflow()`、`augmentWorkflow()`、`resumeWorkflow()` 和 `getStatus()`，并由 runtime 负责 phase transition、artifact commit、review decision、approval gate 和 fail-closed behavior。

已有实现的主要 UX 缺口是：

- `renderRuntimeResult()` 只显示非常基础的 topic、run id、phase 和 pending decision。
- 多 pending workflow 只返回 topic 列表，没有 phase / pending gate / next action 摘要。
- design review decision 没有完整展示 design artifact binding、mode 语义、full reviewer roles 和 unavailable/partial/retry/accept-incomplete recovery。
- status 输出没有用户友好的 triage/readiness/revision handoff 展示。
- plan review readiness、automatic revision attempt 和 plan approval gate 没有专门视图。
- blocked/failed 状态缺少 recovery hints 和 ledger/status 路径说明。

上游 spec 对本 spec 的输入约束包括：

- Spec 1 `workflow-runtime-orchestrator`：runtime owns lifecycle，approval gates 和 review decisions 必须由代码强制。
- Spec 5 `design-review-panel`：design review run、finding schema、ledger、minimal/full capability 和 artifact binding。
- Spec 5.1 `design-reviewer-role-pack`：full design review 的五个 package-owned reviewer。
- Spec 5.2 `design-review-execution-control`：reviewer selection、partial coverage、failed reviewer retry 和 accept incomplete decision。
- Spec 5.3 `design-review-triage-and-readiness`：triage/readiness report、must-fix/should-fix/note、conflicts 和 unresolved questions。
- Spec 5.4 `design-revision-loop`：single-use design revision authorization、post-revision review handoff 和 stale evidence rules。
- Spec 6 `plan-review-panel`：automatic fixed three-reviewer plan review、one-shot plan revision 和 explicit plan approval gate。

## Discovery

### Key Discoveries

- Spec 7 的核心不是增加更多命令，而是让用户在复杂 runtime gates 上看懂当前状态和安全下一步。
- UX 层必须忠实表达 runtime 状态，不能为了简化输出隐藏 `partial`、`incomplete-review`、`stale`、`blocked`、`failed` 或 checksum binding。
- Design review 与 plan review 的用户模型不同：design review 有用户 mode decision 和 full reviewer selection；plan review 是 planning 后自动执行的固定文档校验。
- Accept incomplete review 必须是独立显式确认，不能被合并进 approve design，也不能被渲染为 passed review。
- Review readiness、triage readiness、passed review 和 user approval 是不同概念；UX 必须持续提醒用户 approval gate 仍需显式确认。
- Revision handoff 需要单独展示，因为旧 review/triage 只能作为 provenance，不能批准新版 design。
- 多 pending workflow 场景不能自动猜测 topic，除非 runtime 明确只有一个 pending workflow。
- 当前 `--choose-review` / `--decision` helper flags 可以保留为高级/测试入口，但不应成为默认用户心智模型。
- 首版采用 deterministic text rendering + explicit next-command hints 更容易测试，也避免与 Spec 8 live TUI 重叠。

### Scope Decisions

包含：

- `/brainstorm-pro` command handler UX contract。
- Argument parser 的默认 public options 和 helper flag 约束。
- State-aware renderer / view-model。
- Multi-topic selection view。
- Design review decision view。
- Full reviewer selection view。
- Partial/incomplete review recovery view。
- Accept incomplete confirmation view。
- Design approval view。
- Plan review / plan approval view。
- Blocked/failed/done status view。
- Optional future tool interface boundary。

排除：

- Live TUI widget 和 progress animation。
- Review/revision/plan review/execution 的内部实现。
- 新 public subcommands。
- UX-owned state mutation。
- Generic subagent UX。

## Proposed Solution

采用 **thin UX facade over workflow runtime**。`/brainstorm-pro` command handler 解析用户 intent，调用 `WorkflowRuntimeOrchestrator`，然后把 runtime 返回的 state/status/recovery contract 渲染成可理解的文本视图和下一步命令提示。UX 层只表达 intent，不拥有状态迁移权威。

核心原则：

```text
User remembers one command.
Resume is state-aware.
Status is read-only.
Runtime validates every decision.
UX renders exact bindings and recovery choices.
Partial is never passed.
Readiness is never approval.
Plan review is automatic and fixed.
```

首版 UX 输出采用 deterministic text rendering，而不是交互式 TUI。后续如果 Pi command context 支持安全选择器，可以在相同 view-model 上增加 interactive selection；但 interactive UI 不替代 runtime validation，也不属于首版必要条件。

### Architecture

```text
User / Parent LLM
  ↓
/brainstorm-pro command handler
  ├─ parseBrainstormProArgs()
  ├─ resolve command action
  ├─ call WorkflowRuntimeOrchestrator
  │    ├─ startWorkflow()
  │    ├─ augmentWorkflow()
  │    ├─ resumeWorkflow()
  │    └─ getStatus()
  └─ renderWorkflowUxResult()
       ├─ workflow selection view
       ├─ phase summary view
       ├─ design review decision view
       ├─ design review recovery view
       ├─ design approval view
       ├─ plan review / plan approval view
       ├─ blocked / failed recovery view
       └─ done view
```

UX view-model 是只读 projection，不是 authoritative workflow state：

```ts
type WorkflowUxView =
  | WorkflowSelectionView
  | WorkflowStatusView
  | DesignReviewDecisionView
  | DesignReviewRecoveryView
  | DesignApprovalView
  | PlanReviewView
  | PlanApprovalView
  | BlockedRecoveryView
  | DoneView;
```

所有 view 都应包含足够的 next action hints，例如：

```text
Next:
  /brainstorm-pro --resume <topic>
  /brainstorm-pro --status <topic>
```

当 helper flags 可用时，可以展示高级命令示例；当 runtime 尚未支持某类 decision 时，UX 只能展示状态和说明，不能伪造执行能力。

### Components

#### 1. BrainstormProCommandHandler

路径：

```text
extensions/clarification-orchestrator/commands/brainstorm-pro.ts
```

职责：

- 保持 `/brainstorm-pro` 作为唯一默认 public workflow command。
- 调用 argument parser。
- 调用 runtime start / augment / resume / status。
- 调用 UX renderer 输出 deterministic text。
- 使用 `ctx.ui.notify()` 输出用户可见信息。
- 不直接写 runtime state、artifacts、reviews、approvals 或 events。

#### 2. BrainstormProArgumentParser

当前 `parseBrainstormProArgs()` 继续作为 parser foundation。默认 public forms：

```text
/brainstorm-pro "<request>"
/brainstorm-pro "<request>" --topic <existing-topic>
/brainstorm-pro --topic <existing-topic>
/brainstorm-pro --resume [topic]
/brainstorm-pro --status [topic]
```

Parser 规则：

- `--resume` 和 `--status` 互斥。
- Runtime decision helper flags 必须搭配 `--resume`。
- `--topic` 必须通过 strict English kebab-case validation。
- Unknown flags fail closed。
- Helper flags 只做语法级验证；phase、artifact binding、review readiness 和 approval readiness 由 runtime 验证。
- 任何 plan review mode helper flag 都应拒绝，并提示 plan review is automatic and fixed。

现有 helper flags 可保留为高级入口：

```text
--choose-review skip|minimal|full
--decision approve|revise|status|exit
```

未来可扩展 helper flags，但不得成为默认主路径：

```text
--reviewers product-reviewer,testing-reviewer
--retry failed-reviewers
--accept-incomplete
--authorize-design-revision
```

这些扩展必须映射到 runtime-owned decision types，并由 runtime 重新验证 exact artifact / review binding。

#### 3. WorkflowUxRenderer

建议新增模块：

```text
extensions/clarification-orchestrator/workflow/ux-renderer.ts
```

或 command-local renderer：

```text
extensions/clarification-orchestrator/commands/brainstorm-pro-renderer.ts
```

职责：

- 替换当前基础 `renderRuntimeResult()`。
- 将 runtime state/status 转换为 deterministic user-facing text。
- 展示 phase、pending decision、artifact refs、review status、triage summary、plan review readiness 和 recovery actions。
- 对 unknown/unsupported status 使用 safe fallback，不能误报 ready/passed/approved。
- 输出 next command hints。

Renderer 输入应优先使用 runtime 已暴露的 status object；如需要更丰富信息，应扩展 runtime status contract，而不是读取私有 ledger 文件绕过 runtime。

#### 4. WorkflowSelectionView

用于 `resume/status` 未指定 topic 且存在多个 runtime-managed workflows。

展示内容：

- topic；
- latest run id；
- phase；
- pending decision type；
- last error summary，如有；
- next commands。

规则：

- 多个 topic 时不自动选择。
- 如果没有 runtime-managed workflows，显示明确空状态。
- selection view 不启动或推进任何 workflow。

#### 5. PhaseSummaryView

所有 status/resume 输出都应包含基础 summary：

```text
Workflow: <topic>
Run: <run-id>
Phase: <phase>
Pending: <pending decision type, if any>
```

如果有 artifacts，展示：

```text
Artifacts:
- design v<N> <path> <checksum-prefix>
- requirements v<N> <path> <checksum-prefix>
- tasks v<N> <path> <checksum-prefix>
```

Checksum 可显示短前缀，但如果用于用户确认，应保留可查看完整 checksum 的路径或 status 输出。

#### 6. DesignReviewDecisionView

用于 `awaiting-design-review-decision`。

必须展示：

- 当前 design artifact ref：kind、version、path、checksum。
- Choices：`skip`、`minimal`、`full`、`revise`、`exit`。
- `skip` 说明：显式用户选择，会记录为 skipped review，不是隐式 no-op。
- `minimal` 说明：运行 workflow-owned lightweight review。
- `full` 说明：运行 full design reviewer role pack；默认全选五个 reviewer。
- Full reviewer role descriptions：
  - `product-reviewer`：验证用户价值、目标和范围适配。
  - `architecture-reviewer`：验证结构、边界和集成方案。
  - `risk-security-reviewer`：验证安全、信任边界和失败模式。
  - `testing-reviewer`：验证可测试性和验证策略。
  - `scope-simplicity-reviewer`：验证 YAGNI、复杂度和范围裁剪。
- Reviewer selection 绑定 exact design version/checksum；design 改变后 selection stale。

#### 7. DesignReviewRecoveryView

用于 design review `partial`、`failed`、`blocked`、`unavailable` 或 readiness `incomplete-review` 等状态。

必须展示：

- review run id；
- review mode；
- readiness status；
- ledger path；
- selected reviewers；
- unselected reviewers；
- succeeded reviewers；
- failed reviewers；
- blocking findings count；
- triage summary；
- recovery actions。

关键 UX 文案：

```text
Partial review is not a passed review.
Incomplete review coverage is not approval readiness.
Accepting incomplete coverage only moves to the design approval gate; it does not approve the design.
```

Allowed recovery actions 由 runtime status contract 决定，UX 只能展示 runtime 允许的动作，例如：

- retry failed reviewers；
- replace reviewer selection；
- accept incomplete review；
- authorize design revision；
- answer blocking revision questions；
- view status / ledger；
- exit。

#### 8. AcceptIncompleteConfirmationView

当 runtime 允许 accept incomplete review 时，UX 必须单独展示确认文本。

展示内容：

- incomplete coverage summary；
- failed reviewer list；
- succeeded reviewer list；
- aggregated findings summary；
- blocking findings 是否为 0；
- exact design ref；
- accept incomplete 的后果。

确认语义：

```text
Accept incomplete review = user accepts missing reviewer coverage for this exact design review.
It does not approve the design.
It only allows the workflow to proceed to awaiting-design-approval.
```

如果存在 blocking findings、无 succeeded reviewer、artifact stale 或 runtime 未允许该 action，UX 不得展示 accept incomplete 作为可执行下一步。

#### 9. DesignApprovalView

用于 `awaiting-design-approval`。

必须展示：

- design artifact ref；
- review mode；
- review status；
- readiness status；
- triage summary；
- must-fix / should-fix / note counts，如可用；
- conflicts / unresolved questions，如可用；
- skipped review warning，如 applicable；
- accepted-incomplete warning，如 applicable；
- revision handoff，如 applicable；
- choices：`approve | revise | status | exit`。

重要提示：

```text
Design approval is a separate explicit user gate.
Review readiness or triage readiness never approves the design automatically.
```

#### 10. RevisionHandoffView

当 `reviewStatus.design.revisionHandoff` 存在时展示。

展示内容：

- revision id；
- revised design ref；
- post-revision review run id；
- post-review readiness；
- triage summary；
- blocking question ids，如有；
- next recovery actions。

规则：

- 明确旧 review/triage 只是 provenance，不能作为新版 design 的 approval evidence。
- 如果 post-revision review passed，仍停在 design approval gate。
- 如果 post-revision review blocked/failed/partial/unavailable，UX 展示 user decision handoff，不自动再次 revise。

#### 11. PlanReviewView

用于 `plan-review`、plan review blocked/failed diagnostics、以及 status 中的 plan review summary。

必须展示：

- approved design ref；
- current requirements ref；
- current tasks ref；
- automatic plan review run id；
- ledger path；
- fixed reviewer set：
  - `requirements-coverage-reviewer`；
  - `task-coverage-reviewer`；
  - `dependency-order-reviewer`；
- readiness：
  - `ready-for-plan-approval`；
  - `blocked-needs-plan-revision`；
  - `blocked-needs-design-revision`；
  - `failed`；
  - `stale`；
- automatic plan revision attempt status；
- next action。

必须明确：

```text
Plan review is automatic and fixed.
There is no skip/minimal/full mode for plan review.
Plan approval still requires explicit user approval.
```

#### 12. PlanApprovalView

用于 `awaiting-plan-approval`。

必须展示：

- approved design ref；
- reviewed requirements/tasks refs；
- latest requirements/tasks refs；
- plan review readiness；
- any plan revision handoff；
- choices：`approve | revise | status | exit`。

UX 必须强调 runtime 会验证 plan approval 是否匹配 latest ready automatic plan review binding；如果 requirements/tasks 与 ready review 不匹配，approval 会被拒绝。

#### 13. BlockedFailedRecoveryView

用于 `blocked` 和 `failed` phase。

展示内容：

- phase；
- lastError message；
- original phase；
- recoverable；
- diagnostics；
- recovery actions；
- ledger/status paths；
- safe next commands。

规则：

- Blocked/failed 不因普通 `--resume` 自动推进。
- 如果 runtime 没有提供 recovery action，UX 只提示 inspect status / ledger / fix underlying issue。
- Failed non-recoverable state 不显示 retry/approve 等动作。

#### 14. DoneView

用于 `done`。

展示内容：

- topic；
- run id；
- final artifacts；
- execution report summary，如可用；
- terminal status。

Done 状态不展示 resume action，只展示 status/artifact paths。

#### 15. Future Pi Tool Interface

保留可选 tool interface：

```ts
type BrainstormingProToolInput =
  | { action: "start"; topic?: string; request: string }
  | { action: "augment"; topic: string; request: string }
  | { action: "resume"; topic?: string; decision?: RuntimeUserDecision }
  | { action: "status"; topic?: string };
```

约束：

- Tool 只表达 intent。
- Tool 必须调用同一个 runtime path。
- Tool 不能绕过 artifact binding、review gate、accept-incomplete gate 或 approval gate。
- Tool 不暴露 arbitrary subagent orchestration。

### Data Flow

#### Start workflow

```text
User: /brainstorm-pro "request"
  ↓
parse args
  ↓
propose safe topic
  ↓
runtime startWorkflow()
  ↓
state created in designing
  ↓
UX renders started summary and next command hint
```

#### Resume with a single pending workflow

```text
User: /brainstorm-pro --resume
  ↓
runtime discovers exactly one pending topic
  ↓
runtime loads latest state
  ↓
if state is decision phase, runtime returns pending decision
  ↓
UX renders state-aware decision view
```

#### Resume with multiple pending workflows

```text
User: /brainstorm-pro --resume
  ↓
runtime returns selectionRequired topics
  ↓
UX renders topic selection view
  ↓
User resumes explicit topic
```

#### Design review decision

```text
User resumes topic at awaiting-design-review-decision
  ↓
UX renders design ref + skip/minimal/full choices
  ↓
User chooses review mode, optionally reviewer subset for full
  ↓
UX converts syntax to runtime decision
  ↓
runtime validates phase and exact design artifact binding
  ↓
runtime records decision and transitions
  ↓
UX renders result / next action
```

#### Partial full review recovery

```text
Design review returns partial/incomplete status
  ↓
runtime status exposes coverage + findings + recoveryActions
  ↓
UX renders incomplete coverage and safe recovery choices
  ↓
User chooses retry failed reviewers or accept incomplete
  ↓
runtime validates exact review/design binding
  ↓
runtime retries or records accept-incomplete decision
  ↓
if accepted, workflow enters awaiting-design-approval
```

#### Design approval

```text
Workflow phase = awaiting-design-approval
  ↓
UX renders design ref, review/readiness/triage summary, revision handoff if any
  ↓
User explicitly approves or requests revision
  ↓
runtime validates gate and transitions to planning or designing/revision path
```

#### Plan review and plan approval

```text
Planning commits requirements/tasks
  ↓
runtime automatically runs fixed plan review
  ↓
runtime may perform one automatic plan revision if allowed
  ↓
if ready, workflow enters awaiting-plan-approval
  ↓
UX renders plan review readiness and reviewed artifact refs
  ↓
User explicitly approves plan
  ↓
runtime validates current artifacts match latest ready plan review binding
  ↓
workflow enters executing
```

## Error Handling

- **Unknown option**：parser rejects with a clear message.
- **Missing request**：parser shows supported usage forms.
- **Invalid topic**：strict topic validation rejects before runtime path access.
- **`--resume` with multiple topics**：UX renders selection view; no workflow is advanced.
- **Decision helper without `--resume`**：parser rejects because decisions must go through resume.
- **Decision invalid for current phase**：runtime rejects or ignores fail-closed; UX renders current phase and allowed pending decision.
- **Unknown / duplicate / empty reviewer selection**：parser or runtime rejects; UX displays allowed full reviewer roles.
- **Plan review mode supplied**：reject and explain that plan review is automatic and fixed.
- **Stale artifact binding**：runtime rejects; UX asks user to re-run status/resume and bind to the latest artifact.
- **Partial review**：UX must not render as passed; only runtime-provided recovery actions are shown.
- **Accept incomplete unavailable**：UX must not show it as an executable action.
- **Approval mismatch**：runtime rejects; UX displays reviewed refs vs current refs if available.
- **Blocked phase**：UX displays diagnostics and recovery actions; it does not auto-advance.
- **Failed phase**：UX displays non-recoverable/recoverable status according to runtime; it does not offer unsafe retry/approval.
- **Renderer receives unknown status**：use safe fallback text/JSON and avoid words such as `ready`, `passed`, or `approved` unless explicitly present in runtime state.

## Testing

### Unit Tests

Parser tests under `tests/unit/commands/`:

- start request parsing;
- augment existing topic parsing;
- `/brainstorm-pro --topic <topic>` maps to resume;
- `--resume [topic]` parsing;
- `--status [topic]` parsing;
- `--resume` and `--status` mutual exclusion;
- helper flags rejected without `--resume`;
- unknown option rejection;
- invalid topic rejection;
- plan review mode helper rejection if introduced;
- reviewer selection parser validation if introduced: valid subset, duplicate role, unknown role, empty selection, minimal reviewer invalid.

Renderer tests under `tests/unit/workflow/` or `tests/unit/commands/`:

- selection required with no workflows;
- selection required with multiple workflows;
- phase summary includes artifact refs;
- awaiting design review decision renders `skip | minimal | full` and reviewer roles;
- skipped review approval warning;
- full review partial coverage summary;
- failed reviewer retry recovery hints;
- accept incomplete warning and confirmation text;
- design approval view with triage summary;
- revision handoff view;
- plan review ready view;
- plan review blocked-needs-plan-revision view;
- plan review blocked-needs-design-revision view;
- plan approval view;
- blocked state recovery view;
- failed state view;
- done view;
- unknown status safe fallback.

### Integration Tests

- `/brainstorm-pro --resume` with multiple runtime topics renders selection and does not advance state.
- Design review decision flow renders exact design artifact binding before decision.
- Full review partial result renders incomplete coverage and does not show approval as next action unless runtime has accepted incomplete and moved to approval gate.
- Accept incomplete decision, when supported by runtime, moves only to design approval gate and does not approve design.
- Plan review ready status renders explicit plan approval gate.
- Blocked/failed states do not auto-advance on resume.

### Documentation Alignment Tests

- README public command surface matches parser behavior.
- README documents helper flags as advanced/internal shortcuts, not default workflow path.
- README states plan review is automatic and fixed.
- README states review readiness is not approval.

## Open Questions

1. Should Spec 7 first implementation expose reviewer subset / retry / accept-incomplete as CLI helper flags, or only render the runtime recovery contract until interactive command support is available?
   - Recommended: design the contract now, implement helper flags incrementally only where runtime decision APIs already exist.

2. Should the initial renderer live beside the command handler or under `workflow/`?
   - Recommended: put pure rendering logic in a testable module, e.g. `workflow/ux-renderer.ts`, and keep command handler thin.

3. Should future interactive selection be part of Spec 7 or Spec 8?
   - Recommended: deterministic text + command hints belong to Spec 7; live/interactive TUI behavior belongs to Spec 8 unless it can be implemented as a thin wrapper around the same view-model without progress UI concerns.

4. Should optional Pi tool registration be implemented in Spec 7 or only designed?
   - Recommended: design the boundary in Spec 7; implement only if a stable package/tool registration requirement exists.
