# Requirements Document: Workflow Agent Model Selection

## Introduction

Brainstorming Pro must select and persist a valid provider-qualified model for every agent-backed workflow before the workflow reaches runtime adapter execution. This capability removes the hidden `openai:gpt-4o-mini` fallback, prevents provider-qualified model policy failures during first-run design generation, and gives first-time users, returning workflow users, and maintainers explicit and auditable model behavior.

The implementation is scoped to the `/brainstorm-pro` command boundary, workflow state/runtime, and existing agent-backed adapter construction. The command layer resolves the current Pi session model or prompts from Pi's configured model registry, the workflow persists one selected model for its lifecycle, and adapter/execution layers require that explicit `<provider>/<model>` value. It does not add per-phase model switching, shell parsing of `pi --list-models`, expanded `PI_COMMAND` behavior, or a generic model management UI.

## Glossary

- **Agent-backed workflow**: A Brainstorming Pro workflow phase that launches a child Pi agent through an adapter, such as designing, planning, review, or execution.
- **Provider-qualified model id**: A model identifier in `<provider>/<model>` format, for example `openai/gpt-4o-mini`, accepted by the existing child Pi model policy.
- **Current Pi session model**: The model object exposed on the extension command context as `ctx.model`.
- **Model registry**: Pi's configured model source exposed as `ctx.modelRegistry`, used through registry APIs such as `getAvailable()` rather than parsing CLI output.
- **Workflow agent model**: The provider-qualified model id selected for one Brainstorming Pro workflow and persisted as workflow state.
- **Legacy workflow**: A pre-existing workflow state file that does not yet contain a persisted workflow agent model.
- **Command UX layer**: `/brainstorm-pro` command code responsible for resolving or prompting for a workflow agent model before runtime execution.
- **Adapter layer**: Workflow adapter creation and child execution code that receives and validates an explicit model before launching child Pi.

## Requirements

### Requirement 1: First-run model resolution

**User Story:** As a first-time Brainstorming Pro user, I want a new workflow to use my current Pi model when one is already selected, so that `/brainstorm-pro` starts without a hidden or invalid fallback.

#### Acceptance Criteria

1. WHEN `/brainstorm-pro "<request>"` starts and `ctx.model` is present, THEN the system SHALL derive the workflow agent model from that model object.
2. WHEN deriving a workflow agent model from a Pi model object, THEN the system SHALL format it as `${model.provider}/${model.id}`.
3. WHEN a current Pi session model is used, THEN the system SHALL not open the model picker.
4. WHEN the derived model id is not provider-qualified, THEN the system SHALL reject the start before workflow creation or adapter execution using the existing provider-qualified model policy message.
5. WHEN a new workflow is started, THEN topic proposal SHALL use the same selected model object that established the workflow agent model.

### Requirement 2: Interactive model picker fallback

**User Story:** As a user without a current Pi session model, I want to choose from configured models in the TUI, so that I can explicitly select a valid workflow model.

#### Acceptance Criteria

1. WHEN `/brainstorm-pro "<request>"` starts without `ctx.model`, THEN the system SHALL read configured models through `ctx.modelRegistry.getAvailable()`.
2. WHEN available models exist and the command is interactive, THEN the system SHALL present them through `ctx.ui.select()` for user selection.
3. WHEN the user selects a model from the picker, THEN the system SHALL derive and validate the provider-qualified workflow agent model before workflow creation.
4. WHEN the picker is cancelled or returns no model, THEN the system SHALL abort without creating, advancing, or recording a workflow model.
5. WHEN the model registry returns an empty list, THEN the system SHALL fail before workflow creation with guidance mentioning `pi --list-models` or starting Pi with `--model provider/model`.
6. WHEN no current model exists in a non-interactive context, THEN the system SHALL fail without attempting to open the TUI and explain that a selected model is required.

### Requirement 3: Workflow state persistence

**User Story:** As a returning workflow user, I want the selected model persisted with the workflow, so that later resumes behave consistently.

#### Acceptance Criteria

1. WHEN initial workflow state is created, THEN the system SHALL store the selected provider-qualified id as `WorkflowState.agentModel`.
2. WHEN the workflow state is saved to `.workflow/runs/<runId>/state.json`, THEN `agentModel` SHALL be included with the other durable state fields.
3. WHEN workflow state is loaded for status or resume, THEN the persisted `agentModel` SHALL remain unchanged unless legacy migration explicitly records a missing value.
4. WHEN supplemental augment workflows are created from an existing workflow, THEN the new run SHALL retain the existing workflow agent model.
5. WHEN `WorkflowState.agentModel` is absent, THEN the type system MAY allow that absence only for legacy state handling and lower layers SHALL treat unresolved absence as invalid for agent-backed execution.

### Requirement 4: Resume model reuse and legacy handling

**User Story:** As a returning workflow user, I want resume operations to reuse the workflow's recorded model instead of my current session model, so that phase behavior is stable over time.

#### Acceptance Criteria

1. WHEN `/brainstorm-pro --resume <topic>` loads state with `agentModel`, THEN the system SHALL use that persisted model for all adapter construction.
2. WHEN resume state has `agentModel`, THEN the system SHALL not prompt for a model and SHALL not substitute `ctx.model`.
3. WHEN a legacy workflow missing `agentModel` is resumed at the command layer, THEN the system SHALL resolve a model using the same current-model-or-picker rules as first-run.
4. WHEN a legacy resume successfully resolves a model, THEN the system SHALL patch and persist `agentModel` before running an agent-backed phase.
5. WHEN lower runtime or adapter layers are invoked for an agent-backed phase without a resolved `agentModel`, THEN they SHALL fail closed with a clear model-required diagnostic.
6. WHEN persisted model credentials become invalid after selection, THEN the system SHALL leave the workflow inspectable and rely on existing child execution/authentication diagnostics during execution.

### Requirement 5: Runtime and adapter model source of truth

**User Story:** As a maintainer, I want runtime and adapters to require an explicit workflow model, so that hidden defaults cannot bypass model policy.

#### Acceptance Criteria

1. WHEN `WorkflowRuntimeOrchestrator` constructs default adapters for an active workflow phase, THEN it SHALL pass the workflow state's `agentModel` as the model argument.
2. WHEN `defaultWorkflowAdapters(projectRoot, model, onWorkflowProgress)` is called, THEN `model` SHALL be required and SHALL not default to an environment variable or hardcoded value.
3. WHEN agent-backed adapter factory functions are called, THEN each SHALL receive the explicit workflow agent model.
4. WHEN adapter singleton exports would require a hidden model default, THEN the system SHALL remove or refactor those exports so they do not embed `BRAINSTORMING_PRO_AGENT_MODEL` or `openai:gpt-4o-mini`.
5. WHEN child Pi execution is launched, THEN it SHALL receive `--model <provider>/<model>` using the persisted workflow agent model.
6. WHEN adapter construction receives an invalid model id, THEN validation SHALL fail before launching child Pi.

### Requirement 6: Environment fallback boundary

**User Story:** As a maintainer, I want any environment-based fallback to pass through the same validation boundary, so that configuration shortcuts remain explicit and safe.

#### Acceptance Criteria

1. WHEN an explicit `BRAINSTORMING_PRO_AGENT_MODEL` fallback is supported, THEN it SHALL be resolved outside hidden adapter defaults.
2. WHEN an environment-provided model is used, THEN the system SHALL validate it with the same provider-qualified model policy before workflow creation or legacy patching.
3. WHEN both a current Pi model and an environment model are available, THEN the current Pi session model SHALL be preferred for first-run command resolution.
4. WHEN an environment-provided model is invalid, THEN the system SHALL reject it with the existing provider-qualified model policy message.
5. WHEN no environment fallback is configured, THEN absence SHALL not cause adapters to invent a default model.

### Requirement 7: User-facing diagnostics

**User Story:** As a user, I want clear model selection errors, so that I can fix setup issues without reading internal stack traces.

#### Acceptance Criteria

1. WHEN no configured model is available, THEN the error message SHALL instruct the user to run `pi --list-models` or start Pi using `--model provider/model`.
2. WHEN no model is available in a non-interactive context, THEN the error message SHALL state that a selected model is required.
3. WHEN user selection is cancelled, THEN the message SHALL state that no workflow model was selected and that no workflow was started or recorded.
4. WHEN the selected model id is invalid, THEN the message SHALL preserve the existing expected format text `'<provider>/<model>'`.
5. WHEN legacy model patching fails, THEN the error SHALL avoid advancing the workflow and SHALL explain that the legacy workflow still lacks a valid `agentModel`.

### Requirement 8: Regression coverage and validation

**User Story:** As a maintainer, I want focused tests for model selection, persistence, and adapter validation, so that the fallback bug cannot regress.

#### Acceptance Criteria

1. WHEN model id formatting is tested, THEN tests SHALL cover conversion from model objects to `provider/model` ids and invalid model rejection.
2. WHEN command start is tested with `ctx.model`, THEN tests SHALL assert no picker usage, persisted `agentModel`, and adapter use of that id.
3. WHEN command start is tested without `ctx.model` but with available models, THEN tests SHALL assert picker usage and persisted selection.
4. WHEN picker cancellation is tested, THEN tests SHALL assert no workflow creation or advancement.
5. WHEN resume is tested, THEN tests SHALL assert persisted `agentModel` is used instead of current `ctx.model`.
6. WHEN legacy resume is tested, THEN tests SHALL assert command-layer model resolution patches state before agent-backed execution.
7. WHEN non-interactive or no-model paths are tested, THEN tests SHALL assert actionable diagnostics include `pi --list-models` where applicable.
8. WHEN adapter and model-policy tests are updated, THEN they SHALL use slash-form ids such as `openai/gpt-4o-mini` and `openai/test`.
9. WHEN implementation is complete, THEN `npm run typecheck`, `npm test`, and `npm run validate-package` SHALL pass.
