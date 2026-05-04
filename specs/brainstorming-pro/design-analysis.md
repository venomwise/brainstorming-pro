# Brainstorming Pro Design Analysis

本文档记录对 `specs/brainstorming-pro/design.md` 的设计评审结果，重点分析这份 pi extension 设计文档中仍需澄清的盲点、实现前应补齐的约束，以及建议优化方向。

## 总体结论

`design.md` 的整体方向成立：它准确抓住了复杂需求澄清过程中的核心痛点，包括单一长上下文退化、独立评审价值、用户只应参与高价值产品决策、设计过程需要可追溯产物等。

作为 pi extension + skill + prompts + subagent workflow 的设计，它已经具备较清晰的产品目标和高层架构。但如果要进入实现阶段，目前仍偏向“概念设计”，还需要补齐若干 pi extension 运行机制、子进程协议、安全边界、状态恢复和结构化输出可靠性方面的细节。

建议在进入 `tasks.md` 或实现前，先修订设计文档，优先补齐：

1. pi package 中 `agents/` 的发现机制；
2. `/clarify` 在 interactive / RPC / print / JSON 模式下的行为；
3. 子 agent 的执行协议、工具权限、模型选择、超时、并发、取消；
4. 结构化输出的 runtime schema 校验与修复策略；
5. artifact 与 session state 的关系；
6. resume/status 是否纳入 v1；
7. 现有 `brainstorming` skill 与 `spec-plan` 的衔接边界；
8. 安全模型：项目内容、项目本地 agent、agent 产物都可能携带 prompt injection；
9. 用户决策门的具体 UX 和 fallback；
10. 终止条件和 “review vs verify” 的边界。

---

## 一、pi package / extension 机制上的盲点

### 1. `agents/` 不是 pi package 的标准资源类型

当前设计中的 package layout 包含：

```text
brainstorming-pro/
├── agents/
├── skills/
├── prompts/
└── extensions/
```

但根据 pi package 文档，pi package 自动发现的资源类型主要是：

- `extensions/`
- `skills/`
- `prompts/`
- `themes/`

并没有内建的 `agents/` 资源类型。官方 subagent example 中的 agents 是由 subagent extension 自己发现的，并不是 pi core/package 自动加载。

因此，设计中关于 “subagent definitions for designer, reviewers, triager, refiner, and verifier” 的部分需要明确：这些 agent markdown 是由 `clarification-orchestrator` extension 自己读取 package 内部路径，还是复用官方 subagent extension 的 agent discovery 机制。

#### 建议优化

在设计中新增一节：

```md
### Agent Definition Discovery

Brainstorming Pro does not rely on pi core to discover `agents/`.
The orchestrator resolves bundled agent files relative to its own package root.
User/project overrides are optional and controlled by config.
```

建议定义 agent 来源优先级：

1. bundled agents：随 package 发布，默认可信；
2. user-level overrides：例如 `~/.pi/agent/brainstorming-pro/agents/*.md`，可选；
3. project-local overrides：例如 `.pi/brainstorming-pro/agents/*.md`，默认禁用，需要用户确认。

否则实现时可能出现 package 安装后 agents 根本没有被发现的问题。

---

### 2. extension 命令、prompt template、skill 的职责边界不够清楚

设计中同时包含：

- `/clarify <topic>` extension command；
- `brainstorming-pro` skill；
- `prompts/clarify.md` 等 prompt templates。

但目前没有说清楚三者如何协作。

pi 中 extension command 会优先匹配并绕过普通 skill/prompt expansion。因此，如果 `/clarify` 是 extension 注册的命令，那么它本身不会自动触发 `/skill:brainstorming-pro`。

#### 需要澄清

- `brainstorming-pro` skill 是给主 agent 手动使用，还是给 subagent prompts 内嵌引用？
- `/clarify` 是否完全由 extension orchestration 驱动，不依赖主 agent？
- prompt templates 是用户可手动调用的替代入口，还是 extension 内部读取的 prompt 文件？
- 如果用户直接用 `/skill:brainstorming-pro`，预期行为是什么？

#### 建议优化

将入口分为两类：

```md
Primary entrypoint:
- `/clarify <topic>`: extension-owned, deterministic workflow.

Supporting resources:
- `skills/brainstorming-pro/SKILL.md`: methodology reference for agents and users.
- `prompts/*.md`: reusable prompt fragments loaded by the orchestrator, not necessarily direct user commands.
```

---

### 3. package manifest 缺失

设计列出了 package layout，但没有说明 `package.json` 中的 `pi` manifest。

#### 建议补充

```json
{
  "name": "brainstorming-pro",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./extensions/clarification-orchestrator"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

同时应明确：`agents/` 不在 `pi` manifest 中，而由 extension 自行读取。

---

## 二、子 agent 执行协议上的盲点

### 4. “spawn separate pi subprocesses in JSON mode” 不够具体

设计中提到：

> spawn separate `pi` subprocesses in JSON mode for each subagent invocation

但缺少关键执行协议：

- 用什么命令？
- 如何指定 model？
- 如何指定 system prompt？
- 如何限制 tools？
- 如何传递 cwd？
- 如何避免加载当前 extension 导致递归？
- 是否加载项目 skills/prompts/context？
- stdout JSON schema 是什么？
- stderr 如何区分日志和错误？
- 超时、取消、并发限制如何实现？
- API key / model availability 如何处理？

#### 建议补充 Subagent Execution Contract

```md
### Subagent Execution Contract

Each subagent invocation is executed as an isolated pi subprocess.
The runner must define:

- cwd;
- model selection and fallback;
- system prompt construction;
- allowed tools;
- timeout;
- cancellation behavior;
- stdout/stderr parsing;
- output schema;
- max output size;
- whether project-local resources are loaded.
```

如果子进程通过 CLI 启动，应在设计中明确类似协议：

```text
pi -p --json \
  --cwd <project-cwd> \
  --system-prompt <generated-agent-system-prompt> \
  --tools <allowed-tools> \
  --model <agent-model-or-current-model> \
  <task>
```

具体参数名应以 pi 实际 CLI 能力为准，但设计层面必须明确这些约束。

---

### 5. 子 agent 工具权限需要更严格

当前 reviewer/refiner/verifier 的工具权限没有定义。

#### 风险

- reviewer 不应该随意写文件；
- triager 不需要 bash；
- refiner 需要修改 `design.md`，但最好不要直接任意改项目代码；
- verifier 通常只需要 read；
- designer 可能需要 read/find/grep/bash，但 bash 应受限。

#### 建议权限划分

| Agent | 建议工具权限 |
|---|---|
| designer | read, find, grep, ls，必要时有限 bash；默认不写文件 |
| reviewers | read, grep, find, ls |
| triager | 无文件工具，或只读 artifacts |
| refiner | 不直接使用 write/edit；输出 revised design，由 orchestrator 写入 |
| verifier | read only |
| orchestrator | 仅在 `specs/<topic>/` 下执行文件 IO |

更安全的模式是：refiner 子 agent 不直接写文件，而是返回完整 revised design 或 patch，orchestrator 验证后写入 `design.md`。

---

### 6. 子进程递归加载 extension 的风险

如果 `/clarify` 的子 agent 通过 `pi` 子进程启动，而当前 package 已安装为全局或项目 package，那么子进程也可能加载 Brainstorming Pro extension。

#### 风险

- 子 agent prompt 中出现 `/clarify` 被误触发；
- extension 事件拦截影响子 agent；
- 多层 orchestration；
- 额外资源加载导致 prompt 污染；
- command 名冲突。

#### 建议优化

设计中明确子 agent 默认以最小资源环境运行，并设置环境变量防止递归：

```text
BRAINSTORMING_PRO_SUBAGENT=1
```

extension 检测到该环境变量时，可以不注册 `/clarify`，或禁用 orchestration，只保留必要能力。

---

## 三、用户交互与运行模式的盲点

### 7. `ctx.hasUI === false` 时的行为未定义

pi extension 的 `ctx.ui` 在 interactive / RPC 中可用，但在 print mode / JSON mode 下 UI 能力可能不可用或受限。

当前 `/clarify` 强依赖 User Decision Gate，但设计没有定义非交互环境行为。

#### 需要澄清

- `/clarify` 是否只支持 interactive？
- 在 `pi -p` / JSON / API 模式下如何返回待决议题？
- auto mode 是否允许无 UI 运行？
- hybrid/manual 在无 UI 下是否直接失败？
- 是否支持 `--decisions <file>` 输入决策？

#### 建议策略

```md
### Non-interactive Behavior

- manual/hybrid require UI. If `ctx.hasUI === false`, stop after triage and write `pending-decisions.md`.
- auto mode may continue without UI, but must stop on conflicts, scope-expanding issues, or low-confidence high-cost decisions.
- Future version may support `--decisions <file>` to resume from scripted decisions.
```

---

### 8. User Decision Gate 的 UX 过于抽象

Open Questions 中提到：

> simple markdown prompt, selectable TUI list, or both?

这个问题不应只留到实现阶段。第一版至少需要选定 fallback。

#### 建议

v1 采用双层方案：

1. MVP：markdown summary + numbered decisions prompt；
2. 后续增强：custom TUI checklist。

示例：

```text
P0/P1 items:
[1] P0 - Missing security model
    Recommendation: accept
    Cost: medium
    Risk if ignored: ...

Choose:
1=accept, 2=defer, 3=reject, 4=discuss
```

这样实现简单、可测试，也更容易兼容 RPC。

---

### 9. `needs-discussion` 流程未闭环

Decision format 允许：

```ts
decision: "accept" | "reject" | "defer" | "needs-discussion";
```

但 workflow 没有说明 `needs-discussion` 之后如何处理。

#### 需要定义

- 是暂停 workflow，进入对话？
- 讨论后必须变成 accept/reject/defer 吗？
- 讨论内容保存在哪里？
- 是否重新 triage？
- 是否允许 refiner 处理 needs-discussion？

#### 建议规则

```md
`needs-discussion` is terminal only for the gate interaction, not for the workflow.
Before REFINE, all issues at or above threshold must resolve to accept/reject/defer.
Discussion notes are appended to decision-log.md.
```

---

## 四、状态、artifact 与 resume 的盲点

### 10. artifact 只写 markdown，缺少机器可读 state

当前 artifact layout 基本都是 `.md`：

```text
03-review-r1.md
04-triage-r1.md
05-user-decisions-r1.md
```

但 orchestrator 是 state machine，需要稳定读取：

- 当前 round；
- issues；
- decisions；
- accepted issue IDs；
- verification status；
- unresolved items；
- maxRounds；
- config；
- timestamps；
- agent run metadata。

如果只靠 markdown parsing，会非常脆弱。

#### 建议

同时写两类 artifact：

```text
clarification/
├── state.json
├── issues-r1.json
├── decisions-r1.json
├── verification-r1.json
├── 03-review-r1.md
├── 04-triage-r1.md
└── decision-log.md
```

Markdown 用于人读，JSON 用于 orchestrator。

---

### 11. `resume/status` 不应完全推迟

Open Question 中问：

> Should the extension support resuming an interrupted clarification workflow in the first version?

建议：完整 resume 可以推迟，但最小 resume/status 应纳入 v1。

原因是设计中已经承诺：

- durable files；
- user abort preserves partial state；
- maxRounds；
- decision-log；
- workflow state machine。

如果没有最小 resume，用户 abort 后只能手动重来，和“durable state”的价值冲突。

#### 建议 v1 最小能力

增加命令或选项：

```text
/clarify-status <topic>
/clarify-resume <topic>
```

或：

```text
/clarify <topic> --resume
```

v1 resume 可以很保守：

- 读取 `state.json`；
- 如果停在 review/triage 后，继续下一步；
- 如果停在 user decision gate，重新展示 pending decisions；
- 如果 state 损坏，提示用户从哪个 artifact 手动恢复。

---

### 12. artifact 覆盖与 topic 冲突未定义

当前 flow 第 2 步直接创建：

```text
specs/<topic>/
```

但没有说如果目录已经存在怎么办。

#### 需要定义

- topic normalize 后重名怎么办？
- 已存在 `design.md` 是覆盖、继续、还是创建新 run？
- topic 是否允许路径片段 `../foo`？
- 是否允许中文 topic？
- kebab-case 规则是什么？

#### 建议

新增：

```md
### Topic and Path Safety

- Normalize topic to kebab-case.
- Reject path separators, `..`, absolute paths, and empty normalized names.
- If `specs/<topic>/design.md` exists, ask user:
  - resume existing clarification;
  - create new run under `clarification/run-<timestamp>`;
  - overwrite after confirmation;
  - abort.
```

---

## 五、结构化输出可靠性问题

### 13. TypeScript type 不是 runtime schema

设计中定义了：

```ts
type DesignIssue = { ... }
```

但子 agent 输出是 LLM 文本，需要 runtime validation。TypeScript type 对运行时没有约束。

#### 建议

明确使用 TypeBox 或 Zod：

```md
All structured outputs are validated with TypeBox schemas at runtime.
Invalid outputs trigger one repair pass.
Validated JSON is stored as canonical machine-readable artifact.
Markdown summaries are generated from validated JSON.
```

由于 pi extension 文档中也使用 TypeBox，优先使用 TypeBox 比较自然。

---

### 14. Issue ID 稳定性未定义

triager dedupe 后会生成 `issueId`，refiner/verifier 又要引用。但没有定义 ID 格式和稳定性。

#### 风险

- round 2 中同一 issue 被重新编号；
- verifier 找不到 accepted issue；
- decision-log 难追踪；
- duplicate issue 被拆分或合并后映射丢失。

#### 建议

定义 ID 格式：

```text
BP-R1-I001
BP-R1-I002
```

并保存来源关系：

```ts
type DesignIssue = {
  id: string;
  sourceIssueIds: string[];
  supersedes?: string[];
  duplicateOf?: string;
  // ...
};
```

---

### 15. evidence 字段需要限定

当前：

```ts
evidence: string[];
```

但没有定义 evidence 应该是什么。

#### 建议

第一版至少要求 evidence 包含：

- artifact path；
- quoted text；
- reason。

更完整的结构可以是：

```ts
type Evidence =
  | { type: "design-section"; section: string; quote: string }
  | { type: "artifact"; path: string; quote?: string }
  | { type: "repo-file"; path: string; lineStart?: number; lineEnd?: number; quote?: string };
```

---

## 六、workflow 边界与终止条件

### 16. REVIEW 和 VERIFY 的边界需要更硬

设计中提到：

> second review should usually verify accepted changes rather than reopen unlimited new ideation

但 state machine 和 additional rounds 仍暗示 round 2 可以重新进入完整 review / triage / decision 流程。

#### 风险

这会导致无限优化倾向，每一轮 review 都可能提出新的 P1/P2，从而偏离“验证 accepted decisions 是否完成”的目标。

#### 建议

明确 round 类型：

- Round 1：broad review；
- Round 2+：targeted verification/refinement only；
- 只有在用户明确请求，或 verifier 检测到新的 P0/P1 regression 时，才重新 broad review。

建议加入规则：

```md
After the first refinement, the default loop is VERIFY -> REFINE, not REVIEW -> TRIAGE.
A new REVIEW round requires explicit user approval or detection of a new P0/P1 regression.
```

---

### 17. maxRounds 的语义不清

`maxRounds = 2` 目前没有定义清楚是指：

- review/refine/verify 循环最多 2 次？
- refinement attempts 最多 2 次？
- 是否包含 initial design？
- verifier missing 后直接 refine 是否算一 round？

#### 建议定义

```md
maxRounds counts refinement attempts after initial design.
Default 2 means:
- initial design;
- broad review + triage + decisions;
- refinement attempt 1 + verification;
- optional refinement attempt 2 if accepted P0/P1 items are still missing.
```

---

### 18. threshold 与 automation mode 的关系需要精简

当前默认：

```text
mode = hybrid
threshold = P1
```

同时 hybrid 又说 P0/P1 展示，P2/P3 defer。这里 threshold 和 mode 的职责部分重复。

#### 建议

定义 threshold 的唯一职责：

```md
threshold controls which priorities require explicit handling.
In hybrid mode default threshold=P1.
Issues below threshold are summarized and deferred by default.
```

并统一表述为 “at or above threshold”，避免 “above P1” 被误解为仅 P0。

---

## 七、与现有 brainstorming / spec-plan 的关系

### 19. 初始 discovery 不建议直接调用现有 `brainstorming` skill

Open Question 中问：

> Should `/clarify <topic>` call the existing `brainstorming` skill directly...

建议不要直接调用现有 `brainstorming` skill 作为运行时依赖。

更推荐：

- Brainstorming Pro 的 designer prompt 镜像并吸收现有 brainstorming 方法论；
- `/clarify` 由 extension 控制流程；
- 不让原 `brainstorming` skill 的交互式流程和 terminal action 约束 automated workflow。

#### 原因

现有 `brainstorming` skill 是为主 agent 对话设计的，包含强交互和终止约束：

- 写 design doc；
- 用户 review gate；
- approval 后 invoke spec-plan as only next step。

如果 Brainstorming Pro 在子 agent 中直接使用这个 skill，可能导致：

- designer agent 要求用户一问一答；
- 子 agent 尝试触发 spec-plan；
- workflow 控制权混乱。

#### 建议设计决策

```md
Brainstorming Pro does not invoke the existing `brainstorming` skill as a command.
Instead, its designer agent prompt incorporates compatible methodology and explicitly disables spec-plan handoff.
The final approved `design.md` remains suitable input for `spec-plan`.
```

---

### 20. `--auto-spec-plan` 需要更谨慎

设计中有：

```text
--auto-spec-plan
```

但 `spec-plan` 是 skill，不是 extension API 的直接函数。自动调用可能意味着 extension 发送用户消息 `/skill:spec-plan ...` 或类似内容。

#### 风险

- 用户刚批准 design，不一定想立刻生成 requirements/tasks；
- spec-plan skill 有自己的输入要求；
- extension 调用 skill command 的方式需要明确；
- 自动进入下一阶段会增加不可控上下文。

#### 建议

默认保持 false。v1 可以先不实现自动调用，只输出下一步命令和上下文摘要。

如果未来实现，应明确：

```md
autoSpecPlan implementation:
- after final approval, extension sends a follow-up user message that invokes `/skill:spec-plan` with explicit context;
- only if skill command is enabled and available;
- otherwise print next-step instructions.
```

---

## 八、安全模型需要加强

### 21. 不只是 project-local agents 有风险

设计已经指出：

> project-local agent prompts must be treated as repo-controlled and potentially unsafe.

这是正确的，但风险范围还应扩大。

#### 其他风险来源

1. repo 中的 README / docs / source 注释可能包含 prompt injection；
2. reviewer output 是 LLM 生成内容，refiner 会读取，也可能携带指令注入；
3. triager output 会影响 user gate；
4. artifacts 在项目目录中，可能被用户或恶意 repo 修改；
5. subagent 可能加载 project-local skills/prompts/extensions。

#### 建议新增 Trust Boundaries

```md
### Trust Boundaries

- Bundled package prompts are trusted as package code.
- Project files are untrusted input.
- Project-local agents/prompts/skills/extensions are disabled by default.
- Subagent outputs are untrusted data, not instructions.
- The orchestrator passes prior agent outputs inside delimited data blocks and instructs downstream agents not to follow embedded instructions.
- Machine-readable JSON artifacts are schema validated before use.
```

核心原则：agent output 是 data，不是 instruction。

---

### 22. artifact path 是攻击面

`/clarify <topic>` 如果 topic 未严格处理，可能造成路径穿越：

```text
/clarify ../../.ssh
/clarify specs/foo
/clarify foo/bar
```

应通过 Topic and Path Safety 规则拒绝：

- path separators；
- `..`；
- absolute paths；
- empty normalized names。

---

### 23. refiner 直接写 `design.md` 需要保护

如果 refiner 是子 agent 且有 write/edit 工具，它可能越权改其他文件。

#### 建议改为 orchestrator 写文件

```md
The refiner agent does not directly write files in v1.
It returns revised design content and change log.
The orchestrator writes the file after validation.
```

这样可以降低权限风险，也更容易测试。

---

## 九、成本、性能、并发

### 24. reviewer 并行数量与模型成本未定义

默认 reviewers 有 4 个，再加上 designer、triager、refiner、verifier，单轮至少 8 次模型调用。如果每个都是高能力模型，成本和延迟都可能明显。

#### 建议补充

- reviewer 并发上限；
- per-agent model 默认值；
- max input size；
- timeout；
- cost summary；
- `--reviewers minimal|standard|full`。

示例：

```text
--reviewers standard
standard = product,architecture,risk,testing
minimal = product,architecture
full = product,architecture,risk,testing,security,docs
```

模型策略建议：

```md
By default, subagents use the current pi model unless agent frontmatter specifies a model.
If the specified model is unavailable, fallback to current model with a warning.
```

---

### 25. 上下文裁剪策略还太泛

设计里有：

> Context too large: pass summarized artifacts and direct file paths instead of full history where possible.

但还可以更具体地定义每类 agent 的输入上下文：

- designer：可读项目上下文；
- reviewers：读取 `design.md` + discovery summary + selected repo context；
- triager：只读 review JSON；
- refiner：只读 design + accepted decisions；
- verifier：只读 previous design + refined design + accepted decisions。

这样可以降低成本，也减少 prompt injection 面。

---

## 十、测试计划补充建议

当前测试方向合理，但建议补充以下测试类型。

### Security Tests

- topic path traversal 被拒绝；
- project-local agents 默认不加载；
- project-local agents enabled 时需要确认；
- subagent output 中包含恶意指令时不会被 orchestrator 当 instruction 执行；
- refiner 不能写出 `specs/<topic>/` 之外。

### Non-interactive Tests

- no UI + manual mode 停在 pending-decisions；
- no UI + hybrid mode 停在 pending-decisions；
- no UI + auto mode 可继续；
- no UI + high-cost low-confidence issue 停止并写 artifact。

### Resume Tests

- abort after review 后 resume；
- abort during user gate 后 resume；
- corrupted `state.json` 的降级提示；
- existing `design.md` 冲突处理。

### Subagent Runner Tests

- timeout kills process；
- cancellation kills process group；
- invalid JSON repair once；
- stderr captured；
- unavailable model fallback；
- max output size truncation artifact。

---

## 十一、Open Questions 的建议答案

### Q1: Should `/clarify` call existing `brainstorming` skill?

建议：不要直接调用。

采用 Brainstorming Pro 自己的 designer prompt，吸收现有 `brainstorming` 方法论，但不要执行其完整 skill workflow。

原因：

- 原 skill 是交互式主 agent 流程；
- 会和 orchestrator state machine 冲突；
- 可能错误触发 spec-plan；
- 子 agent 中一问一答不适合自动化。

---

### Q2: Should final approval automatically invoke `spec-plan`?

建议：默认不自动调用。

保留 `--auto-spec-plan` 作为后续增强或 opt-in。v1 最好只输出下一步命令和上下文摘要。

---

### Q3: Decision gate UI 用什么？

建议：v1 用 markdown/numbered prompt，后续再做 TUI checklist。

原因：

- 实现简单；
- 可测试；
- 兼容 RPC；
- 不阻塞核心 workflow。

---

### Q4: Reviewer agents configurable globally, per project, or per invocation?

建议优先级：

1. bundled default reviewers；
2. per invocation `--reviewers`；
3. user-level config；
4. project-level config later，默认禁用或需确认。

不要 v1 就让 project-local reviewer 任意覆盖默认 reviewer。

---

### Q5: P2 deferred items 放哪里？

建议：

- canonical：`decision-log.md` / `issues-rN.json`；
- final `design.md` 只包含少量明确的 “Future Considerations”，且不能污染当前 scope。

规则：

```md
Deferred P2/P3 items are not requirements.
They may be summarized in a Future Considerations section only if useful.
```

---

### Q6: Resume support v1 做不做？

建议：做最小 resume/status。

完整智能恢复可以推迟，但至少要有：

```text
/clarify <topic> --resume
/clarify-status <topic>
```

以及 `state.json`。

---

## 十二、建议新增或修改的设计章节

建议在 `design.md` 中新增以下章节。

### 1. Package Resource Loading

说明：

- pi package manifest；
- extension/skill/prompt 如何加载；
- bundled agents 由 orchestrator 自己发现；
- agents override 策略。

### 2. Subagent Execution Contract

说明：

- 子进程命令协议；
- cwd；
- model；
- tools；
- env flags；
- timeout；
- cancellation；
- output schema；
- stderr/stdout handling；
- recursion prevention。

### 3. Runtime State and Machine-readable Artifacts

说明：

```text
state.json
issues-r1.json
decisions-r1.json
verification-r1.json
```

并定义 `WorkflowState`。

### 4. Trust Boundaries and Prompt Injection Defense

说明：

- project files untrusted；
- project-local resources disabled by default；
- agent outputs are data, not instructions；
- schema validation；
- path safety；
- refiner 不直接写文件。

### 5. Non-interactive Behavior

说明：

- `ctx.hasUI` false；
- manual/hybrid fallback；
- auto mode behavior；
- pending decisions artifact。

### 6. Resume / Status

说明：

- v1 minimal resume；
- command options；
- recoverable states；
- corrupted state fallback。

---

## 十三、优先级排序

### P0：必须澄清

1. `agents/` 如何被 package/extension 发现；
2. subagent execution contract；
3. runtime JSON schema validation；
4. topic/path safety；
5. non-interactive/user gate behavior；
6. refiner 是否直接写文件；
7. `brainstorming` skill 与 `/clarify` 的职责边界。

### P1：强烈建议补齐

1. `state.json` 与 minimal resume；
2. issue ID 稳定规则；
3. reviewer/refiner/verifier 工具权限；
4. prompt injection trust boundary；
5. maxRounds 精确定义；
6. REVIEW vs VERIFY 循环边界。

### P2：可以后续演进

1. custom TUI checklist；
2. advanced reviewer configuration；
3. cost dashboard；
4. full resume with branching；
5. rich evidence object；
6. auto spec-plan。

---

## 最终评价

这份设计的产品方向和架构分层是好的：

- extension 负责 orchestration；
- agents/prompts/skills 负责 reasoning policy；
- artifacts 负责 durable state；
- user gate 负责产品决策；
- verifier 控制闭环质量。

但当前版本还需要进一步落地到 pi extension 的实际约束中。最需要修的是：package agents 发现、subagent runner 协议、交互/非交互模式、机器可读状态、安全边界、resume 最小能力。

如果这些补齐，这个设计就可以比较稳地进入 `spec-plan` 阶段。

---

## 十四、实现策略调整：首版一步到位

用户明确偏好：不按 v1/v2 分阶段拆分实现；只要当前能力可实现，就应在首轮实现中一次性做到完整闭环。后续迭代仅用于新增功能或修复 bug，而不是把当前设计中已经确认的核心能力推迟到未来版本。

因此，前文中提到的 “v1 可以推迟”、“后续增强”、“later” 等建议应按以下原则重新解释：

1. 如果某能力属于 Brainstorming Pro 当前核心目标的一部分，并且技术上可实现，应纳入初始实现范围。
2. 只有明显属于额外产品增强、非核心体验优化、或实现成本显著高于当前收益的能力，才标记为后续迭代。
3. 实现计划不应以 MVP 为目标，而应以“可完整运行的 production-ready clarification workflow”为目标。
4. 后续迭代主要用于：
   - 新 reviewer 类型；
   - 新 UI 形态；
   - 更多配置入口；
   - 成本优化；
   - bug 修复；
   - 与其他 pi package 的高级集成。

### 调整后的初始实现基线

以下能力应视为首轮实现的必备范围，而不是未来版本：

- `/clarify <topic>` 完整工作流；
- package resource loading；
- bundled agent discovery；
- subagent execution contract；
- reviewer / triager / refiner / verifier 全流程；
- structured JSON schema validation；
- markdown + JSON 双格式 artifacts；
- `state.json`；
- resume/status；
- topic/path safety；
- project-local agent 安全确认；
- prompt injection trust boundary；
- manual / hybrid / auto modes；
- non-interactive fallback；
- user decision gate；
- stable issue IDs；
- bounded review/refine/verify loop；
- artifact overwrite/resume 冲突处理；
- subagent timeout/cancellation/error handling；
- refiner 不直接写任意文件，由 orchestrator 应用结果；
- final approval 后输出明确的 spec-plan handoff 指令；
- comprehensive unit/integration/security/resume tests。

### 仍可作为后续新增功能的内容

以下内容可以不阻塞首轮实现，因为它们属于体验增强或额外扩展，而非核心闭环能力：

- custom TUI checklist；
- richer visual dashboard；
- advanced cost analytics；
- additional reviewer packs；
- user-defined reviewer marketplace/package mechanism；
- automatic `spec-plan` invocation；
- complex multi-run comparison；
- collaborative/multi-user decision workflow。

### 对任务规划的影响

后续生成 `requirements.md` 和 `tasks.md` 时，不应把核心能力拆成“先做 MVP，未来再补完整能力”。任务可以按工程依赖顺序拆分，但每个模块都应服务于完整目标：一次性交付可恢复、可验证、可安全运行的 Brainstorming Pro clarification workflow。

---

## 十五、对 design-supplement.md 的评审与吸收建议

`specs/brainstorming-pro/design-supplement.md` 是有必要的。它把 `design-analysis.md` 中提出的 P0/P1 风险进一步落成了可实现的设计方案，尤其补足了错误恢复、进度反馈、配置系统、可观测性、artifact 历史、并发资源管理、边界场景和质量保证机制。

总体建议：应将其中大部分内容吸收到正式 `design.md` 中，但不是原样照搬。部分方案需要根据 pi extension 的实际约束、安全边界，以及“首版一步到位、不按 MVP 分阶段”的实现策略进行修正。

### 总体判断

| 补充主题 | 是否必要 | 是否应补入正式设计 | 处理建议 |
|---|---:|---:|---|
| 错误恢复和重试策略 | 必要 | 是 | 补入，但模型降级和 verifier 跳过规则需修正 |
| 用户体验和进度反馈 | 必要 | 是 | 核心进度与取消处理补入；后台运行/ETA 可作为新增功能 |
| 配置系统 | 必要 | 是 | 补入，但配置路径、数组合并、安全确认需修正 |
| 可观测性和调试支持 | 必要 | 是 | execution log/debug artifacts/verbose/dry-run 补入；replay 可作为新增功能 |
| Artifact 版本和历史管理 | 部分必要 | 是 | run 目录/current 指针补入；diff/rollback/compression 可作为新增功能 |
| 并发和资源管理 | 必要 | 是 | 补入；内存检测需降级为 best-effort |
| 边界情况和极端场景 | 必要 | 是 | 基本都应补入 |
| 质量保证和验证机制 | 必要 | 是 | 补入；golden/regression tests 需处理 LLM 非确定性 |

---

### 1. 错误恢复和重试策略：应补入，但需修正

`design-supplement.md` 对 subagent failure 的处理比原设计更具体，应补入正式设计。

#### 应吸收的内容

- 默认重试次数；
- exponential backoff；
- 可重试/不可重试错误分类；
- invalid structured output 的 repair pass；
- reviewer 部分失败的继续/询问/停止规则；
- execution log 中记录实际模型、错误、恢复动作。

#### 需要修正的点

**模型降级链不应硬编码为：**

```text
当前模型 → Sonnet → Haiku
```

原因：

- 用户当前 provider 可能没有 Sonnet/Haiku；
- model ID 在不同 provider 下并不统一；
- pi model registry 中是否有可用 API key 需要运行时判断。

建议改为：

```md
Model fallback is configuration-driven.
Default fallback order:
1. agent-specific configured model;
2. current pi model;
3. configured global fallback models that are available in ctx.modelRegistry and have API keys;
4. fail with actionable error.
```

**Verifier 失败不应默认可跳过。**

原补充文档写到：

> Verifier 失败：可跳过但警告用户

建议改为：

```md
Verifier failure can only be skipped with explicit user confirmation.
If skipped, final design must be marked as unverified in `state.json` and `decision-log.md`, and final approval prompt must clearly disclose the risk.
```

否则会削弱 Brainstorming Pro “闭环验证”的核心价值。

---

### 2. 用户体验和进度反馈：核心能力应补入，后台运行应谨慎

进度反馈是长 workflow 的必要能力，应补入正式设计。

#### 应吸收的内容

- phase-level progress；
- reviewer 状态：pending/running/complete/failed；
- 当前活动描述；
- verbose 模式；
- `/clarify-status <topic>` 查看 state 和 artifacts；
- Ctrl+C/user abort 时保存 `state.json` 和 `interrupted.md`；
- 停止所有 subagent 进程。

#### 需要谨慎的内容

**后台运行 `--background` 不建议作为核心必备能力。**

原因：

- pi extension 的 lifecycle 与 session 绑定；
- 后台任务跨 session/shutdown 的进程管理复杂；
- 需要额外处理 orphan process、日志刷新、状态通知、恢复绑定等问题；
- 这更像一种新增运行模式，而不是 clarification workflow 的核心闭环。

根据“不分版本实现”的原则，后台运行不应被简单标成“v2”，但可以明确归类为“后续新增功能”，因为它改变的是运行模式，而不是当前核心 workflow 的完整性。

建议正式设计写为：

```md
Initial production scope supports foreground orchestration with robust progress, cancellation, status, and resume.
Background execution is treated as a separate future feature because it requires additional process lifecycle management beyond the core clarification workflow.
```

**ETA 估算也不应作为必备。**

可以保留当前 phase 和已完成数量，剩余时间估算可作为 best-effort 或后续增强。

---

### 3. 配置系统：应补入，但需调整路径与合并规则

配置系统是必要的。没有配置系统，reviewers、models、timeouts、security、artifacts、ui 都会硬编码，后续维护成本高。

#### 应吸收的内容

- JSON 配置；
- `version` 字段；
- bundled defaults；
- user config；
- project config；
- local project config；
- command-line overrides；
- TypeBox schema validation；
- agent/reviewer/model/retry/security/artifacts/ui 配置。

#### 建议修正配置路径

补充文档中使用：

```text
~/.pi/brainstorming-pro/config.json
```

建议改为更贴近 pi agent 资源目录：

```text
~/.pi/agent/brainstorming-pro/config.json
<project>/.pi/brainstorming-pro/config.json
<project>/.pi/brainstorming-pro/config.local.json
```

原因：pi 的用户级 agent 配置和资源主要位于 `~/.pi/agent/` 下，保持一致更容易理解和管理。

#### 数组合并规则需要细化

补充文档写到：

> 对于数组类型采用追加而非覆盖

这可能导致 `reviewers.disabled`、`reviewers.enabled`、`fallbackModels` 等配置难以覆盖。

建议改为按字段定义合并策略：

```md
Configuration merge is schema-aware:
- scalar fields override;
- object fields deep merge;
- reviewer sets are resolved by explicit enabled/disabled/custom rules;
- arrays default to replace unless the schema explicitly marks them as appendable;
- command-line `--reviewers` replaces configured reviewer selection for that run.
```

#### Project config 的安全边界

project-level config 是 repo-controlled，也可能试图启用 project-local agents 或扩大工具权限。因此正式设计应补充：

```md
Project-level config is untrusted input. Security-sensitive options from project config, such as enabling project-local agents or expanding tools, require explicit user confirmation unless allowed by user-level config.
```

---

### 4. 可观测性和调试支持：应补入，注意敏感信息

可观测性对于这种多 agent orchestration 是必要的，应补入正式设计。

#### 应吸收的内容

- `execution.log.json`；
- `execution.log.txt`；
- phase/agent/error/recovery/token/cost metadata；
- debug artifacts；
- prompt hash；
- raw output 保存；
- `--verbose`；
- `--dry-run`；
- issue 溯源；
- `/clarify-debug <topic>`。

#### 需要补充的安全限制

Debug artifacts 可能包含：

- 项目源码片段；
- 用户需求；
- agent prompts；
- 模型输出；
- 可能敏感的路径或业务信息。

因此正式设计应增加：

```md
Debug artifacts may contain sensitive project context. They are stored only under the project `specs/<topic>/clarification/<run>/debug/` directory, are never uploaded by the extension, and can be disabled or redacted through config.
```

#### `/clarify-replay` 可作为后续新增功能

`/clarify-replay <topic> <agent>` 对 prompt 调试很有用，但它不是核心 clarification workflow 的必要条件。它可以归类为后续新增调试功能，而不是首轮阻塞项。

---

### 5. Artifact 版本和历史管理：run 目录必要，高级历史操作可后续

原分析中只提到 artifact 冲突处理和 machine-readable state。补充文档进一步提出 run-based artifact layout，这是必要且推荐的。

#### 应吸收的内容

```text
specs/<topic>/
├── design.md
└── clarification/
    ├── run-20260504-143022/
    │   ├── state.json
    │   ├── execution.log.json
    │   ├── ...
    │   └── decision-log.md
    └── current -> run-20260504-143022
```

每次运行创建独立 run 目录，可以解决：

- 多次运行覆盖；
- resume 定位；
- debug artifact 混乱；
- decision-log 历史追踪；
- 回看旧设计过程。

#### current symlink 需要兼容 fallback

`current -> run-*` 符号链接很好，但正式设计应考虑环境兼容性。建议增加：

```md
Use `current` symlink when supported. Also write `current.json` containing the active run ID as a portable fallback.
```

#### 高级命令可作为新增功能

以下命令有价值，但不是核心闭环必需：

- `/clarify-diff`；
- `/clarify-rollback`；
- `/clarify-clean`；
- artifact compression。

根据当前“不分版本”的偏好，不应说“v2 再做”，而应明确它们属于“额外 artifact management features”，不阻塞 Brainstorming Pro 核心 workflow 的完整交付。

---

### 6. 并发和资源管理：应补入

该部分必要，应补入正式设计。

#### 应吸收的内容

- reviewer 并发控制；
- semaphore/queue；
- designer/triager/refiner/verifier 串行；
- rate limit backoff；
- 子进程 PID 跟踪；
- workflow 结束/取消时清理所有子进程；
- process group cleanup；
- agent timeout；
- execution summary 记录资源使用。

#### 需要调整的点

内存使用检测应定义为 best-effort：

```md
Memory monitoring is best-effort. If reliable per-process memory data is unavailable on the host platform, the runner falls back to static concurrency limits.
```

`--max-memory` 可以保留，但不应承诺绝对精确控制。

---

### 7. 边界情况和极端场景：应补入

这部分非常有必要，基本应整体吸收到正式设计中。

#### 特别应补入

- empty topic；
- too long topic；
- path traversal；
- special character normalization；
- user cancel at decision gate；
- cancel during long-running phase；
- needs-discussion timeout；
- all reviewers failed；
- triager/refiner failure；
- no issues found；
- over-implementation；
- maxRounds reached with unresolved P0；
- artifact/state corruption；
- existing `design.md` conflict。

#### 中文 topic 规则需要明确

补充文档写到：

> 中文 topic：支持，使用 pinyin 或保留中文（取决于文件系统）

建议正式设计不要留下二选一，而是明确一种 deterministic 策略。推荐：

```md
Topic display name preserves the original user input.
Filesystem slug is generated by a deterministic slugifier:
- ASCII letters/numbers are lowercased and kebab-cased;
- Unicode letters/numbers may be preserved if supported;
- unsafe characters are removed;
- if the result is empty, use `clarification-<timestamp>` and store the original title in metadata.
```

不建议强制 pinyin，因为会引入额外依赖和多音字问题。

---

### 8. 质量保证和验证机制：应补入，但需处理 LLM 非确定性

该部分是必要的，尤其是 reviewer/triager/refiner/verifier 的 output quality gates。

#### 应吸收的内容

- Reviewer schema validation；
- 必填字段检查；
- evidence quality check；
- duplicate issue filtering；
- Triager dependency/conflict ID validation；
- priority/recommendation consistency；
- Refiner changelog mapping；
- rejected/deferred issue 不应被实现；
- Verifier 必须覆盖每个 accepted issue；
- quality metrics 写入 execution summary。

#### 需要修正的点

**Refiner 输出不一定必须修改 `design.md`。**

补充文档写到：

> Design.md 必须有实质性修改

建议改为：

```md
If there are accepted decisions, the refiner must either produce a changed design or explicitly explain why the existing design already satisfies each accepted issue. No-op refinement is valid only when every accepted issue is already covered and the verifier can confirm it.
```

**Golden/regression tests 需要考虑 LLM 非确定性。**

建议正式设计写为：

```md
Golden tests should rely on mocked subagent outputs for deterministic integration tests.
Optional live-model evaluation can be run manually or in a non-blocking test profile to monitor prompt quality over time.
```

否则 CI 会因为模型波动而不稳定。

---

### 9. supplement 中的“实现优先级建议”需要按用户偏好改写

`design-supplement.md` 末尾仍然有：

- 必须在首轮实现中完成；
- 应该在首轮实现中完成；
- 可以在后续迭代中完成。

这和用户最新确认的实现偏好部分冲突：用户不希望按版本切分实现，只要能实现就一步到位。

#### 建议改写原则

正式设计和后续 `tasks.md` 应避免使用 MVP/v1/v2 语义。可以改成：

```md
Core initial implementation scope:
- all capabilities required for a complete, recoverable, observable, safe clarification workflow.

Post-core feature additions:
- capabilities that introduce a new operation mode, new management command family, or non-essential UX enhancement.
```

#### 调整后的归类

**应纳入首轮完整实现的核心范围：**

- retry/backoff；
- model fallback；
- partial failure handling；
- invalid output repair；
- progress display；
- status/resume；
- cancellation；
- config loading/validation/merge；
- execution logs；
- debug artifacts；
- verbose；
- dry-run；
- run directory/current pointer；
- concurrency control；
- timeout/process cleanup；
- boundary case handling；
- output quality gates；
- deterministic mocked integration tests。

**可作为后续新增功能，不阻塞核心实现：**

- background mode；
- ETA based on historical data；
- `/clarify-replay`；
- `/clarify-diff`；
- `/clarify-rollback`；
- `/clarify-clean`；
- artifact compression；
- advanced live-model regression dashboard；
- custom TUI checklist。

这些不是因为“先做 MVP”，而是因为它们属于新增运行模式、管理工具或体验增强，不是当前 clarification workflow 能否完整闭环的必要条件。

---

## 十六、建议从 design-supplement.md 补入正式 design.md 的章节

建议将 `design-supplement.md` 的内容整理后补入正式 `design.md`，但按下面结构合并，避免设计文档变成零散问题清单。

### 1. Configuration

包含：

- config file locations；
- precedence；
- schema validation；
- merge strategy；
- reviewer/agent/model/retry/security/artifact/ui config；
- project config trust boundary。

### 2. Subagent Reliability

包含：

- retry/backoff；
- model fallback；
- partial failure policy；
- invalid output repair；
- timeout；
- cancellation；
- rate limit handling。

### 3. Observability and Debugging

包含：

- execution.log.json；
- execution.log.txt；
- debug artifacts；
- verbose；
- dry-run；
- issue lineage；
- sensitive data warning/redaction。

### 4. Artifact Runs and Resume

包含：

- run directory layout；
- current symlink/current.json；
- state.json；
- resume behavior；
- interrupted.md；
- design.md conflict handling。

### 5. Progress and User Control

包含：

- phase progress；
- reviewer progress；
- status command；
- user cancellation；
- decision gate timeout；
- final approval disclosure。

### 6. Resource Management

包含：

- concurrency；
- process tracking；
- process group cleanup；
- best-effort memory tracking；
- API rate limiting。

### 7. Edge Cases

包含：

- topic validation；
- empty/no issue results；
- all reviewers failed；
- maxRounds unresolved P0；
- over-implementation；
- corrupted artifacts/state。

### 8. Output Quality Gates

包含：

- reviewer quality checks；
- triager consistency checks；
- refiner checks；
- verifier checks；
- golden/mocked tests；
- live-model prompt quality evaluation as optional/manual profile。

