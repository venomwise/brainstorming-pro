# Brainstorming Pro `.tgz` 初步验证清单

本文档用于在完成 `specs/brainstorming-pro-refactor-roadmap/design.md` 中 spec 1 与 spec 2 相关重构后，对本地打出的 `brainstorming-pro-<version>.tgz` 包进行初步验证。

当前阶段的验证目标是确认：

- package 可以被正常安装。
- Pi package metadata 可以被识别。
- `/brainstorm-pro` 是唯一面向用户的 workflow 入口。
- workflow runtime 可以创建、恢复和查询持久化 state。
- topic/path 安全边界有效。
- review/approval gate 的状态迁移不会被绕过。
- blocked、failed、done 等状态不会被 resume 隐式推进。

> 注意：当前阶段的 `/brainstorm-pro` runtime 主要验证 durable workflow 骨架。`start` 会创建 workflow state 并进入 `designing`，但尚不代表完整 phase adapter、multi-agent review、plan generation 或 execution 已全部接入。因此，本清单重点验证 runtime、package、gate 和安全边界，而不是完整端到端交付能力。

## 0. 准备验证环境

在干净目录中创建测试项目：

```bash
mkdir -p /tmp/brainstorming-pro-verify
cd /tmp/brainstorming-pro-verify
npm init -y
```

安装本地 `.tgz`：

```bash
npm install /home/venom/workspace/ai/brainstorming-pro/brainstorming-pro-0.1.0.tgz
```

确认 package metadata：

```bash
node -e "const p=require('./node_modules/brainstorming-pro/package.json'); console.log(p.name, p.version, p.pi)"
```

期望输出包含：

```text
brainstorming-pro 0.1.0
```

以及：

```json
{
  "extensions": ["./extensions/clarification-orchestrator"],
  "skills": ["./skills"]
}
```

验证项：

- [ ] `.tgz` 可以被 `npm install` 正常安装。
- [ ] `package.json` 中的 `name`、`version`、`pi.extensions`、`pi.skills` 可以正确读取。

## 1. 包内容验证

列出包内容：

```bash
find node_modules/brainstorming-pro -maxdepth 3 -type f | sort
```

重点确认存在：

```text
README.md
package.json
extensions/clarification-orchestrator/index.ts
extensions/clarification-orchestrator/commands/brainstorm-pro.ts
extensions/clarification-orchestrator/workflow/runtime.ts
extensions/clarification-orchestrator/workflow/state-machine.ts
extensions/clarification-orchestrator/workflow/artifact-store.ts
extensions/clarification-orchestrator/workflow/events.ts
extensions/clarification-orchestrator/workflow/gates.ts
skills/brainstorming-pro/SKILL.md
skills/spec-plan-pro/SKILL.md
skills/spec-exec-pro/SKILL.md
```

确认未包含不应打包的开发内容：

```bash
find node_modules/brainstorming-pro -maxdepth 3 -type d | sort
```

期望不包含：

```text
tests/
specs/
temp/
node_modules/brainstorming-pro/node_modules/
```

验证项：

- [ ] 必要 extension、workflow、skill 文件已进入包。
- [ ] 测试、spec 草稿、临时目录未进入包。

## 2. Pi 包注册验证

在 Pi 测试项目中加载该 `.tgz` 后，确认：

- [ ] Pi 能识别该 package。
- [ ] `/brainstorm-pro` command 可用。
- [ ] 没有公开旧命令或通用 subagent/orchestration 命令。

不应公开的命令包括：

```text
/clarify
/spec-plan
/spec-exec
/subagent
/single
/parallel
/chain
/async
```

期望结果：

```text
只公开 /brainstorm-pro 作为 workflow 入口。
```

## 3. `/brainstorm-pro start` 基础验证

在 Pi 中执行：

```text
/brainstorm-pro "Build a small task dispatch workflow"
```

验证项：

- [ ] 命令不报错。
- [ ] 使用当前选中的 LLM 自动生成 English kebab-case topic。
- [ ] UI 提示 workflow 已启动，并显示生成的 topic。
- [ ] 项目目录生成 runtime state。

记录生成的 topic，后续示例假设为：

```bash
TOPIC=task-dispatch-workflow
```

检查文件：

```bash
find "specs/$TOPIC" -maxdepth 5 -type f | sort
```

期望至少存在：

```text
specs/<generated-topic>/.workflow/runs/<run-id>/state.json
```

检查 state：

```bash
cat "specs/$TOPIC"/.workflow/runs/*/state.json
```

期望关键字段类似：

```json
{
  "version": 1,
  "runId": "run-...",
  "topic": "task-dispatch-workflow",
  "request": "Build a small task dispatch workflow",
  "phase": "designing",
  "artifacts": {},
  "reviewDecisions": {},
  "reviewStatus": {},
  "gates": {}
}
```

## 4. `/brainstorm-pro --status` 验证

执行：

```text
/brainstorm-pro --status task-dispatch-workflow
```

或：

```text
/brainstorm-pro --status --topic task-dispatch-workflow
```

验证项：

- [ ] 命令成功。
- [ ] 显示 topic。
- [ ] 显示 run id。
- [ ] 显示当前 phase。

期望类似：

```text
Workflow task-dispatch-workflow
Run: run-...
Phase: designing
```

## 5. 单 workflow 自动选择验证

如果当前测试项目里只有一个 runtime-managed workflow，执行：

```text
/brainstorm-pro --status
```

验证项：

- [ ] 不传 topic 时可以自动选中唯一 workflow。
- [ ] 显示生成 topic 的状态。

然后执行：

```text
/brainstorm-pro --resume
```

当前阶段期望：

- [ ] 不崩溃。
- [ ] 仍然保持 `designing`。
- [ ] 不会越过 review/approval gate。
- [ ] 不会自动生成 approval 或 decision。

## 6. 多 workflow topic 选择验证

再启动一个 workflow：

```text
/brainstorm-pro "Build a user profile editor"
```

然后执行：

```text
/brainstorm-pro --status
```

验证项：

- [ ] 因为存在多个 workflow，要求用户选择 topic。
- [ ] 不随机选择。
- [ ] 不隐式 resume 某一个 workflow。

期望类似：

```text
Select a workflow topic to resume: task-dispatch-workflow, user-profile-editor
```

分别执行：

```text
/brainstorm-pro --status task-dispatch-workflow
/brainstorm-pro --status user-profile-editor
```

验证项：

- [ ] 两个 workflow 状态相互隔离。
- [ ] 每个 topic 有自己的 `.workflow/runs/<run-id>/state.json`。

## 7. topic 安全校验验证

下面这些命令应该被拒绝。

中文 topic：

```text
/brainstorm-pro "test" --topic 中文
```

大写 topic：

```text
/brainstorm-pro "test" --topic Foo
```

下划线 topic：

```text
/brainstorm-pro "test" --topic foo_bar
```

空格 topic：

```text
/brainstorm-pro "test" --topic "foo bar"
```

路径穿越：

```text
/brainstorm-pro "test" --topic ../evil
```

斜杠路径：

```text
/brainstorm-pro "test" --topic foo/bar
```

验证项：

- [ ] 命令报错。
- [ ] 不会在 `specs/` 外创建任何文件。
- [ ] 不会创建异常嵌套路径。

检查：

```bash
find . -maxdepth 4 -type d | sort
```

确认没有异常目录，例如：

```text
evil/
../evil/
specs/foo/bar/
```

## 8. 参数解析与错误提示验证

仅指定 topic：

```text
/brainstorm-pro --topic task-dispatch-workflow
```

期望恢复该 topic，而不是创建新 workflow。

start 不再要求 topic；下面命令应创建新 workflow 并由 LLM 生成 topic：

```text
/brainstorm-pro "Build something"
```

`--resume` 和 `--status` 同时使用：

```text
/brainstorm-pro --resume --status task-dispatch-workflow
```

未知 option：

```text
/brainstorm-pro "test" --topic option-demo --unknown
```

gate decision 脱离 `--resume` 使用：

```text
/brainstorm-pro "test" --topic decision-demo --decision approve
```

验证项：

- [ ] 有明确错误提示。
- [ ] 不创建非法 workflow。
- [ ] 不修改已有 state。

## 9. resume decision 边界验证

当前 workflow 处于 `designing`，不是 gate phase。执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --decision approve
```

验证项：

- [ ] 不应直接 approve。
- [ ] phase 不应跳到 `planning`。
- [ ] state 中不应出现 `gates.design`。
- [ ] 不应生成 approval 文件。

检查：

```bash
cat specs/task-dispatch-workflow/.workflow/runs/*/state.json
find specs/task-dispatch-workflow/.workflow -maxdepth 4 -type f | sort
```

期望仍是：

```json
"phase": "designing"
```

并且没有：

```text
.workflow/approvals/design-approval.json
.workflow/approvals/plan-approval.json
```

## 10. 手动 gate state 验证：design review decision

由于当前 package 尚未接入完整 adapter 自动推进到 gate，可以手动修改测试 state 进行 runtime gate 验证。

定位 state 文件：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
echo "$STATE"
```

将 phase 改为 `awaiting-design-review-decision`：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
STATE="$STATE" node - <<'NODE'
const fs = require("fs");
const file = process.env.STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.phase = "awaiting-design-review-decision";
s.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
NODE
```

执行：

```text
/brainstorm-pro --status task-dispatch-workflow
```

期望：

```text
Phase: awaiting-design-review-decision
Pending: review-decision
```

执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --choose-review skip
```

验证项：

- [ ] phase 变为 `awaiting-design-approval`。
- [ ] `reviewDecisions.design.mode` 为 `skip`。
- [ ] `reviewStatus.design.status` 为 `skipped`。
- [ ] `reviewStatus.design.reason` 为 `user-selected-skip`。

## 11. 手动 gate state 验证：design approval

在第 10 步之后，workflow 应处于 `awaiting-design-approval`。

执行：

```text
/brainstorm-pro --status task-dispatch-workflow
```

期望：

```text
Pending: approval
```

执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --decision approve
```

验证项：

- [ ] phase 变为 `planning`。
- [ ] `gates.design.gate` 为 `design`。
- [ ] `gates.design.approvedBy` 为 `command-user`。

> 当前阶段 artifact refs 可能为空数组；这是 runtime 骨架行为。后续 adapter/artifact-store 接入后，应验证 approval 绑定具体 versioned artifact refs 和 checksum。

## 12. 手动 gate state 验证：plan review decision

将 state 改到 `awaiting-plan-review-decision`：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
STATE="$STATE" node - <<'NODE'
const fs = require("fs");
const file = process.env.STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.phase = "awaiting-plan-review-decision";
s.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
NODE
```

执行：

```text
/brainstorm-pro --status task-dispatch-workflow
```

期望：

```text
Pending: review-decision
```

执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --choose-review skip
```

验证项：

- [ ] phase 变为 `awaiting-plan-approval`。
- [ ] `reviewStatus.plan.mode` 为 `skip`。
- [ ] `reviewStatus.plan.status` 为 `skipped`。
- [ ] `reviewStatus.plan.reason` 为 `user-selected-skip`。

## 13. 手动 gate state 验证：plan approval

在 `awaiting-plan-approval` 状态下执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --decision approve
```

验证项：

- [ ] phase 变为 `executing`。
- [ ] `gates.plan.gate` 为 `plan`。
- [ ] `gates.plan.approvedBy` 为 `command-user`。
- [ ] 如果之前已经存在 `gates.design`，则 `design` 和 `plan` 两个 gate 都保留。

## 14. full review unavailable 验证

将 state 改到 `awaiting-design-review-decision`：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
STATE="$STATE" node - <<'NODE'
const fs = require("fs");
const file = process.env.STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.phase = "awaiting-design-review-decision";
s.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
NODE
```

执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --choose-review full
```

验证项：

- [ ] 不自动降级成 `minimal`。
- [ ] 不进入 `design-review`。
- [ ] 记录 full review 当前不可用。

state 中应看到类似：

```json
"reviewStatus": {
  "design": {
    "mode": "full",
    "status": "unavailable",
    "reason": "full-review-unavailable"
  }
}
```

## 15. revise 验证

### 15.1 design approval revise

将 state 改到 `awaiting-design-approval`，然后执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --decision revise
```

验证项：

- [ ] phase 变为 `designing`。

### 15.2 plan approval revise

将 state 改到 `awaiting-plan-approval`，然后执行：

```text
/brainstorm-pro --resume task-dispatch-workflow --decision revise
```

验证项：

- [ ] phase 变为 `planning`。

## 16. blocked / failed fail-closed 验证

将 state 改为 `blocked`：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
STATE="$STATE" node - <<'NODE'
const fs = require("fs");
const file = process.env.STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.phase = "blocked";
s.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
NODE
```

执行：

```text
/brainstorm-pro --resume task-dispatch-workflow
```

验证项：

- [ ] phase 仍然是 `blocked`。
- [ ] 不自动恢复。
- [ ] 不自动进入下一个 phase。

再将 state 改为 `failed` 并执行同样的 resume：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
STATE="$STATE" node - <<'NODE'
const fs = require("fs");
const file = process.env.STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.phase = "failed";
s.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
NODE
```

```text
/brainstorm-pro --resume task-dispatch-workflow
```

验证项：

- [ ] phase 仍然是 `failed`。
- [ ] 不自动推进。

## 17. done terminal 验证

将 state 改为 `done`：

```bash
STATE=$(find specs/task-dispatch-workflow/.workflow/runs -name state.json | head -1)
STATE="$STATE" node - <<'NODE'
const fs = require("fs");
const file = process.env.STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
s.phase = "done";
s.updatedAt = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
NODE
```

执行：

```text
/brainstorm-pro --resume task-dispatch-workflow
```

验证项：

- [ ] phase 保持 `done`。
- [ ] 不重新执行。
- [ ] 不创建新的 run。
- [ ] 不修改 gate 或 decision。

## 18. artifact layout 初步验证

当前 runtime start 只保证 state layout。检查所有 runtime 文件是否严格位于 topic 内：

```bash
find specs/task-dispatch-workflow -maxdepth 6 -type f | sort
```

验证项：

- [ ] runtime 文件都在 `specs/task-dispatch-workflow/.workflow/` 下。
- [ ] 不存在 project root 下的 `.workflow/`。
- [ ] 不存在 `specs/.workflow/`。
- [ ] 不存在 topic 目录外的 runtime 文件。

## 19. 既有 topic 补充请求验证

对同一个 topic 执行补充请求：

```text
/brainstorm-pro "Second request for same topic" --topic task-dispatch-workflow
```

语义是以已有 `design.md` 为背景继续补充该 topic 的 design。

验证项：

- [ ] 创建新的 run id。
- [ ] 不覆盖旧 run。
- [ ] `specs/task-dispatch-workflow/.workflow/runs/` 下出现多个 run 目录。
- [ ] 最新 state 的 `supplementalRequests` 记录了补充请求。
- [ ] 最新 state 回到 `designing`，且 design review/approval gate 不会沿用旧批准。

检查：

```bash
find specs/task-dispatch-workflow/.workflow/runs -maxdepth 1 -type d | sort
```

然后执行：

```text
/brainstorm-pro --status task-dispatch-workflow
```

验证项：

- [ ] 默认读取最新 run。
- [ ] 不混淆旧 run 和新 run。

## 20. 推荐优先级

如果时间有限，建议优先验证：

1. 安装和注册：第 0、1、2 项。
2. 基础 runtime：第 3、4、5、6 项。
3. 安全边界：第 7、8、9 项。
4. gate 语义：第 10、11、12、13、14、16 项。

这些通过后，可以认为当前 `.tgz` 已经具备 spec 1 / spec 2 后的初步验证价值。

## 21. 反馈模板

建议按以下格式反馈验证结果：

```markdown
## 验证环境

- OS:
- Node:
- Pi version:
- Package: brainstorming-pro-0.1.0.tgz

## 结果

- [ ] 0. 准备验证环境
- [ ] 1. 包内容验证
- [ ] 2. Pi 包注册验证
- [ ] 3. start 基础验证
- [ ] 4. status 验证
- [ ] 5. 单 workflow 自动选择
- [ ] 6. 多 workflow topic 选择
- [ ] 7. topic 安全校验
- [ ] 8. 参数错误提示
- [ ] 9. resume decision 边界
- [ ] 10. design review decision gate
- [ ] 11. design approval gate
- [ ] 12. plan review decision gate
- [ ] 13. plan approval gate
- [ ] 14. full review unavailable
- [ ] 15. revise
- [ ] 16. blocked / failed fail-closed
- [ ] 17. done terminal
- [ ] 18. artifact layout
- [ ] 19. 重复 start

## 异常

1. 命令：

   ```text
   ...
   ```

   期望：

   ```text
   ...
   ```

   实际：

   ```text
   ...
   ```

   相关 state：

   ```json
   ...
   ```
```
