# Workflow Agent Model Selection Design

## Summary

Brainstorming Pro will bind a provider-qualified workflow agent model when a workflow is first created, using the current Pi session model when available and otherwise prompting the user to choose from configured available models. The selected model is persisted with the workflow and reused for all future resume operations, removing the invalid hardcoded `openai:gpt-4o-mini` fallback and making first-run behavior explicit, auditable, and user-controlled.

## Goals

- Require every agent-backed Brainstorming Pro workflow to use a valid provider-qualified model id in `<provider>/<model>` format.
- Prefer the current Pi session model when one is already selected.
- If no current model exists, present a TUI selection from models available through Pi's model registry.
- Persist the selected model on the workflow so later `/brainstorm-pro --resume` operations use the same model without asking again.
- Fail early with a clear, actionable message in non-interactive or unconfigured environments.
- Remove the hardcoded `openai:gpt-4o-mini` adapter fallback.

## Primary Users / Roles

- **First-time Brainstorming Pro users**: want `/brainstorm-pro` to work without obscure model-policy failures.
- **Returning workflow users**: want resumed workflows to behave consistently across phases.
- **Maintainers**: need model selection to remain explicit, testable, and compatible with provider-qualified child Pi execution policy.

## Non-Goals

- Do not select a different model per phase.
- Do not automatically switch models on every resume based on the current Pi session model.
- Do not parse human-formatted `pi --list-models` output inside the extension.
- Do not add shell command parsing or expand `PI_COMMAND` behavior.
- Do not add a generic subagent model management UI.
- Do not implement workflow execution before this design is converted into requirements and tasks.

## Context

Current `/brainstorm-pro` start behavior uses `ctx.model` only to propose a workflow topic. The subsequent workflow runtime creates default adapters with `undefined` as the model argument, causing `defaultWorkflowAdapters()` and several adapter exports to fall back to `process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini"`. The foreground child execution layer correctly enforces provider-qualified model ids in `<provider>/<model>` format, so the colon-form default fails with a non-recoverable model-policy error during the `designing` phase.

Pi exposes configured model information through `ctx.modelRegistry`, and the CLI can display configured models with `pi --list-models`. Inside the extension, using `ctx.modelRegistry.getAvailable()` is preferable to parsing CLI output because it returns registry-backed model objects and respects Pi's configured authentication state.

## Discovery (recommended for non-trivial or ambiguous requirements)

### Key Discoveries

- The invalid model originates from hardcoded adapter fallbacks, not from user configuration.
- `ctx.model` is available at the command boundary but is not propagated into workflow runtime adapters.
- The provider-qualified execution policy is intentional and should remain fail-closed.
- The correct Pi CLI inspection command is `pi --list-models`, not `pi --list-model`.
- Binding the selected model to the workflow is preferred over following the current session model on every resume.

### Scope Decisions

- Include a first-run TUI model picker only when the command context has no current model.
- Persist one workflow agent model for the full workflow lifecycle.
- Allow explicit environment fallback only if it is routed through the same validation boundary; adapters themselves must not contain hidden model defaults.
- Treat legacy workflows missing the persisted model as requiring command-layer resolution before agent-backed phases can run.

## Proposed Solution

Add workflow-agent model resolution at the `/brainstorm-pro` command boundary and persist the selected provider-qualified id in workflow state. The runtime and adapters will require an explicit model, validate it before constructing agent-backed adapters, and reuse the persisted workflow model for subsequent phases. When no current session model exists, the command will prompt through `ctx.ui.select()` using `ctx.modelRegistry.getAvailable()` results; if interaction is unavailable or no configured model exists, it will stop with clear setup guidance.

### Architecture

The solution has three layers:

1. **Command UX layer** (`commands/brainstorm-pro.ts` plus a model-selection helper): resolves or prompts for a model, converts it to `<provider>/<model>`, and passes it into workflow creation/resume.
2. **Workflow state/runtime layer** (`workflow/types.ts`, `workflow/runtime.ts`): stores `agentModel` and uses it as the only source of truth for adapter construction after workflow creation.
3. **Adapter/execution layer** (`workflow/adapters/*`, `runtime/agent-execution/*`): receives an explicit provider-qualified model and continues enforcing the existing model policy before launching child Pi.

### Components

- **`WorkflowState.agentModel?: string`**
  - Stores the selected provider-qualified workflow agent model.
  - Optional at the type level only to support old state files and migration/error handling.

- **Model selection helper**
  - Converts `Model<any>` objects to provider-qualified ids using `${model.provider}/${model.id}`.
  - Uses `ctx.model` when present.
  - Uses `ctx.modelRegistry.getAvailable()` and `ctx.ui.select()` when `ctx.model` is absent.
  - Validates the selected id with the existing provider-qualified policy.
  - Emits actionable errors for cancellation, no available models, or non-interactive contexts.

- **Workflow bootstrap and resume inputs**
  - `startWorkflow` accepts `agentModel` and writes it into the initial state.
  - `resumeWorkflow` and `WorkflowRuntimeOrchestrator` derive adapter model from persisted state.
  - Legacy state without `agentModel` is resolved by command UX before runtime execution, or rejected fail-closed by lower layers.

- **Adapter registry**
  - `defaultWorkflowAdapters(projectRoot, model, onWorkflowProgress)` requires an explicit `model` argument.
  - Hardcoded model defaults are removed from registry and agent-backed adapter singleton exports.

- **User-facing diagnostics**
  - No configured model: instruct user to run `pi --list-models` or start Pi with `--model provider/model`.
  - Invalid model: preserve the existing provider-qualified policy message.
  - Cancelled selection: state that no workflow was started or no model was recorded.

### Data Flow

Initial `/brainstorm-pro "<request>"` flow:

1. Parse command arguments.
2. Resolve workflow model:
   - use `ctx.model` if present;
   - otherwise call `ctx.modelRegistry.getAvailable()`;
   - if multiple or any available models exist, prompt with `ctx.ui.select()`;
   - validate the chosen provider-qualified id.
3. Use the chosen `Model<any>` object for topic proposal.
4. Create workflow state with `agentModel` set to the chosen provider-qualified id.
5. Resume the workflow; runtime reads `state.agentModel` and creates adapters with that explicit model.
6. Child Pi execution receives `--model <provider>/<model>`.

Subsequent `/brainstorm-pro --resume <topic>` flow:

1. Load latest workflow state.
2. If `state.agentModel` exists, use it for all adapter construction.
3. Do not prompt and do not substitute the current Pi session model.
4. If `state.agentModel` is missing, command-layer legacy handling prompts once and persists the result before running; lower layers reject unresolved missing models.

## Error Handling

- **No configured model available**: fail before workflow creation with guidance to run `pi --list-models` or start Pi using `--model provider/model`.
- **Non-interactive context without current model**: fail without trying to open TUI, explaining that a selected model is required.
- **User cancels model picker**: abort the operation and report that no workflow model was selected.
- **Invalid provider-qualified id**: reject with the existing model-policy message.
- **Legacy workflow missing `agentModel`**: command-layer resume prompts and patches state; runtime/adapters fail closed if invoked without an explicit model.
- **Model loses API key after being persisted**: child execution or topic/model auth checks fail with existing authentication diagnostics; the workflow remains inspectable and resumable after user fixes configuration.

## Testing

- Unit test model id formatting and validation from `Model<any>` objects.
- Unit test command start with `ctx.model`: no picker, state includes `agentModel`, adapters receive that id.
- Unit test command start without `ctx.model` but with available models: picker is shown and selection is persisted.
- Unit test cancelled picker: operation aborts without creating or advancing workflow.
- Unit test resume uses persisted `agentModel` instead of current `ctx.model`.
- Unit test legacy resume missing `agentModel`: command prompts and patches state before agent-backed execution.
- Unit test non-interactive/no-model path: actionable error includes `pi --list-models`.
- Update model-policy and adapter tests to use slash-form ids such as `openai/gpt-4o-mini` and `openai/test`.
- Run `npm run typecheck`, `npm test`, and `npm run validate-package`.

## Open Questions

- Should a future explicit command be added to rebind a workflow model after creation? This is out of scope for the initial fix and should require a separate approval/audit design if needed.
