# Brainstorming Pro 设计补充文档

本文档针对 `design-analysis.md` 中提出的 P0 和 P1 级别问题，提供具体的设计方案。

## P0 级别问题与解决方案

### P0-1: 错误恢复和重试策略

#### 问题
Subagent 执行可能因多种原因失败（进程错误、无效输出、模型不可用、API 错误、rate limit 等），需要明确的重试和降级策略。

#### 设计方案

**重试策略配置**
- 默认最多重试 3 次
- 采用指数退避策略（1s, 2s, 4s...，最大 30s）
- 可重试的错误类型：进程错误、API 错误、rate limit
- 不可重试的错误类型：无效输出（转为修复流程）、用户取消

**模型降级策略**
- 默认降级链：当前模型 → Sonnet → Haiku
- 如果请求的模型不可用，自动尝试降级链中的下一个模型
- 记录实际使用的模型到 execution log

**部分失败处理规则**
- Reviewer 阶段：至少 75% 成功则自动继续；50-75% 成功则询问用户；少于 50% 则停止
- Designer 失败：必须中止（无法继续 workflow）
- Triager 失败：重试，仍失败则中止
- Refiner 失败：重试，仍失败则提示用户手动修改并保存 partial state
- Verifier 失败：可跳过但警告用户

**无效输出修复策略**
- 首次输出无效时，生成修复 prompt 包含：验证错误、原始输出、期望 schema
- 最多修复 1 次，仍失败则保存原始输出并询问用户

---

### P0-2: 用户体验和进度反馈

#### 问题
长时间运行的 workflow 需要清晰的进度反馈，用户需要知道当前状态、预计剩余时间、是否可以中途查看结果。

#### 设计方案

**进度状态跟踪**
- 定义 workflow 整体进度（0-100%）
- 定义每个 phase 的详细进度（例如 review 阶段显示 "3/4 reviewers 完成"）
- 记录当前活动的人类可读描述（例如 "正在运行 architecture reviewer"）
- 估算剩余时间（基于历史数据或启发式规则）

**进度 UI 设计**
- 显示当前 phase 和整体进度条
- Review 阶段显示每个 reviewer 的状态（pending/running/complete/failed）
- 使用 emoji 和颜色区分不同状态
- 支持 verbose 模式显示更详细的子任务进度

**中途查看部分结果**
- 在 workflow state 中记录已完成的 artifacts 路径
- 提供 `/clarify-status <topic>` 命令查看当前进度和已完成的 artifacts
- 用户可以随时打开 `specs/<topic>/clarification/` 查看已生成的文件

**后台运行支持**
- 提供 `--background` 选项启动后台 workflow
- 后台运行时将日志写入 `background.log`
- 提供 `/clarify-status <topic>` 查询后台任务状态
- 后台任务完成后通知用户

**用户取消处理**
- 捕获 Ctrl+C 信号
- 立即停止所有正在运行的 subagent 进程
- 保存当前 workflow state 到 `state.json`
- 写入 `interrupted.md` 说明中断位置和恢复方法
- 提示用户使用 `--resume` 继续

---

### P0-3: 配置系统的完整设计

#### 问题
需要一个完整的配置系统支持用户自定义 reviewers、agents、模型、重试策略等，并明确配置文件位置、格式、优先级。

#### 设计方案

**配置文件格式**
- 使用 JSON 格式，包含 `version` 字段标识配置格式版本
- 主要配置项：
  - `defaults`: 默认选项（mode, maxRounds, threshold, autoSpecPlan）
  - `reviewers`: reviewer 配置（enabled, disabled, custom, concurrency）
  - `agents`: 每个 agent 的配置（model, tools, timeout）
  - `models`: 模型配置（default, perAgent, fallback）
  - `retry`: 重试策略配置
  - `security`: 安全配置（是否允许 project-local agents）
  - `artifacts`: artifact 管理配置（保留策略、压缩）
  - `ui`: UI 配置（progressBar, verbose）

**配置文件位置和优先级**
```
优先级从低到高：
1. bundled defaults (package 内置)
2. ~/.pi/brainstorming-pro/config.json (用户全局)
3. <project>/.pi/brainstorming-pro/config.json (项目级)
4. <project>/.pi/brainstorming-pro/config.local.json (项目级，git ignored)
5. 命令行参数
```

**配置加载和合并**
- 按优先级顺序加载所有配置文件
- 深度合并配置对象，后面的覆盖前面的
- 对于数组类型（如 reviewers.disabled），采用追加而非覆盖

**配置验证**
- 使用 TypeBox 定义配置 schema
- 加载配置时进行 runtime 验证
- 验证失败时提供友好的中文错误消息，指出具体的配置项和问题

**添加自定义 Reviewer**
- 用户在 `~/.pi/brainstorming-pro/agents/` 创建 reviewer markdown 文件
- 在配置文件的 `reviewers.custom` 中注册
- 指定 name, description, agentPath, model, tools, priority
- 使用时通过 `--reviewers` 参数引用自定义 reviewer 名称

**配置覆盖示例**
- 全局配置启用 4 个默认 reviewers
- 项目配置禁用 testing reviewer，添加自定义 performance reviewer
- 命令行参数 `--reviewers product,architecture` 只运行这两个

---

### P0-4: 可观测性和调试支持

#### 问题
实现和维护阶段需要详细的日志、调试工具、dry-run 模式来追踪问题和优化性能。

#### 设计方案

**执行日志结构**
- 结构化日志：`execution.log.json` 包含完整的 workflow 执行信息
  - workflow 元信息（topic, mode, 时间范围, 状态）
  - 每个 phase 的日志（时间范围、状态、agents、artifacts、错误）
  - 每个 agent 的执行日志（输入、输出、metadata、token 使用、耗时）
  - 错误日志（类型、消息、恢复动作）
  - 执行摘要（总耗时、token 使用、成本估算、成功/失败统计）
- 人类可读日志：`execution.log.txt` 提供易读的文本格式

**Debug Artifacts**
- 在 `specs/<topic>/clarification/debug/` 保存所有 agent 的输入和输出
- 文件命名：`<agent-name>-input.md`, `<agent-name>-output.json`
- 包含 prompt hash 用于追踪 prompt 变化
- 保存原始输出（即使解析失败）用于调试

**Verbose 模式**
- `--verbose` 选项启用详细输出
- 实时显示：
  - 每个 phase 的开始和结束
  - 每个 agent 的启动、完成、token 使用、耗时
  - 每个 artifact 的写入
  - 每个错误和恢复动作
- 不影响正常的进度 UI

**Dry-run 模式**
- `--dry-run` 选项只生成 prompts 不实际执行
- 输出：
  - 预计执行的 phases 和 agents
  - 每个 agent 的 model、tools、估算 tokens
  - 生成的 prompts 保存到 debug 目录
  - 总估算耗时、tokens、成本
- 用于：
  - 验证配置是否正确
  - 检查生成的 prompts 是否符合预期
  - 估算成本和时间

**Issue 溯源**
- 每个 DesignIssue 记录来源 reviewer
- Triager 输出中保留原始 reviewer issue ID 的映射
- Decision log 中记录 issue 的完整历史（哪个 reviewer 提出 → triager 如何评估 → 用户如何决策）
- Verifier 输出中引用 accepted issue ID 和对应的 design 变更

**调试工具**
- `/clarify-debug <topic>` 命令：
  - 显示 execution log 摘要
  - 列出所有 debug artifacts
  - 显示失败的 agents 和错误信息
  - 提供修复建议
- `/clarify-replay <topic> <agent>` 命令：
  - 使用保存的 input 重新运行指定 agent
  - 用于测试 agent prompt 修改

---

## P1 级别问题与解决方案

### P1-1: Artifact 版本和历史管理

#### 问题
多次运行 `/clarify` 会产生大量 artifacts，需要明确的组织、比较、回滚、清理策略。

#### 设计方案

**多次运行的 Artifact 组织**
```
specs/<topic>/
├── design.md                    # 当前最终版本
└── clarification/
    ├── run-20260504-143022/     # 第一次运行
    │   ├── state.json
    │   ├── execution.log.json
    │   ├── 00-user-idea.md
    │   ├── ...
    │   └── decision-log.md
    ├── run-20260504-151530/     # 第二次运行
    │   └── ...
    └── current -> run-20260504-151530/  # 符号链接指向当前 run
```

**Run 标识和选择**
- 每次运行创建新的 `run-<timestamp>/` 目录
- `current` 符号链接指向最新的 run
- `state.json` 中记录 run ID 和创建时间
- Resume 时默认使用 `current` run

**版本比较**
- `/clarify-diff <topic> <run1> <run2>` 命令比较两次运行
- 比较内容：
  - design.md 的 diff
  - issues 的差异（新增、删除、优先级变化）
  - decisions 的差异
  - 执行摘要的差异（耗时、成本、成功率）

**回滚支持**
- `/clarify-rollback <topic> <run-id>` 命令回滚到指定 run
- 将指定 run 的 `design.md` 复制到项目根目录
- 更新 `current` 符号链接
- 记录回滚操作到 `rollback.log`

**Artifact 清理策略**
- 配置项 `artifacts.retention`:
  - `maxRuns`: 保留最近 N 次运行（默认 5）
  - `maxAgeDays`: 保留最近 N 天的运行（默认 30）
- 自动清理：每次新运行开始时检查并清理旧 runs
- 手动清理：`/clarify-clean <topic>` 命令
- 保护机制：当前 run 和最近 2 次 run 不会被自动清理

**Artifact 压缩**
- 配置项 `artifacts.compression`: true/false
- 对于超过 7 天的 runs，自动压缩为 `.tar.gz`
- 压缩后保留 `state.json` 和 `execution.log.json` 用于查询
- 需要访问详细内容时自动解压

---

### P1-2: 并发和资源管理的细节

#### 问题
多个 subagent 并发运行可能占用大量内存和 API quota，需要明确的资源管理策略。

#### 设计方案

**并发控制**
- 配置项 `reviewers.concurrency`: 最大并发 reviewer 数量（默认 4）
- 使用 semaphore 或 queue 控制并发
- 非 reviewer agents（designer, triager, refiner, verifier）串行执行

**内存管理**
- 估算每个 subagent 进程的内存占用（约 200-500MB）
- 如果系统可用内存不足，自动降低并发数
- 提供 `--max-memory <MB>` 选项限制总内存使用

**API Rate Limiting**
- 检测 API rate limit 错误
- 自动应用 exponential backoff
- 如果 rate limit 频繁触发，自动降低并发数
- 记录 rate limit 事件到 execution log

**进程清理**
- 维护所有 subagent 进程的 PID 列表
- Workflow 结束或取消时，确保所有子进程被正确终止
- 使用 process group 确保子进程的子进程也被清理
- 设置进程超时（默认 5 分钟），超时后强制 kill

**资源监控**
- 记录每个 agent 的实际内存使用（如果可获取）
- 记录每个 agent 的 CPU 时间
- 在 execution summary 中汇总资源使用情况

---

### P1-3: 边界情况和极端场景的完整覆盖

#### 问题
需要明确定义各种边界情况和极端场景的处理规则。

#### 设计方案

**Topic 验证**
- 空 topic：拒绝并提示用户提供有效 topic
- 超长 topic（>100 字符）：截断并警告
- 包含路径分隔符、`..`、绝对路径：拒绝并提示安全风险
- 包含特殊字符：normalize 为 kebab-case，移除非法字符
- 中文 topic：支持，使用 pinyin 或保留中文（取决于文件系统）

**用户取消场景**
- Decision gate 时取消：保存 pending decisions 到 artifact，提示 resume
- 长时间运行时取消：立即停止所有 subagents，保存 state
- Needs-discussion 后长时间不回复：设置超时（默认 30 分钟），超时后保存 state 并退出

**全部失败场景**
- 所有 reviewers 失败：询问用户是否跳过 review 直接进入 final approval
- Triager 失败且重试失败：询问用户是否手动 triage 或中止
- Refiner 失败且重试失败：保存 accepted decisions 到 artifact，提示用户手动修改 design.md

**空结果场景**
- Reviewers 没有发现任何 issues：跳过 triage 和 user decision，直接进入 final approval
- Triager 输出空列表：同上
- Refiner 没有修改 design.md：跳过 verification，直接进入 final approval

**Over-implementation 场景**
- Verifier 报告所有 accepted items 都 over-implemented：
  - 警告用户 refiner 可能误解了 decisions
  - 显示 over-implemented 的详细信息
  - 询问用户是否接受、重新 refine、或手动修改

**MaxRounds 达到但仍有 missing P0 items**
- 显示所有 missing P0 items 的详细信息
- 询问用户：
  - 接受当前 design（风险自负）
  - 手动修改 design.md 并重新 verify
  - 增加 maxRounds 继续
  - 中止 workflow

**Artifact 冲突场景**
- `specs/<topic>/design.md` 已存在：
  - 检查是否有 `clarification/current/` 目录
  - 如果有，询问用户：resume / 创建新 run / 覆盖 / 中止
  - 如果没有，询问用户：覆盖 / 中止
- `clarification/` 目录已存在但 state 损坏：
  - 尝试从 artifacts 恢复 state
  - 如果无法恢复，询问用户：创建新 run / 手动修复 / 中止

---

### P1-4: 质量保证和验证机制

#### 问题
需要机制验证 reviewer、triager、refiner、verifier 的输出质量，防止低质量或错误的输出。

#### 设计方案

**Reviewer 输出质量检查**
- Schema 验证：确保输出符合 DesignIssue 结构
- 必填字段检查：title, description, category, severity, evidence 不能为空
- Evidence 质量检查：至少包含一条有效 evidence（不能是空字符串或占位符）
- 重复检查：同一 reviewer 不应输出完全相同的 issues
- 低质量过滤：过滤掉过于泛泛或无 actionable 建议的 issues

**Triager 输出质量检查**
- 去重验证：确保没有完全重复的 issues
- 优先级一致性：P0 issues 必须有 "must-fix-now" recommendation
- Dependency 验证：dependsOn 和 conflictsWith 引用的 issue IDs 必须存在
- Cost/benefit 一致性：high cost + low confidence 的 issue 不应该是 P0

**Refiner 输出验证**
- Design.md 必须有实质性修改（不能完全不变）
- Change log 必须映射到 accepted issue IDs
- 不应包含 rejected 或 deferred issues 的内容
- 不应引入新的 P0/P1 级别的问题（通过简单的 sanity check）

**Verifier 输出验证**
- 每个 accepted issue 必须有对应的 verification result
- Status 必须是 completed/partially-completed/missing/over-implemented 之一
- Evidence 必须指向 design.md 的具体位置或说明为什么 missing

**Golden Test Cases**
- 维护一组已知的好设计和坏设计作为测试用例
- 定期运行 workflow 并验证：
  - Reviewers 能否发现已知的坏设计中的问题
  - Triager 的优先级判断是否合理
  - Refiner 能否正确实现 accepted decisions
  - Verifier 能否正确识别 missing items

**Regression Tests**
- 每次修改 agent prompts 后运行 golden test cases
- 比较修改前后的输出质量
- 如果质量下降（例如发现的 issues 数量显著减少），警告并要求 review

**质量指标追踪**
- 记录每次运行的质量指标：
  - Reviewers 发现的 issues 数量
  - P0/P1/P2/P3 的分布
  - 用户 accept/reject/defer 的比例
  - Verifier 发现的 missing items 数量
  - Refinement rounds 数量
- 在 execution summary 中展示这些指标
- 用于长期优化 agent prompts

---

## 实现优先级建议

### 必须在首轮实现中完成（P0）
1. 错误恢复和重试策略的核心机制
2. 基本的进度反馈（phase 显示、reviewer 进度）
3. 配置系统的核心功能（加载、合并、验证）
4. 基本的日志记录（execution.log.json, debug artifacts）

### 应该在首轮实现中完成（P1）
1. Artifact 版本管理的基本功能（run 目录、current 链接）
2. 并发控制和基本的资源管理
3. 常见边界情况的处理
4. 基本的质量检查（schema 验证、必填字段）

### 可以在后续迭代中完成
1. 高级进度功能（后台运行、时间估算）
2. 高级配置功能（热更新、复杂的覆盖规则）
3. 高级调试工具（replay、interactive debugger）
4. 完整的 artifact 比较和回滚
5. 完整的质量指标追踪和 regression tests

---

## 与 design-analysis.md 的关系

本文档是 `design-analysis.md` 的补充，专注于提供具体的设计方案而非仅指出问题。两份文档应配合阅读：

- `design-analysis.md`：全面分析 design.md 的盲点和风险
- `design-supplement.md`（本文档）：针对 P0/P1 问题提供具体设计方案

在进入 `spec-plan` 阶段前，应确保 design.md 已根据这两份文档进行修订和补充。
