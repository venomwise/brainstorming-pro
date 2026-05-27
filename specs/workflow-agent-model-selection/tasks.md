# Implementation Plan: Workflow Agent Model Selection

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is organized into six phases: model-resolution helper, workflow state persistence, command integration, runtime/adapter default removal, diagnostics, and regression validation. The order starts at the command boundary because model selection must happen before workflow creation, then carries the selected id through durable state and runtime adapter construction, and finally removes hidden defaults that currently bypass the intended policy. The implementation uses existing TypeScript ES modules, the Pi extension command context, existing workflow state persistence, and the existing provider-qualified model policy.

## Tasks

- [✅] 1. Phase 1: Add command-layer model resolution helper
  - [✅] 1.1 Create workflow model selection module
    - Create `extensions/clarification-orchestrator/commands/workflow-agent-model.ts` with `modelToProviderQualifiedId(model)` that returns `${model.provider}/${model.id}` from Pi model objects
    - Add `validateWorkflowAgentModel(modelId)` that delegates to `validateProviderQualifiedModel` from `extensions/clarification-orchestrator/runtime/agent-execution/model-policy.ts` and throws the existing policy message on invalid ids
    - Export a typed `resolveWorkflowAgentModel(ctx, options)` helper returning both the selected model object when available and the provider-qualified id
    - _Requirements: 1.1, 1.2, 1.4, 6.2, 7.4_
  - [✅] 1.2 Implement current session model preference
    - In `resolveWorkflowAgentModel`, use `ctx.model` when present and validate the derived provider-qualified id
    - Ensure this path records that no picker was needed and returns the current model object for topic proposal
    - Ensure `BRAINSTORMING_PRO_AGENT_MODEL` does not override `ctx.model` when both exist
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 6.3_
  - [✅] 1.3 Implement registry-backed picker fallback
    - In `resolveWorkflowAgentModel`, call `ctx.modelRegistry.getAvailable()` when `ctx.model` is absent
    - Use `ctx.ui.select()` to present configured models in interactive command contexts and return the selected model object plus provider-qualified id
    - Detect cancellation or missing selection and throw an abort diagnostic before workflow creation can proceed
    - Do not parse `pi --list-models` output or add shell command parsing
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [✅] 1.4 Implement no-model and non-interactive failures
    - Add helper branches for empty registry results with guidance mentioning `pi --list-models` and `--model provider/model`
    - Add a non-interactive branch that fails without opening `ctx.ui.select()` and states that a selected model is required
    - If supporting `BRAINSTORMING_PRO_AGENT_MODEL`, route it through `validateWorkflowAgentModel` outside adapter defaults and only when command policy allows it
    - _Requirements: 2.5, 2.6, 6.1, 6.2, 6.4, 7.1, 7.2_
  - [✅]* 1.5 Write unit tests for model resolution helper
    - Add tests in `tests/unit/commands/brainstorm-pro.test.ts` or a new `tests/unit/commands/workflow-agent-model.test.ts`
    - Test model object conversion to `provider/model`, invalid id rejection, `ctx.model` preference, picker selection, cancellation, empty registry, non-interactive failure, and optional environment fallback validation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.4, 2.5, 2.6, 6.2, 6.3, 6.4, 8.1, 8.3, 8.4, 8.7_

- [✅] 2. Phase 2: Persist workflow agent model in workflow state
  - [✅] 2.1 Extend workflow state types and bootstrap input
    - Modify `extensions/clarification-orchestrator/workflow/types.ts` to add optional `agentModel?: string` to `WorkflowState` with comments documenting optionality for legacy state only
    - Modify `WorkflowBootstrapInput` in `extensions/clarification-orchestrator/workflow/runtime.ts` to require `agentModel: string` for new workflows
    - Modify `createInitialWorkflowState(input)` to validate and write `agentModel` into the initial `WorkflowState`
    - _Requirements: 3.1, 3.2, 3.5_
  - [✅] 2.2 Preserve agent model across augment workflows
    - Modify `augmentWorkflow(input)` in `extensions/clarification-orchestrator/workflow/runtime.ts` so new augment runs copy `previous.agentModel`
    - If `previous.agentModel` is missing, keep the workflow in a fail-closed path that requires command-layer legacy resolution before agent-backed execution
    - _Requirements: 3.3, 3.4, 4.5_
  - [✅] 2.3 Add legacy state patching utility
    - Add `persistWorkflowAgentModel(cwd, topic, agentModel)` or equivalent in `extensions/clarification-orchestrator/workflow/runtime.ts`
    - Load the latest workflow state, validate the provider-qualified id, write `agentModel`, update `updatedAt`, and save through existing `saveWorkflowState`
    - Return the patched state for immediate resume execution
    - _Requirements: 4.3, 4.4, 5.6, 7.5_
  - [✅]* 2.4 Write workflow state persistence tests
    - Update `tests/unit/workflow/runtime.test.ts` to assert `startWorkflow` persists `agentModel` in `state.json`
    - Test augment run retention of `agentModel`
    - Test legacy patching writes a valid id and rejects invalid ids without advancing phase
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.4, 5.6, 8.6_

- [✅] 3. Phase 3: Integrate model resolution into `/brainstorm-pro`
  - [✅] 3.1 Update start command flow
    - Modify `handleBrainstormProCommand` in `extensions/clarification-orchestrator/commands/brainstorm-pro.ts` to call `resolveWorkflowAgentModel(ctx, { reason: "start" })` before topic proposal
    - Replace the current hard error on missing `ctx.model` with the resolver's current-model-or-picker behavior
    - Pass the selected model object to `proposeWorkflowTopic` and pass the provider-qualified id to `startWorkflow({ cwd, topic, request, agentModel })`
    - Ensure cancellation/no-model errors occur before `startWorkflow` creates files
    - _Requirements: 1.1, 1.3, 1.5, 2.1, 2.2, 2.4, 3.1, 3.2, 7.3_
  - [✅] 3.2 Update resume command flow for persisted and legacy workflows
    - Modify the resume branch in `handleBrainstormProCommand` to inspect the loaded state from `getStatus` or a focused state-loading helper before running agent-backed phases
    - If state has `agentModel`, call `resumeWorkflow` without consulting `ctx.model` or opening the picker
    - If state lacks `agentModel`, call `resolveWorkflowAgentModel(ctx, { reason: "legacy-resume" })`, persist the chosen id through the runtime patching utility, then resume
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.5_
  - [✅] 3.3 Keep status behavior read-only
    - Ensure `/brainstorm-pro --status` still renders status without prompting, patching `agentModel`, mutating workflow files, or launching adapters
    - Ensure missing `agentModel` can be displayed as legacy/missing status without side effects
    - _Requirements: 3.3, 4.2, 4.5_
  - [✅]* 3.4 Write command flow tests
    - Update `tests/unit/commands/brainstorm-pro.test.ts` to cover start with `ctx.model`, start with picker, picker cancellation, no configured models, non-interactive no-model behavior, resume with persisted `agentModel`, legacy resume patching, and status read-only behavior
    - Assert new workflow creation is skipped on cancelled or failed model selection
    - Assert resume uses persisted `agentModel` instead of a different current `ctx.model`
    - _Requirements: 1.1, 1.3, 2.3, 2.4, 2.5, 2.6, 4.1, 4.2, 4.4, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [✅] 4. Phase 4: Make runtime and adapters require explicit models
  - [✅] 4.1 Refactor orchestrator adapter construction
    - Modify `WorkflowRuntimeOrchestrator` in `extensions/clarification-orchestrator/workflow/runtime.ts` so default adapters are built with the active state's `agentModel`, not once in the constructor with `undefined`
    - Add a `createAdaptersForState(state)` or equivalent method that validates `state.agentModel` before calling `defaultWorkflowAdapters`
    - Ensure missing `agentModel` for agent-backed phases produces a clear model-required blocked state or thrown diagnostic before adapter execution
    - _Requirements: 4.5, 5.1, 5.3, 5.6, 7.5_
  - [✅] 4.2 Remove hardcoded adapter defaults
    - Modify `extensions/clarification-orchestrator/workflow/adapters/registry.ts` so `defaultWorkflowAdapters(projectRoot, model, onWorkflowProgress)` requires a non-optional `model` parameter
    - Remove `process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini"` from `defaultWorkflowAdapters`
    - Refactor `defaultAdapterRegistry` to avoid constructing agent-backed adapters with hidden environment or hardcoded model defaults, removing singleton exports where needed
    - _Requirements: 5.2, 5.3, 5.4, 6.1, 6.5_
  - [✅] 4.3 Update adapter factory and singleton usage
    - Inspect `extensions/clarification-orchestrator/workflow/adapters/brainstorming.ts`, `spec-plan.ts`, `design-review.ts`, `plan-review.ts`, and `spec-exec.ts` for default model arguments or singleton exports
    - Remove hidden model defaults and update imports/tests to use factory functions with explicit slash-form test ids
    - Keep `runtime/agent-execution/run-agent.ts` and related launch code enforcing `--model <provider>/<model>` through the existing model policy
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 8.8_
  - [✅] 4.4 Preserve child execution model policy
    - Review `extensions/clarification-orchestrator/runtime/agent-execution/model-policy.ts`, `launch-spec.ts`, and `run-agent.ts` to ensure provider-qualified validation remains fail-closed
    - Update tests and fixtures that still expect colon-form ids to use `openai/gpt-4o-mini` or `openai/test`
    - Do not broaden accepted model formats beyond the approved `<provider>/<model>` policy
    - _Requirements: 5.5, 5.6, 7.4, 8.8_
  - [✅]* 4.5 Write runtime and adapter regression tests
    - Update `tests/unit/workflow/runtime.test.ts` to assert default adapters receive `state.agentModel` and missing `agentModel` fails before agent-backed execution
    - Update adapter tests under `tests/unit/workflow/*adapter*.test.ts` to construct factories with explicit slash-form ids
    - Update security tests that cover adapter boundaries to ensure no hidden default or generic model fallback remains
    - _Requirements: 4.5, 5.1, 5.2, 5.3, 5.4, 5.6, 6.5, 8.5, 8.8_

- [✅] 5. Phase 5: User-facing diagnostics and documentation alignment
  - [✅] 5.1 Standardize resolver error messages
    - In `extensions/clarification-orchestrator/commands/workflow-agent-model.ts`, centralize messages for no configured models, non-interactive missing model, cancelled picker, invalid model id, and failed legacy patching
    - Ensure no-configured-model diagnostics mention `pi --list-models` and `--model provider/model`
    - Ensure cancelled selection says no workflow model was selected and no workflow was started or recorded
    - _Requirements: 2.4, 2.5, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5_
  - [✅] 5.2 Update public docs and workflow docs where model behavior is described
    - Search `README.md`, `extensions/clarification-orchestrator/runtime/agent-execution/README.md`, and docs tests for references to `openai:gpt-4o-mini`, `BRAINSTORMING_PRO_AGENT_MODEL`, or old `/brainstorm-pro` missing-model behavior
    - Update only user-visible command behavior and setup guidance that changed
    - Keep public command names and option behavior aligned with existing docs tests
    - _Requirements: 6.1, 6.5, 7.1, 7.2, 8.9_
  - [✅]* 5.3 Write diagnostics and docs alignment tests
    - Add or update tests in `tests/unit/docs/workflow-runtime.test.ts`, `tests/unit/readme-command-surface.test.ts`, and command tests to assert documented model selection behavior matches implementation
    - Test exact diagnostic substrings for `pi --list-models`, `--model provider/model`, cancellation, and `<provider>/<model>` invalid format
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.7, 8.9_

- [✅]* 6. Checkpoint - Verify workflow agent model selection end to end
  - Run `npm run typecheck`
  - Run focused tests for command, runtime, adapter, and model policy changes: `node --test tests/unit/commands/*.test.ts tests/unit/workflow/runtime.test.ts tests/unit/workflow/*adapter*.test.ts`
  - Run `npm test`
  - Run `npm run validate-package`
  - Inspect `specs/workflow-agent-model-selection/requirements.md` and this `tasks.md` to confirm all referenced requirement IDs exist and that model selection, persistence, resume reuse, hidden-default removal, diagnostics, and validation coverage are represented
  - Stop only if validation fails, requirement references are invalid, hidden defaults remain, colon-form model ids remain in active tests/implementation, or implementation would require changing the approved requirements
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- Each task references one or more requirement IDs for traceability.
- Keep task numbering stable so requirement references stay valid.
- Do not implement per-phase model selection, shell parsing of `pi --list-models`, expanded `PI_COMMAND` behavior, or a generic model management UI as part of this plan.
- Runtime and TUI/status code must remain facade-safe: status rendering is read-only, while model selection and legacy patching stay at the command/runtime boundary described above.
