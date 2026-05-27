# Requirements Document: Pi List Model Agent Model

## Introduction

Brainstorming Pro needs a reliable way to choose and persist the workflow agent model used by child Pi executions. The system will discover selectable models by running `pi --list-models`, parse the returned provider/model rows, format the selected row as `<provider>/<model>`, and persist that formatted string in the existing `WorkflowState.agentModel` field.

This change removes Brainstorming Pro's custom provider naming policy while preserving the provider-qualified runtime contract needed for deterministic child process execution. Pi remains the authority for which providers and models exist; Brainstorming Pro only parses Pi's model list, preserves exact provider/model text, performs minimal structural safety validation, and passes the selected model to child Pi with `--model`.

## Glossary

- **Agent model**: The persisted workflow model string stored in `WorkflowState.agentModel` and passed to child Pi processes with `--model`.
- **Listed Pi model**: One provider/model row parsed from `pi --list-models` output.
- **Provider-qualified model argument**: Brainstorming Pro's persisted and CLI argument form `<provider>/<model>`, produced by formatting a listed Pi model.
- **Provider**: The provider name reported by Pi, preserved exactly without Brainstorming Pro normalization or naming restrictions.
- **Model id**: The model identifier reported by Pi for a provider, preserved exactly except for trimming table whitespace.
- **Workflow state**: The durable state stored under `specs/<topic>/.workflow/runs/<run-id>/state.json`.

## Requirements

### Requirement 1: Pi model discovery source

**User Story:** As a Brainstorming Pro user, I want model choices to come from Pi's configured model list, so that built-in and custom models are both available without maintaining duplicate plugin configuration.

#### Acceptance Criteria

1. WHEN a workflow start or legacy-resume needs a new agent model selection and no current persisted `agentModel` is available, THEN the system SHALL run the resolved Pi invocation with `--list-models` to discover selectable models.
2. WHEN Pi reports built-in models through `pi --list-models`, THEN the system SHALL include those models in the selectable set.
3. WHEN Pi reports custom models through `pi --list-models`, THEN the system SHALL include those models in the selectable set.
4. WHEN discovering selectable workflow models, THEN the system SHALL NOT use `~/.pi/agent/models.json` as the primary source.
5. WHEN discovering selectable workflow models, THEN the system SHALL NOT require `pi --list-models` to return raw `<provider>/<model>` strings.
6. IF `pi --list-models` cannot be executed or exits non-zero, THEN the system SHALL stop before creating or mutating workflow state and report that Pi model discovery failed.

### Requirement 2: Model list parsing and formatting

**User Story:** As a maintainer, I want Brainstorming Pro to parse Pi's listed provider/model rows and format them consistently, so that child Pi executions receive the expected `--model` argument without redefining provider rules.

#### Acceptance Criteria

1. WHEN `pi --list-models` returns a whitespace-aligned table containing provider and model columns, THEN the system SHALL parse each valid row into a listed Pi model with `provider` and `model` fields.
2. WHEN parsing provider values, THEN the system SHALL preserve uppercase letters, hyphens, dots, underscores, and printable non-ASCII characters exactly as reported by Pi.
3. WHEN parsing model id values, THEN the system SHALL preserve model ids exactly except for removing surrounding table whitespace.
4. WHEN a listed Pi model is selected, THEN the system SHALL format it as `${provider}/${model}` for persistence and child Pi invocation.
5. WHEN formatting a selected listed Pi model, THEN the system SHALL NOT lowercase, normalize, rewrite, or otherwise alter the provider value.
6. IF `pi --list-models` returns no parseable provider/model rows, THEN the system SHALL stop with guidance to verify Pi model configuration and `pi --list-models` output.

### Requirement 3: Workflow state persistence

**User Story:** As a Brainstorming Pro user, I want resumed workflows to reuse the same selected model, so that workflow behavior remains deterministic across sessions.

#### Acceptance Criteria

1. WHEN a new workflow is created after model selection, THEN the system SHALL persist the formatted agent model string in `WorkflowState.agentModel`.
2. WHEN a legacy workflow without `agentModel` is resumed and model selection succeeds, THEN the system SHALL persist the formatted agent model string before running any agent-backed phase.
3. WHEN a workflow state already contains `agentModel`, THEN resume SHALL reuse that persisted string without running model discovery or replacing it with a different current model.
4. WHEN persisting `agentModel`, THEN the system SHALL keep the existing string field shape and SHALL NOT persist a structured `{ provider, id }` object.
5. WHEN status is requested for a workflow, THEN the system SHALL NOT run model discovery, prompt for selection, or mutate `agentModel`.

### Requirement 4: Minimal model validation policy

**User Story:** As a user with custom Pi providers, I want Brainstorming Pro to accept provider names that Pi accepts, so that valid configured models such as `Alpha/gpt-5.5` are not rejected by plugin-only rules.

#### Acceptance Criteria

1. WHEN validating an agent model string, THEN the system SHALL trim surrounding whitespace before validation and persistence/use.
2. WHEN the trimmed model string contains a `/` with a non-empty provider segment before it and a non-empty model segment after it, THEN the system SHALL treat the value as structurally provider-qualified unless another safety criterion rejects it.
3. WHEN the provider segment contains uppercase letters, hyphens, dots, underscores, or printable non-ASCII characters, THEN the system SHALL NOT reject the value for that reason.
4. WHEN the model segment contains colons, dots, hyphens, underscores, uppercase letters, lowercase letters, digits, or printable non-ASCII characters, THEN the system SHALL NOT reject the value for that reason.
5. IF the value is empty, lacks `/`, starts with `/`, ends with `/`, or contains newline/control characters, THEN the system SHALL reject it before persistence or child execution.
6. WHEN validation rejects a value, THEN the error message SHALL explain that the model must have non-empty provider and model segments separated by `/` without implying that provider casing is invalid.

### Requirement 5: Selection UX and cancellation behavior

**User Story:** As a Brainstorming Pro user, I want a clear model picker and safe cancellation behavior, so that I can choose the correct Pi model without accidental workflow mutation.

#### Acceptance Criteria

1. WHEN parsed model choices are available in an interactive workflow start, THEN the system SHALL present them to the user using labels that include the exact provider and model values.
2. WHEN parsed model choices are available during legacy-resume patching, THEN the system SHALL present a message indicating that the selected model will be used for the legacy Brainstorming Pro workflow.
3. WHEN the user selects a model, THEN the system SHALL persist only the formatted `<provider>/<model>` string.
4. IF the user cancels model selection during workflow start, THEN the system SHALL not create a workflow state file.
5. IF the user cancels model selection during legacy-resume patching, THEN the system SHALL not patch the legacy state or run an agent-backed phase.
6. WHEN no UI is available and model selection is required, THEN the system SHALL fail before workflow creation or mutation with guidance to start Pi with a model or run interactively.

### Requirement 6: Child execution integration

**User Story:** As a maintainer, I want child Pi processes to receive the exact selected model string, so that model selection and execution remain auditable and deterministic.

#### Acceptance Criteria

1. WHEN an agent-backed phase launches a child Pi process, THEN the system SHALL pass the persisted `WorkflowState.agentModel` value unchanged as the `--model` argument after successful minimal validation.
2. WHEN a persisted `agentModel` is invalid, THEN the system SHALL fail closed before spawning the child Pi process.
3. WHEN a valid mixed-case or non-ASCII provider model is persisted, THEN child execution SHALL not reject it through Brainstorming Pro provider-name validation.
4. WHEN building child Pi process arguments, THEN existing safety boundaries such as `--no-session`, `--no-skills`, child markers, and safe Pi invocation resolution SHALL remain unchanged.

### Requirement 7: Diagnostics and documentation alignment

**User Story:** As a user or maintainer, I want diagnostics and documentation to match the actual model discovery behavior, so that failures are actionable and not misleading.

#### Acceptance Criteria

1. WHEN model discovery cannot start because the Pi executable cannot be found, THEN the diagnostic SHALL preserve existing guidance about extension process `PATH`, `PI_COMMAND`, and rerunning from an environment where `pi --list-models` works.
2. WHEN no parseable models are discovered, THEN the diagnostic SHALL mention checking `pi --list-models` output and Pi model configuration.
3. WHEN validation fails, THEN diagnostics SHALL not claim that uppercase provider names are invalid.
4. WHEN README or workflow documentation describes model discovery, THEN it SHALL state that Brainstorming Pro parses `pi --list-models` rows and formats the selected provider/model as `<provider>/<model>` internally.
5. WHEN README or workflow documentation describes workflow state, THEN it SHALL state that `agentModel` remains a string.
