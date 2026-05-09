# Requirements Document: Agent Execution Runtime

## Introduction

Agent Execution Runtime provides Brainstorming Pro with an internal, workflow-owned foreground child Pi execution substrate. It lets phase adapters and future review panels run fixed Brainstorming Pro agent roles through a typed `runAgent()` API, capture bounded output, validate structured results, and report progress without exposing generic subagent orchestration to users.

The runtime is intentionally narrow: child processes are launched with explicit command/args/env boundaries, always use `--no-session` and `--no-skills`, are guarded against recursion, and cannot mutate workflow state, commit artifacts, write approvals, or bypass gates. The system builds on the approved workflow runtime and pi-subagents infrastructure reuse constraints while preserving Brainstorming Pro's workflow-first lifecycle ownership.

## Glossary

- **Agent Execution Runtime**: Internal Brainstorming Pro module under `extensions/clarification-orchestrator/runtime/agent-execution/` that launches and manages controlled child Pi processes.
- **Agent Role**: A fixed Brainstorming Pro-owned role such as `design-author`, `plan-author`, `task-executor`, or `minimal-reviewer` that is allowed only in specific workflow phases.
- **Agent Run**: One invocation of a child Pi process for a specific role, workflow context, prompt, system prompt, model, output schema, and execution limits.
- **Agent Run Directory**: Topic-scoped audit directory under `specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/` containing prompt, system prompt, stdout, stderr, raw output, result, and metadata files.
- **Child Marker**: Environment variable such as `BRAINSTORMING_PRO_CHILD=1` that identifies a child process and prevents recursive workflow command registration.
- **Foreground Child Process**: A non-detached child process spawned by the parent workflow process and awaited until completion, timeout, or failure.
- **PI_COMMAND**: Environment variable treated as a single executable path override for launching Pi, never as a shell command string with embedded arguments.
- **Provider-qualified Model**: Model identifier that includes the provider namespace required by Brainstorming Pro model policy.
- **Structured Output Schema**: Parser and validator supplied by the caller to convert untrusted raw child output into typed `AgentRunResult.output`.
- **Workflow Runtime**: Existing Brainstorming Pro state machine, artifact store, event log, and gate owner; it remains the only component that may transition workflow state or commit artifacts.

## Requirements

### Requirement 1: Role-based Agent Run API

**User Story:** As a phase adapter implementer, I want a typed role-based `runAgent()` API, so that workflow phases can request child execution without exposing generic delegation or workflow mutation capabilities.

#### Acceptance Criteria

1. WHEN a caller invokes `runAgent()`, THEN the request SHALL include an internal `AgentRole`, purpose, prompt, system prompt, provider-qualified model, workflow context, structured output schema, and optional execution limits.
2. WHEN `runAgent()` completes, THEN it SHALL return an `AgentRunResult<TOutput>` containing run id, role, status, output paths, timing, attempts, output capture summary, optional typed output, and optional structured error.
3. WHEN a caller provides an unknown role, THEN `runAgent()` SHALL reject the run before spawning a child process with error kind `role-not-allowed` or equivalent typed policy error.
4. WHEN a role is not allowed in the current workflow phase, THEN `runAgent()` SHALL reject the run before spawning a child process.
5. WHEN `runAgent()` succeeds, THEN it SHALL NOT directly transition workflow state, commit artifacts, write review decisions, or write approvals.
6. WHEN public extension registration is inspected, THEN the runtime SHALL NOT expose a public `subagent` command/tool or generic `single`, `parallel`, `chain`, or `async` orchestration API.

### Requirement 2: Role Registry and Policy Enforcement

**User Story:** As a security reviewer, I want every executable role to be defined in a policy registry, so that child execution is constrained by workflow phase, session policy, skill policy, and safe defaults.

#### Acceptance Criteria

1. WHEN the role registry is loaded, THEN it SHALL define first-version roles for `design-author`, `design-reviser`, `plan-author`, `task-executor`, and `minimal-reviewer`.
2. WHEN role definitions are inspected, THEN every first-version role SHALL declare allowed workflow phases, default timeout, default retry count, stdout/stderr/raw output limits, expected result kind, `allowSkills: false`, and `allowSession: false`.
3. WHEN role policy is applied, THEN all first-version child invocations SHALL be configured to use `--no-skills` and `--no-session`.
4. WHEN adapters request planning or execution roles before the workflow runtime has entered the corresponding phase, THEN the role policy SHALL reject the run before spawning.
5. WHEN future roles are added, THEN they SHALL be added through the registry rather than ad hoc string construction inside adapters.

### Requirement 3: Safe Pi Launch Specification

**User Story:** As a maintainer, I want child Pi launches to be represented as explicit command/args/env specs, so that process execution is deterministic, cross-platform, and free of shell parsing hazards.

#### Acceptance Criteria

1. WHEN a launch spec is built, THEN it SHALL contain explicit `command`, `args`, `env`, `cwd`, `stdio`, prompt file path, system prompt file path, and output directory fields.
2. WHEN Pi is resolved, THEN the resolver SHALL preserve the approved invocation order and treat `PI_COMMAND` as a single executable path override.
3. WHEN `PI_COMMAND` contains a value, THEN the runtime SHALL NOT split it into command fragments and SHALL NOT execute it through a shell.
4. WHEN child args are built, THEN the args SHALL include `--no-session` and `--no-skills` as independent argv entries.
5. WHEN the launch spec is validated, THEN any spec requiring `shell: true`, missing `--no-session`, missing `--no-skills`, disallowed path escape, or invalid command SHALL be rejected before spawn.
6. WHEN child env is built, THEN it SHALL include Brainstorming Pro child marker, parent workflow run id, agent run id, agent role, and depth metadata.
7. WHEN command metadata is written for audit, THEN sensitive inherited environment values SHALL NOT be written wholesale to metadata.

### Requirement 4: Prompt and Agent Run Audit Files

**User Story:** As a maintainer debugging workflow execution, I want every agent run to write prompt, output, result, and metadata files under the topic workflow directory, so that execution is auditable without trusting conversation context.

#### Acceptance Criteria

1. WHEN an agent run starts, THEN the runtime SHALL create a per-agent-run directory under `specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/`.
2. WHEN prompt files are written, THEN `prompt.md` and `system-prompt.md` SHALL be written under the agent run directory and passed to Pi by file reference or the Pi-supported equivalent.
3. WHEN output is captured, THEN `stdout.txt`, `stderr.txt`, `raw-output.txt`, `result.json`, and `metadata.json` SHALL be written under the agent run directory when applicable.
4. WHEN topic, run, or agent identifiers are used in paths, THEN the runtime SHALL prevent absolute paths, path traversal, hidden directory escapes, and writes outside the topic workflow directory.
5. WHEN prompt content is passed to the child process, THEN it SHALL NOT be embedded in a shell-interpreted command string.
6. WHEN a run fails before child spawn, THEN metadata or result diagnostics SHALL still be written when an agent run directory has been created.

### Requirement 5: Foreground Child Process Lifecycle

**User Story:** As a workflow runtime maintainer, I want child agents to run as bounded foreground processes, so that the parent workflow can wait, capture output, enforce timeouts, and avoid unmanaged background work.

#### Acceptance Criteria

1. WHEN a child process is spawned, THEN the runtime SHALL use `child_process.spawn` with `shell: false`, explicit stdio pipes, and no detached background mode.
2. WHEN the child process runs, THEN the parent SHALL wait for completion, signal, timeout, or spawn failure before returning `AgentRunResult`.
3. WHEN the child exits with code 0 and produces valid structured output, THEN the result status SHALL be `succeeded`.
4. WHEN the child exits with a non-zero code, THEN stdout/stderr/raw output SHALL be preserved and the result status SHALL be `failed` with a non-zero-exit error.
5. WHEN the child exits due to a signal, THEN the result SHALL record the signal and return a typed failure.
6. WHEN the child cannot be spawned, THEN the result SHALL return a typed spawn failure without throwing an untyped error across the runtime boundary.

### Requirement 6: Timeout, Retry, and Output Limits

**User Story:** As a reliability reviewer, I want every child run to have time and output bounds, so that long-running or noisy agents cannot hang or exhaust the parent workflow process.

#### Acceptance Criteria

1. WHEN a run exceeds its timeout, THEN the runtime SHALL terminate the child, preserve partial output, record timeout metadata, and return status `timed-out`.
2. WHEN stdout, stderr, or raw output exceeds configured limits, THEN the runtime SHALL bound captured data and record truncation flags in the output capture summary.
3. WHEN structured output cannot be parsed because of truncation or output limit behavior, THEN the result SHALL be `invalid-output` or an equivalent typed output-limit failure and no artifact shall be committed by the runtime.
4. WHEN retry is configured for a retryable failure, THEN the runtime SHALL retry only up to the role/request limit and preserve attempt metadata.
5. WHEN retry is not configured or the failure is not retryable, THEN the runtime SHALL return the first final failure result without unbounded retry loops.
6. WHEN multiple attempts occur, THEN each attempt SHALL be distinguishable in metadata or attempt-specific output records.

### Requirement 7: Structured Output Validation

**User Story:** As a phase adapter implementer, I want child output parsed through caller-provided schemas, so that only validated structured results are handed back to workflow logic.

#### Acceptance Criteria

1. WHEN a caller provides an output schema, THEN the runtime SHALL use the schema's parse and validate operations before setting typed `AgentRunResult.output`.
2. WHEN raw output is malformed, THEN the result SHALL be `invalid-output`, preserve raw output, and include validation diagnostics.
3. WHEN parsed output fails schema validation, THEN the result SHALL be `invalid-output`, preserve raw output, and include schema validation diagnostics.
4. WHEN validation fails, THEN the runtime SHALL NOT commit artifacts, write approvals, or transition workflow state.
5. WHEN validation succeeds, THEN the typed output SHALL be available only through `AgentRunResult.output` for the caller to interpret.
6. WHEN business-specific schemas are needed, THEN they SHALL be supplied by adapters or review panels rather than hard-coded into the generic runtime.

### Requirement 8: Recursion Guard and Child Command Registration Prevention

**User Story:** As a security reviewer, I want child processes prevented from registering parent workflow commands or spawning nested children, so that Brainstorming Pro remains parent-owned and cannot recurse indefinitely.

#### Acceptance Criteria

1. WHEN the parent launches a child, THEN child env SHALL include `BRAINSTORMING_PRO_CHILD=1` and depth metadata.
2. WHEN `runAgent()` is called while child marker is already present, THEN it SHALL reject the run before spawning.
3. WHEN depth is greater than or equal to the maximum supported depth of 1, THEN `runAgent()` SHALL reject the run with `recursion-depth-exceeded` or equivalent typed error.
4. WHEN the extension entrypoint runs with `BRAINSTORMING_PRO_CHILD=1`, THEN it SHALL skip public `/brainstorm-pro` command registration and any child-disallowed workflow command surface.
5. WHEN child mode registration is tested, THEN no parent tools, commands, renderers, or workflow event handlers that could trigger workflow orchestration SHALL be registered.

### Requirement 9: Progress Events and Observability Hooks

**User Story:** As a future TUI/review panel implementer, I want agent execution progress events, so that long-running phases and reviewer runs can be observed without making UI state the source of truth.

#### Acceptance Criteria

1. WHEN an agent run starts, THEN the runtime SHALL emit or call back an `agent.started` progress event.
2. WHEN stdout or stderr data is captured, THEN the runtime SHALL emit output progress events with stream name, byte count, run id, and timestamp.
3. WHEN a retry occurs, THEN the runtime SHALL emit an `agent.retrying` progress event with attempt and reason.
4. WHEN a run completes or fails, THEN the runtime SHALL emit `agent.completed` or `agent.failed` with final status or typed error.
5. WHEN progress callback handling fails, THEN the runtime SHALL record diagnostics but SHALL NOT treat UI/snapshot failure as workflow state truth.
6. WHEN progress events are consumed later by TUI, THEN they SHALL remain observational and SHALL NOT approve gates, mutate artifacts, or transition workflow state.

### Requirement 10: Product Boundary and Reuse Compliance

**User Story:** As a package maintainer, I want agent execution code to respect the approved pi-subagents reuse boundary, so that Brainstorming Pro gains infrastructure value without inheriting generic subagent product semantics.

#### Acceptance Criteria

1. WHEN code is derived from `nicobailon/pi-subagents`, THEN each derived file SHALL include the required attribution header and be declared in the reuse inventory.
2. WHEN package validation runs, THEN it SHALL reject forbidden `pi-subagents` package dependencies or imports of executable logic from `vendor/pi-subagents/`.
3. WHEN public extension APIs are inspected, THEN no generic `subagent` tool, intercom runtime, background async runner, or arbitrary chain/parallel orchestration SHALL be exposed.
4. WHEN child launch/output/progress helpers are adapted, THEN they SHALL be wrapped in Brainstorming Pro role/workflow terminology rather than exposing upstream product types.
5. WHEN validation tests run, THEN they SHALL cover product boundary rules, attribution rules, and no-shell-launch rules for the implemented agent execution modules.

### Requirement 11: Failure Classification and Runtime Boundary

**User Story:** As a phase adapter implementer, I want all execution failures returned as typed result states, so that adapters and workflow runtime can decide blocked/failed behavior deterministically.

#### Acceptance Criteria

1. WHEN launch policy fails, THEN the result SHALL contain a typed unsafe-launch or policy error and no child shall be spawned.
2. WHEN model policy fails, THEN the result SHALL contain a typed model-policy error and no child shall be spawned.
3. WHEN spawn, exit, signal, timeout, output, validation, role, or recursion errors occur, THEN the runtime SHALL map them to typed error kinds.
4. WHEN `runAgent()` returns a failure, THEN it SHALL leave workflow phase, gates, artifact refs, approvals, and review decisions unchanged.
5. WHEN phase adapters receive an agent failure, THEN the failure shape SHALL contain enough paths and diagnostics for the adapter/runtime to enter `failed` or `blocked` according to phase semantics.
6. WHEN unexpected exceptions occur inside agent runtime, THEN they SHALL be caught and converted into typed failures where possible without hiding audit artifacts already written.
