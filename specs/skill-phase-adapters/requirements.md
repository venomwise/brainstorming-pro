# Requirements Document: Skill Phase Adapters

## Introduction

Skill Phase Adapters turn the Brainstorming Pro package-owned `brainstorming` and `spec-plan` methodologies into workflow-owned runtime phases. The system replaces placeholder pass-through adapters with controlled, agent-backed adapters that can draft `design.md`, `requirements.md`, and `tasks.md` while preserving the Workflow Runtime Orchestrator as the sole authority for artifact commits, event appends, state transitions, review decisions, and approval gates.

The implementation is scoped to design and planning artifact generation plus a safe deferred execution boundary. `BrainstormingPhaseAdapter` and `SpecPlanPhaseAdapter` use the existing Agent Execution Runtime `runAgent()` substrate with role policy, `--no-session`, `--no-skills`, recursion guard, provider-qualified model validation, bounded output capture, prompt files, and structured output validation. Full task execution, task parsing, checkbox updates, optional execution mode, and execution report generation remain out of scope and must be designed by a later controlled execution adapter spec.

## Glossary

- **Adapter**: A workflow-owned phase component that builds context, invokes controlled child reasoning when needed, validates output, and returns runtime-consumable results.
- **Agent Execution Runtime**: The existing `runtime/agent-execution` substrate that launches child Pi processes through `runAgent()` under role, model, output, recursion, and launch safety policies.
- **Artifact commit request**: An adapter result that asks the runtime to commit one or more artifacts without directly writing versioned artifacts, mirrors, decisions, approvals, events, or state truth.
- **Approval gate**: A runtime-enforced design or plan approval that must bind to exact versioned artifact references before later phases may run.
- **Child Pi process**: A controlled Pi invocation launched by `runAgent()` to produce structured output for a phase.
- **Design draft output**: Structured JSON output from the design author child containing candidate design markdown and supporting metadata.
- **Plan draft output**: Structured JSON output from the plan author child containing candidate requirements markdown, tasks markdown, and traceability metadata.
- **Review decision**: A runtime-owned selection of review mode for a target artifact set, such as skip, minimal, or full.
- **Runtime authority boundary**: The rule that adapters and child agents may draft and validate outputs, but only the runtime may commit artifacts, append events, transition state, or record decisions and approvals.
- **SpecExecPhaseAdapter**: The execution phase adapter that is intentionally deferred in this spec and must not perform uncontrolled full-plan LLM execution.
- **Workflow Runtime Orchestrator**: The runtime lifecycle owner for workflow state, artifacts, events, review decisions, approvals, and phase transitions.

## Requirements

### Requirement 1: Adapter Result Contract and Runtime Authority Boundary

**User Story:** As a Brainstorming Pro maintainer, I want phase adapters to return explicit commit, blocked, or failed results, so that artifact generation can be agent-backed without allowing adapters to bypass workflow lifecycle controls.

#### Acceptance Criteria

1. WHEN a phase adapter successfully produces artifact content, THEN the system SHALL represent the result as an `artifact-commit-request` containing artifact kind, content, optional summary, and optional metadata.
2. WHEN a phase adapter cannot proceed because a required precondition or deferred capability is unavailable, THEN the system SHALL represent the result as `blocked` with a reason and optional diagnostics.
3. WHEN a phase adapter or child agent fails, THEN the system SHALL represent the result as `failed` with typed error kind, message, and retryability.
4. WHEN an adapter returns an artifact commit request, THEN the runtime SHALL remain responsible for version allocation, artifact mirror writes, checksum calculation, event append, state transition, and persisted state updates.
5. WHEN adapter code executes, THEN it SHALL NOT write approval files, review decision files, workflow event logs, workflow state truth, or artifacts outside runtime-approved commit helpers.
6. IF an adapter attempts to replace runtime-owned review decisions, approvals, or direct state truth, THEN tests or runtime guards SHALL reject the behavior.
7. WHEN existing adapter interfaces are evolved, THEN the implementation SHALL preserve the runtime authority boundary even if compatibility wrappers or state patches remain temporarily present.

### Requirement 2: Adapter Context Builder

**User Story:** As an adapter implementer, I want a shared context builder for phase inputs and approved artifacts, so that adapters receive only topic-scoped, checksum-verified data instead of resolving arbitrary paths.

#### Acceptance Criteria

1. WHEN building brainstorming context, THEN the system SHALL include topic, run id, request, project root, topic directory, and workflow metadata needed by the child design author.
2. WHEN augmenting an existing topic, THEN the brainstorming context builder SHALL load the existing design only through safe workflow artifact helpers and include its artifact ref and content when available.
3. WHEN building spec-plan context, THEN the system SHALL load the approved design artifact content and the design approval metadata for the exact approved artifact refs.
4. WHEN a context builder receives or derives an artifact ref, THEN it SHALL verify that the ref is scoped to the topic directory and that the resolved content checksum matches the ref checksum.
5. IF a planning context lacks a design approval, references a stale design version, or has a checksum mismatch, THEN context construction SHALL fail before `SpecPlanPhaseAdapter` invokes a child agent.
6. IF an artifact path is absolute or resolves outside `specs/<topic>/`, THEN context construction SHALL reject it.
7. WHEN context construction succeeds, THEN adapters SHALL consume plain typed context objects rather than directly resolving arbitrary filesystem paths.

### Requirement 3: Structured Output Schemas and Validation

**User Story:** As a security and reliability reviewer, I want child output to be schema-validated and phase-validated, so that untrusted child agent text cannot become workflow artifacts unless it matches the adapter contract.

#### Acceptance Criteria

1. WHEN validating `DesignDraftOutput`, THEN the system SHALL require `kind` to equal `design-draft`, `topic` to match the workflow topic, non-empty `designMarkdown`, and array fields for assumptions, non-goals, risks, and open questions.
2. WHEN validating design markdown, THEN the system SHALL require the approved design template headings `## Summary`, `## Goals`, `## Primary Users / Roles`, `## Non-Goals`, `## Context`, `## Proposed Solution`, `## Error Handling`, `## Testing`, and `## Open Questions`.
3. IF design markdown includes generated `requirements.md` or `tasks.md` artifact content, claims review completion, or claims approval, THEN design output validation SHALL reject it when detectable.
4. WHEN validating `PlanDraftOutput`, THEN the system SHALL require `kind` to equal `plan-draft`, `topic` to match the workflow topic, non-empty `requirementsMarkdown`, non-empty `tasksMarkdown`, and a traceability array.
5. WHEN validating plan markdown, THEN the system SHALL require `tasksMarkdown` to include `## Tasks`, checkbox task lines, and unchecked generated tasks.
6. IF plan output instructs execution before plan approval, modifies the approved design, or requires execution-time edits to approved design or requirements, THEN validation SHALL reject it when detectable.
7. IF output parsing or schema validation fails, THEN the adapter SHALL return a failed result rather than committing artifacts or advancing phases.

### Requirement 4: Prompt Template Framework

**User Story:** As a workflow maintainer, I want package-owned prompt templates for design and planning phases, so that skill methodology is compiled into controlled runtime behavior without loading child skills.

#### Acceptance Criteria

1. WHEN building a brainstorming prompt, THEN the system SHALL include project context, user request, topic, required design headings, structured JSON output schema instructions, and instructions to record assumptions, non-goals, risks, and open questions.
2. WHEN building a brainstorming prompt, THEN the system SHALL instruct the child not to create `requirements.md` or `tasks.md`, not to approve anything, not to claim review completion, and to keep markdown suitable for artifact-store commit.
3. WHEN building a spec-plan prompt, THEN the system SHALL include approved design content, approved design artifact version and checksum metadata, design approval metadata, expected requirements/tasks structure, traceability instructions, and structured JSON output schema instructions.
4. WHEN building a spec-plan prompt, THEN the system SHALL instruct the child not to execute tasks, not to change the approved design, not to approve the plan, and to produce unchecked tasks only.
5. WHEN prompts are passed to `runAgent()`, THEN the Agent Execution Runtime SHALL continue writing prompt and system prompt files through its existing prompt-file mechanism.
6. IF prompt generation lacks required phase constraints or structured output instructions, THEN tests SHALL fail for the affected prompt module.

### Requirement 5: Brainstorming Phase Adapter

**User Story:** As a workflow user, I want `/brainstorm-pro` design generation to produce a real versioned `design.md`, so that the workflow can proceed to design review and approval gates without manual placeholder artifacts.

#### Acceptance Criteria

1. WHEN the workflow phase is `designing`, THEN `BrainstormingPhaseAdapter` SHALL build brainstorming adapter context and invoke `runAgent()` with role `design-author`.
2. WHEN invoking the design author child, THEN the adapter SHALL provide the package-owned brainstorming prompt, system prompt, workflow context, provider-qualified model, output schema, and existing Agent Execution Runtime safety boundaries.
3. WHEN the child returns valid `DesignDraftOutput`, THEN the adapter SHALL return an artifact commit request for a `design` artifact using `designMarkdown` and summary metadata.
4. WHEN the design artifact commit succeeds, THEN the runtime SHALL commit `.workflow/artifacts/design/vN.md`, update the `design.md` mirror, append appropriate artifact/phase events where supported, and advance to `awaiting-design-review-decision`.
5. IF child execution times out, exits non-zero, exceeds output limits, or returns invalid output, THEN the adapter SHALL return a failed result with diagnostics and SHALL NOT request a design commit.
6. IF design validation fails because required headings are missing, THEN the adapter SHALL fail closed and allow retry according to runtime recovery behavior.
7. WHEN the adapter runs, THEN it SHALL NOT write review decisions, approvals, or workflow state directly.

### Requirement 6: Spec-Plan Phase Adapter

**User Story:** As a workflow user, I want approved designs to generate real `requirements.md` and `tasks.md`, so that planning artifacts are traceable and ready for review and approval before execution.

#### Acceptance Criteria

1. WHEN the workflow phase is `planning`, THEN `SpecPlanPhaseAdapter` SHALL run only after the runtime verifies that the latest design artifact has a matching review decision or skipped review status and a matching design approval.
2. WHEN planning preconditions are satisfied, THEN the adapter SHALL build spec-plan context from the approved design and invoke `runAgent()` with role `plan-author`.
3. WHEN invoking the plan author child, THEN the adapter SHALL provide the package-owned spec-plan prompt, system prompt, workflow context, provider-qualified model, output schema, and existing Agent Execution Runtime safety boundaries.
4. WHEN the child returns valid `PlanDraftOutput`, THEN the adapter SHALL return an artifact commit request for `requirements` and `tasks` artifacts and include traceability, assumptions, and risks metadata.
5. WHEN the plan artifact commit succeeds, THEN the runtime SHALL commit `.workflow/artifacts/requirements/vN.md` and `.workflow/artifacts/tasks/vN.md`, update `requirements.md` and `tasks.md` mirrors, append appropriate artifact/phase events where supported, and advance to `awaiting-plan-review-decision`.
6. IF planning is attempted without an approved design bound to the exact design artifact version, THEN the runtime SHALL reject the phase before invoking `SpecPlanPhaseAdapter`.
7. WHEN the adapter runs, THEN it SHALL NOT execute tasks, modify the approved design, approve the plan, write review decisions, write approvals, or mutate workflow state directly.

### Requirement 7: Deferred Spec Execution Boundary

**User Story:** As a future controlled execution designer, I want the current execution adapter to be explicitly unavailable or safely blocked, so that the system never implements uncontrolled full-`tasks.md` LLM execution as a temporary shortcut.

#### Acceptance Criteria

1. WHEN the workflow reaches `executing` before the controlled execution adapter spec is implemented, THEN `SpecExecPhaseAdapter` SHALL return a blocked or unavailable result instead of marking the workflow done.
2. WHEN execution is requested, THEN the adapter SHALL NOT hand the full `tasks.md` to a child LLM for black-box execution.
3. WHEN execution is unavailable, THEN the runtime SHALL record a diagnostic and keep the workflow recoverable according to the implementation recovery model.
4. WHEN future execution is implemented, THEN the architecture SHALL use a code-owned task loop and an LLM single-task worker model.
5. WHEN future execution runs, THEN code SHALL own task parsing, next-task selection, optional mode handling, checkpoint task selection, checkbox updates, stop conditions, task evidence, and execution report persistence.
6. WHEN future execution uses an LLM worker, THEN the LLM SHALL execute exactly one current task at a time and SHALL NOT update `tasks.md` progress markers.
7. WHEN execution completes in the future implementation, THEN requirements SHALL remain the acceptance source of truth, design SHALL remain background context, and execution SHALL NOT revise approved requirements or the approved plan.

### Requirement 8: Runtime Integration and Gate Preservation

**User Story:** As a Workflow Runtime Orchestrator owner, I want agent-backed adapters integrated into the existing lifecycle, so that generated artifacts still stop at review decisions and approval gates.

#### Acceptance Criteria

1. WHEN a workflow starts and the design adapter succeeds, THEN the workflow SHALL stop at `awaiting-design-review-decision` with a versioned design artifact.
2. WHEN a design review decision and design approval are completed, THEN the runtime SHALL enter `planning` and may invoke the spec-plan adapter.
3. WHEN the plan adapter succeeds, THEN the workflow SHALL stop at `awaiting-plan-review-decision` with versioned requirements and tasks artifacts.
4. WHEN a plan review decision and plan approval are completed, THEN the runtime SHALL enter `executing` but SHALL NOT complete execution unless a controlled execution implementation is available.
5. IF a user attempts planning before design approval, THEN the runtime SHALL leave state protected and SHALL NOT invoke the plan author child.
6. IF a user attempts execution before plan approval, THEN the runtime SHALL leave state protected and SHALL NOT invoke task execution.
7. WHEN adapter failure occurs, THEN the runtime SHALL persist a blocked or failed state with a recoverable diagnostic and SHALL NOT skip review or approval gates.

### Requirement 9: Agent Execution Safety Preservation

**User Story:** As a security reviewer, I want skill phase adapters to use the existing child process safety controls, so that adding real artifact generation does not expand trust boundaries.

#### Acceptance Criteria

1. WHEN either design or plan adapter invokes `runAgent()`, THEN the child launch SHALL still use `--no-session`.
2. WHEN either design or plan adapter invokes `runAgent()`, THEN the child launch SHALL still use `--no-skills`.
3. WHEN either design or plan adapter invokes `runAgent()`, THEN role policy SHALL restrict `design-author` to `designing` and `plan-author` to `planning`.
4. WHEN either design or plan adapter invokes `runAgent()`, THEN provider-qualified model validation SHALL still be enforced.
5. WHEN either design or plan adapter invokes `runAgent()`, THEN recursion guard and child environment markers SHALL still be enforced.
6. WHEN either design or plan adapter invokes `runAgent()`, THEN bounded stdout, stderr, and raw output capture SHALL still be enforced.
7. IF adding adapters would expose a generic public subagent API, arbitrary single/parallel/chain/async orchestration, or a background async runner, THEN validation tests SHALL reject the change.

### Requirement 10: Test Coverage and Documentation Alignment

**User Story:** As a maintainer, I want comprehensive tests and aligned docs for agent-backed phase adapters, so that future refactors preserve product boundaries and lifecycle semantics.

#### Acceptance Criteria

1. WHEN schema modules are implemented, THEN unit tests SHALL cover valid and invalid design draft output, valid and invalid plan draft output, topic mismatches, missing headings, empty markdown, pre-completed tasks, and premature execution instructions.
2. WHEN context builders are implemented, THEN unit tests SHALL cover brainstorming context, augment context, approved design loading, missing approval, stale approval version, out-of-topic artifact refs, and checksum mismatch.
3. WHEN `BrainstormingPhaseAdapter` is implemented, THEN unit tests SHALL verify role selection, phase use, prompt/system prompt use, commit request creation, and no direct state/decision/approval writes.
4. WHEN `SpecPlanPhaseAdapter` is implemented, THEN unit tests SHALL verify role selection, approved design precondition use, requirements/tasks commit request creation, no task execution, no design modification, and no direct decision/approval writes.
5. WHEN `SpecExecPhaseAdapter` remains deferred, THEN unit tests SHALL verify it does not perform uncontrolled execution, does not mark workflow done, and returns a blocked or unavailable result.
6. WHEN runtime integration is implemented, THEN integration tests SHALL cover start-to-design generation, design gate stopping, approval-to-planning generation, plan gate stopping, precondition rejection, and malformed child output failure.
7. WHEN security-sensitive boundaries are implemented, THEN security tests SHALL cover no approval/decision/state mutation by adapters, child `--no-session`, child `--no-skills`, no generic subagent API, and no arbitrary orchestration API.
8. WHEN public workflow behavior, artifact layout, phase names, or adapter boundaries change, THEN README or workflow design documentation and documentation alignment tests SHALL be updated to match.
