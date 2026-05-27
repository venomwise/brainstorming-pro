# Implementation Plan: Pi List Model Agent Model

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is split into five phases. First, add a focused model discovery/parser module that runs the existing safe Pi invocation with `--list-models` and converts parseable rows into exact provider/model records. Next, update workflow model resolution to use that discovery path and continue persisting `agentModel` as a string. Then relax the child-execution model policy so Brainstorming Pro validates only the minimal `<provider>/<model>` structure and safety boundaries. After integration, update diagnostics and documentation, then run targeted validation. The implementation stays in TypeScript ES modules, reuses existing Pi invocation resolution, and does not change workflow state shape.

## Tasks

- [✅] 1. Phase 1: Add `pi --list-models` discovery and formatting
  - [✅] 1.1 Create the model discovery module
    - Create `extensions/clarification-orchestrator/commands/pi-list-models.ts`
    - Define `ListedPiModel = { provider: string; model: string; label: string }`
    - Export `toAgentModelId(entry: ListedPiModel): string` returning `${entry.provider}/${entry.model}` without normalization
    - Export `formatListedPiModelChoice(entry: ListedPiModel): string` for UI labels containing exact provider and model values
    - _Requirements: 1.5, 2.4, 2.5, 5.1, 5.3_
  - [✅] 1.2 Implement safe `pi --list-models` execution
    - In `extensions/clarification-orchestrator/commands/pi-list-models.ts`, export `listPiModels(options)` that resolves Pi through `resolvePiInvocationSync` from `extensions/clarification-orchestrator/runtime/agent-execution/launch-spec.ts`
    - Spawn `invocation.command` with `[...invocation.argsPrefix, "--list-models"]`, `shell: false`, `env: process.env`, and the workflow project cwd when provided
    - Capture stdout/stderr with a bounded output buffer consistent with existing command test expectations
    - Convert spawn errors and non-zero exit codes into clear discovery failures without mutating workflow state
    - _Requirements: 1.1, 1.6, 7.1_
  - [✅] 1.3 Implement provider/model table parsing
    - Export `parsePiListModelsOutput(stdout: string): ListedPiModel[]`
    - Parse whitespace-aligned output by locating provider and model headers and slicing rows by header column positions where possible
    - Preserve provider text exactly except surrounding table whitespace, including uppercase, hyphenated, dotted, underscored, and printable non-ASCII provider names
    - Preserve model ids exactly except surrounding table whitespace
    - Return an empty array when no provider/model rows can be parsed
    - _Requirements: 1.5, 2.1, 2.2, 2.3, 2.6_
  - [✅]* 1.4 Write unit tests for discovery parsing and formatting
    - Create or update `tests/unit/commands/pi-list-models.test.ts`
    - Test parsing table output with `Alpha`, `Hotaru-claude`, `Msutools`, `OneXModel`, `星辰-claude-cheap`, and `星辰-gpt-pro` providers
    - Test `toAgentModelId()` preserves exact case and non-ASCII provider values
    - Test empty or headerless output returns no parseable rows
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [✅] 2. Phase 2: Route workflow model selection through discovered Pi models
  - [✅] 2.1 Update workflow model resolution imports and data path
    - Modify `extensions/clarification-orchestrator/commands/workflow-agent-model.ts` to use `listPiModels`, `formatListedPiModelChoice`, and `toAgentModelId`
    - Keep `WorkflowAgentModelResolution.agentModel` typed as `ProviderQualifiedModel` and keep `WorkflowState.agentModel` as a string
    - Remove picker dependence on `ctx.modelRegistry.getAvailable()` for required model discovery
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 3.4_
  - [✅] 2.2 Preserve current-session model handling without provider normalization
    - Keep the `ctx.model` fast path when a current Pi session model is available and can be represented as `${ctx.model.provider}/${ctx.model.id}`
    - Validate the formatted string through the relaxed `validateWorkflowAgentModel()` before returning
    - Do not lowercase or rewrite `ctx.model.provider`
    - _Requirements: 2.4, 2.5, 4.2, 4.3_
  - [✅] 2.3 Implement interactive picker from parsed `pi --list-models` rows
    - In `resolveWorkflowAgentModel()`, when `ctx.model` is absent and UI is available, call `listPiModels()`
    - Throw the no-available-model diagnostic when parsed model rows are empty
    - Present `ctx.ui.select()` choices using exact provider/model labels
    - Map the selected label back to the corresponding `ListedPiModel` and persist `toAgentModelId(selected)`
    - _Requirements: 1.1, 2.4, 5.1, 5.2, 5.3_
  - [✅] 2.4 Preserve cancellation and non-interactive behavior
    - Keep `WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE` behavior when `ctx.ui.select()` returns no selection
    - Keep non-interactive failure before workflow creation or legacy mutation when model selection is required
    - Ensure legacy-resume patching still persists only after successful selection and validation
    - _Requirements: 3.2, 5.4, 5.5, 5.6_
  - [✅]* 2.5 Update command model resolution tests
    - Update `tests/unit/commands/workflow-agent-model.test.ts` to mock `listPiModels()` or inject a discovery function without shelling out
    - Test picker selection stores `Alpha/gpt-5.5` exactly as a string
    - Test empty discovery results produce the no-available-model diagnostic
    - Test cancellation does not return a model resolution
    - Test non-interactive mode fails before discovery/picker mutation
    - _Requirements: 1.6, 3.1, 3.2, 5.3, 5.4, 5.5, 5.6_

- [✅] 3. Phase 3: Relax provider-qualified model validation
  - [✅] 3.1 Replace strict provider regex with minimal structural validation
    - Modify `extensions/clarification-orchestrator/runtime/agent-execution/model-policy.ts`
    - Remove `PROVIDER_QUALIFIED_MODEL_PATTERN` or replace it with helper logic that trims input, finds `/`, requires non-empty provider and model segments, and rejects newline/control characters
    - Return the trimmed model string on success
    - _Requirements: 4.1, 4.2, 4.5, 6.2_
  - [✅] 3.2 Update validation diagnostics
    - Adjust the invalid model error message in `model-policy.ts` so it explains that the value must have non-empty provider and model segments separated by `/`
    - Ensure diagnostics do not imply uppercase, mixed-case, hyphenated, or non-ASCII providers are invalid
    - Keep the existing `model-policy-violation` error code
    - _Requirements: 4.6, 7.3_
  - [✅] 3.3 Verify child launch argument behavior remains unchanged
    - Inspect `extensions/clarification-orchestrator/runtime/agent-execution/launch-spec.ts`
    - Ensure `buildAgentLaunchSpec()` still passes `--model` followed by the validated persisted model string
    - Ensure `--no-session`, `--no-skills`, child marker behavior, and safe invocation resolution are not weakened
    - _Requirements: 6.1, 6.4_
  - [✅]* 3.4 Update model policy and launch tests
    - Update `tests/unit/agent-execution-launch.test.ts`
    - Assert `validateProviderQualifiedModel()` accepts `Alpha/gpt-5.5`, `openai/gpt-4o`, `星辰-gpt-pro/some-model`, and model ids containing colon, dot, dash, and underscore
    - Assert it rejects empty strings, bare model ids, leading slash, trailing slash, newline, carriage return, and other control characters
    - Assert a valid mixed-case provider reaches `buildAgentLaunchSpec()` as the exact `--model` argument
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.3_

- [✅] 4. Phase 4: Preserve workflow persistence and resume semantics
  - [✅] 4.1 Audit workflow state writes and legacy patching
    - Inspect `extensions/clarification-orchestrator/workflow/runtime.ts` functions `createInitialWorkflowState()`, `startWorkflow()`, and `persistWorkflowAgentModel()`
    - Ensure they accept and persist the validated model string without changing `WorkflowState.agentModel` to an object
    - Ensure invalid legacy model strings fail before patching state
    - _Requirements: 3.1, 3.2, 3.4, 4.5_
  - [✅] 4.2 Audit resume and status command behavior
    - Inspect `extensions/clarification-orchestrator/commands/brainstorm-pro.ts`
    - Ensure resume with an existing `agentModel` does not run `pi --list-models` or replace the persisted model
    - Ensure `--status` remains read-only and does not run discovery, prompt, or patch `agentModel`
    - _Requirements: 3.3, 3.5_
  - [✅] 4.3 Preserve child execution fail-closed semantics
    - Inspect `extensions/clarification-orchestrator/workflow/runtime.ts` adapter creation paths that validate `state.agentModel`
    - Ensure missing or invalid `agentModel` blocks agent-backed phases before `runAgent()` spawns Pi
    - Ensure valid mixed-case and non-ASCII provider strings are not rejected before adapter construction
    - _Requirements: 6.1, 6.2, 6.3_
  - [✅]* 4.4 Update workflow runtime and command tests
    - Update `tests/unit/workflow/runtime.test.ts` to cover persistence of `Alpha/gpt-5.5` as a string
    - Update `tests/unit/commands/brainstorm-pro.test.ts` to verify resume reuses persisted `agentModel` without discovery and status remains read-only
    - Add a regression test that legacy patching can persist a parsed `pi --list-models` model string exactly
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 6.2, 6.3_

- [✅] 5. Phase 5: Diagnostics and documentation alignment
  - [✅] 5.1 Update user-facing diagnostics
    - Update constants in `extensions/clarification-orchestrator/commands/workflow-agent-model.ts` as needed
    - Ensure no-model and discovery-failure messages mention checking `pi --list-models` output and Pi model configuration
    - Preserve existing guidance for extension process `PATH`, `PI_COMMAND`, and running Pi from an environment where `pi --list-models` works when spawn fails
    - _Requirements: 1.6, 2.6, 7.1, 7.2, 7.3_
  - [✅] 5.2 Update README and workflow documentation
    - Update `README.md` model-selection text to say Brainstorming Pro parses `pi --list-models` rows and formats the selected provider/model as `<provider>/<model>` internally
    - Document that `WorkflowState.agentModel` remains a string and provider values are preserved exactly
    - Remove or revise text that implies provider names must be lowercase or match Brainstorming Pro-owned provider naming rules
    - _Requirements: 7.4, 7.5_
  - [✅]* 5.3 Update docs tests
    - Update `tests/unit/docs/workflow-runtime.test.ts` or related docs tests to match the revised README wording
    - Ensure docs tests still cover model discovery guidance and durable `agentModel` behavior
    - _Requirements: 7.4, 7.5_

- [✅] 6. Checkpoint - Verify model discovery, validation, and persistence behavior
  - Run `npm run typecheck`
  - Run `npm run test:unit`
  - Run targeted tests for `tests/unit/commands/pi-list-models.test.ts`, `tests/unit/commands/workflow-agent-model.test.ts`, `tests/unit/agent-execution-launch.test.ts`, `tests/unit/workflow/runtime.test.ts`, and `tests/unit/commands/brainstorm-pro.test.ts`
  - Inspect `specs/pi-list-model-agent-model/requirements.md` and confirm Requirements 1.1-7.5 are covered by implementation or explicit diagnostics
  - Stop if model discovery still depends primarily on `~/.pi/agent/models.json`, provider values are lowercased/normalized, `agentModel` is changed away from a string, or `Alpha/gpt-5.5` remains rejected by Brainstorming Pro validation

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP, but test and documentation tasks should be completed before release.
- Keep `WorkflowState.agentModel` as a string throughout this spec.
- Treat `pi --list-models` as the discovery source and `<provider>/<model>` as Brainstorming Pro's persisted/CLI argument format.
