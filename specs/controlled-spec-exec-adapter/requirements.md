# Requirements Document: Controlled Spec Exec Adapter

## Introduction

Controlled Spec Exec Adapter adds a code-owned execution loop for the approved `/brainstorm-pro` plan. After the workflow runtime has passed the plan approval gate and entered the `executing` phase, the adapter parses `specs/<topic>/tasks.md`, selects exactly one current task at a time, calls a controlled child Pi worker through `runAgent()`, validates the structured result, and updates task progress deterministically.

The adapter serves workflow users who need stable execution after plan approval, maintainers who need auditable and recoverable runtime behavior, implementation agents that should execute only the current task, and reviewers who need assurance that approved requirements, design, and task plan structure cannot be revised during execution. The system boundary includes task parsing, task ordering, optional-mode handling, checkpoint-as-task behavior, checkbox mutation, blocker escalation, and execution report generation. It excludes plan revision, requirements revision, design revision, parallel/background execution, generic subagent command surfaces, automatic fix loops, and a default terminal execution-review phase.

## Glossary

- **Controlled Spec Exec Adapter**: The `SpecExecPhaseAdapter` implementation that executes an approved task plan through deterministic code-owned control flow.
- **Workflow runtime**: The `/brainstorm-pro` runtime that owns workflow phase transitions, artifact versions, event logs, approvals, and persisted state.
- **Plan approval gate**: The runtime gate that records user approval for exact requirements and tasks artifact versions before execution may start.
- **Task plan**: The approved `tasks.md` file under `specs/<topic>/`, specifically its `## Tasks` section.
- **Requirement source of truth**: The approved `requirements.md` artifact used as execution acceptance truth.
- **Background design**: The approved `design.md` artifact, if available, used only as contextual background and not as a replacement for acceptance criteria.
- **Current task**: The single incomplete executable task selected by code for one child agent run.
- **Checkpoint task**: A task whose title indicates checkpoint or verification behavior and that is executed by the child agent as a normal current task, not as a user approval gate.
- **Optional execution mode**: The one-time user-selected execution setting, `mvp` or `full`, that determines whether optional tasks are skipped or executed.
- **TaskCheckboxWriter**: The code-owned component that performs allowed checkbox transitions in `tasks.md`.
- **TaskMutationGuard**: The code-owned component that detects unauthorized child-agent mutation of `tasks.md`, approved requirements, or approved design.
- **Execution blocker**: A structured stop condition for conflict, underspecification, validation failure, scope change, destructive operation, or missing dependency.

## Requirements

### Requirement 1: Execution Eligibility and Approved Context Loading

**User Story:** As a workflow user, I want execution to start only from an approved plan, so that implementation cannot bypass review gates or run against stale artifacts.

#### Acceptance Criteria

1. WHEN the workflow runtime invokes the adapter from the `executing` phase with a satisfied plan approval gate, THEN the adapter SHALL load the approved requirements and tasks artifacts referenced by that plan approval.
2. WHEN approved design is available for the topic, THEN the adapter SHALL load it only as background context and SHALL NOT treat it as acceptance truth.
3. WHEN the plan approval references exact artifact versions, THEN the adapter SHALL verify that the approved requirements and tasks refs remain the latest intended execution inputs and are checksum-valid before selecting any task.
4. IF plan approval is missing, stale, checksum-invalid, or references artifacts outside the topic scope, THEN execution SHALL be rejected before any child agent run occurs and a workflow error/block event SHALL be recorded.
5. WHEN requirements, tasks, or optional design content is loaded, THEN all resolved paths SHALL remain constrained under `specs/<topic>/` and `.workflow/` according to existing path-safety rules.

### Requirement 2: Task Plan Parsing and Structural Validation

**User Story:** As a maintainer, I want `tasks.md` parsed deterministically, so that execution order and progress updates do not depend on LLM interpretation.

#### Acceptance Criteria

1. WHEN parsing starts, THEN the parser SHALL locate the `## Tasks` section and parse only executable checkbox task lines from that section.
2. WHEN a task line is parsed, THEN the parser SHALL preserve its task id, title, kind, completion state, optional marker, inherited optionality, parent-child relationship, indentation, line number, original line, description lines, and referenced requirement IDs.
3. WHEN a checkbox line uses accepted markers such as `[ ]`, `[ ]*`, `[✅]`, or `[✅]*`, THEN the parser SHALL distinguish incomplete, optional, completed, and completed-optional states without changing the source text.
4. WHEN task titles contain checkpoint or verification keywords such as `Checkpoint`, `Verify`, `检查点`, or `验证`, THEN the parser SHALL classify those tasks as checkpoint tasks.
5. WHEN optionality is declared on a phase, THEN the parser SHALL mark its children as optional-inherited without requiring each child to have its own optional marker.
6. IF the `## Tasks` section is absent, malformed, ambiguously nested, or missing required `_Requirements: ..._` metadata for executable tasks, THEN execution SHALL block rather than allowing the child agent to infer the plan.
7. WHEN non-task description or metadata lines appear below a task, THEN the parser SHALL attach them to the owning task and SHALL NOT treat them as separate executable tasks.

### Requirement 3: Optional Execution Mode Resolution

**User Story:** As a workflow user, I want optional work to follow one explicit execution mode decision, so that optional tasks are neither silently skipped nor unexpectedly executed.

#### Acceptance Criteria

1. WHEN the parsed task plan contains no optional tasks, THEN execution SHALL proceed without asking for an optional execution mode and MAY internally normalize the mode to `full`.
2. WHEN the parsed task plan contains optional tasks and no current mode decision exists, THEN the runtime SHALL pause before any task execution and request a one-time user decision of `mvp` or `full`.
3. WHEN the user selects an execution mode, THEN the system SHALL persist the decision with the selected mode, selector metadata, decision time, path, and the exact approved requirements and tasks artifact versions.
4. IF a persisted execution mode decision references a stale requirements or tasks artifact version, THEN the decision SHALL be rejected and execution SHALL require a fresh mode decision before running tasks.
5. WHEN mode is `mvp`, THEN optional tasks and children inherited from optional phases SHALL be skipped, left unchecked, and included as skipped optional tasks in the execution report.
6. WHEN mode is `full`, THEN optional tasks SHALL be eligible for normal execution in task-plan order.

### Requirement 4: Code-Owned Task Selection and Execution Loop

**User Story:** As a maintainer, I want code to own task ordering and loop control, so that the LLM executes only one selected task and cannot skip ahead or continue after blockers.

#### Acceptance Criteria

1. WHEN the execution loop is ready to select work, THEN it SHALL re-read and re-parse `tasks.md` before selecting the next executable task.
2. WHEN selecting work, THEN the loop SHALL choose the first incomplete executable task in plan order after skipping completed tasks and optional tasks excluded by `mvp` mode.
3. WHEN an incomplete phase has incomplete executable children, THEN the loop SHALL NOT execute the phase line directly.
4. WHEN a phase has no children, THEN the loop SHALL treat the phase line as an executable task.
5. WHEN all executable children of a phase are complete, THEN code SHALL mark the phase checkbox complete without invoking the child agent for that phase line.
6. WHEN a checkpoint task is selected, THEN the loop SHALL execute it through the same single-current-task child-agent path with checkpoint-specific instructions.
7. WHEN a child result is `completed`, THEN the loop SHALL validate the result, verify no unauthorized mutations occurred, update exactly the selected checkbox, record progress, and continue to the next task.
8. WHEN a child result is `blocked` or `failed`, THEN the loop SHALL stop immediately and SHALL NOT select later tasks.
9. WHEN no required executable tasks remain, THEN execution SHALL complete and transition through the runtime completion path to `done` without inserting a default execution-review phase.
10. WHEN execution resumes after interruption, THEN the loop SHALL continue from the first incomplete executable task based on the current parsed checkbox state.

### Requirement 5: Single-Task Child Agent Contract and Result Validation

**User Story:** As an implementation agent, I want a prompt and schema scoped to exactly one task, so that I can implement or validate current work without owning global workflow decisions.

#### Acceptance Criteria

1. WHEN building a child prompt, THEN the adapter SHALL include only the current task, its description, referenced requirements or full requirements content, background design if available, current task kind, execution mode, completed-task summary, forbidden actions, and required structured output schema.
2. WHEN the child prompt is built, THEN it SHALL instruct the child to use `requirements.md` as acceptance truth, use `design.md` only as background, execute no later tasks, avoid revising the plan, avoid changing requirements or design, avoid updating `tasks.md` checkboxes, and return a structured blocker if blocked.
3. WHEN a checkpoint task is current, THEN the prompt SHALL instruct the child to validate completed tasks in scope against `requirements.md` with concrete evidence and SHALL state that the checkpoint is not a user approval gate.
4. WHEN invoking the child, THEN the adapter SHALL use the controlled Spec 3 child execution substrate with a role equivalent to `task-executor` and SHALL expect a `SingleTaskExecutionResult` shape.
5. WHEN a result is returned, THEN validation SHALL require the result kind, matching `taskId`, valid status, relative project `changedFiles`, summary, and status-specific fields.
6. WHEN status is `completed`, THEN validation SHALL require concrete evidence or validation summary and SHALL reject results that provide no evidence.
7. WHEN status is `blocked`, THEN validation SHALL require an `ExecutionBlocker` with task context, requirements context, attempts, risk, options, and needed user input.
8. WHEN status is `failed`, THEN validation SHALL require an error kind, message, and retryability flag.
9. IF `changedFiles` includes approved `requirements.md`, approved `design.md`, `tasks.md`, paths outside the project root, or invalid paths, THEN the result SHALL be rejected or execution SHALL block according to the mutation policy.

### Requirement 6: Code-Owned Checkbox Mutation and Artifact Mutation Guarding

**User Story:** As a security reviewer, I want task progress to be mutated only by deterministic code, so that the child agent cannot rewrite the approved plan or forge progress.

#### Acceptance Criteria

1. WHEN a task completion is accepted, THEN `TaskCheckboxWriter` SHALL update exactly one checkbox per call using the parser-provided line number and original line.
2. WHEN updating an incomplete required task, THEN the only allowed marker transition SHALL be `[ ]` to `[✅]` while preserving indentation, task id, title, optional marker position if absent, and descriptions.
3. WHEN updating an incomplete optional task that is actually executed in `full` mode, THEN the only allowed marker transition SHALL be `[ ]*` to `[✅]*` while preserving task id, title, indentation, and descriptions.
4. WHEN `TaskCheckboxWriter` prepares an update, THEN it SHALL re-read the file and verify that the original line still matches before writing.
5. IF a checkbox update would change task numbering, title, descriptions, `_Requirements:` lines, add/remove tasks, or mark skipped optional work complete, THEN the update SHALL be refused.
6. WHEN a child task run starts, THEN `TaskMutationGuard` SHALL snapshot `tasks.md` and approved requirements/design checksums before the child runs.
7. IF `tasks.md` changes during the child run before code-owned checkbox writing, THEN execution SHALL block as unauthorized task mutation and SHALL NOT treat child-written checkboxes as valid progress.
8. IF approved requirements or approved design changes during the child run, THEN execution SHALL block as approved artifact mutation.
9. WHEN code-owned checkbox writing completes, THEN the system SHALL append an appropriate task or phase completion workflow event.

### Requirement 7: Blocker, Failure, and Fail-Closed Handling

**User Story:** As a workflow user, I want genuine blockers to stop execution with actionable details, so that unsafe or underspecified work does not continue silently.

#### Acceptance Criteria

1. WHEN execution encounters a conflict between tasks and requirements, THEN it SHALL stop with a blocker of type `conflict`.
2. WHEN the current task cannot be executed from the approved task, requirements, and background design context, THEN it SHALL stop with a blocker of type `underspecified`.
3. WHEN implementation validation or checkpoint validation fails and cannot be safely fixed within the current task, THEN it SHALL stop with a blocker of type `validation_failure`.
4. WHEN completing a task would require changing approved requirements, approved design, or task plan structure, THEN it SHALL stop with a blocker of type `scope_change` and SHALL NOT perform automatic revision.
5. WHEN a task requires destructive or irreversible operations, THEN it SHALL stop with a blocker of type `destructive_op`.
6. WHEN required credentials, services, files, or environment dependencies are unavailable, THEN it SHALL stop with a blocker of type `missing_dependency`.
7. WHEN execution stops as blocked or failed, THEN the current task SHALL remain unchecked unless it was already completed by a prior accepted code-owned update.
8. WHEN child output is malformed or schema-invalid, THEN execution SHALL fail or block without marking the current task complete.
9. WHEN any blocker or failure is recorded, THEN later tasks SHALL remain unselected until a recovery or resume decision occurs outside the current failed/blocked run.

### Requirement 8: Execution Reports, Progress Audit, and Completion Transition

**User Story:** As a maintainer, I want every execution stop to produce auditable artifacts and state, so that progress, skipped work, blockers, and validation evidence are reviewable.

#### Acceptance Criteria

1. WHEN execution completes, blocks, or fails, THEN the adapter SHALL write `execution-report.json` and `execution-report.md` under `specs/<topic>/.workflow/runs/<run-id>/`.
2. WHEN writing the report, THEN it SHALL include topic, status, mode, task run records, completed tasks, remaining tasks, skipped optional tasks, changed files, validation commands, blockers, and summary.
3. WHEN recording a task run, THEN the report SHALL include task id, title, kind, status, timestamps, child run id when available, changed files, and evidence.
4. WHEN execution stops for any terminal adapter outcome, THEN the runtime SHALL commit the current `tasks.md` progress as a new versioned tasks artifact so progress is auditable.
5. WHEN all required executable tasks and checkpoints are complete with no blockers, THEN the runtime SHALL append completion events and transition the workflow phase to `done`.
6. WHEN execution blocks or fails, THEN the runtime SHALL persist the report, current task progress, error details, and recoverability status without adding a default execution-review phase.
7. WHEN optional tasks are skipped in `mvp` mode, THEN the report SHALL list them as skipped and SHALL NOT count them as completed required work.
