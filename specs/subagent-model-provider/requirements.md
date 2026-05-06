# Requirements Document: Subagent Model Provider

## Introduction

Subagent Model Provider hardens Brainstorming Pro subagent execution by requiring all configured subagent models to use pi's provider-qualified `provider/model-id` format and by running child pi processes as one-shot non-interactive commands. This prevents ambiguous bare model names from being resolved through pi's default provider and makes cross-review, design, refinement, and verification phases more deterministic for Brainstorming Pro users and maintainers.

The feature stays within the Brainstorming Pro extension boundary. Pi remains the authority for model discovery and provider registration, while Brainstorming Pro validates configured model strings syntactically, bootstraps first-run configuration from `pi --list-models`, updates `/clarify` startup behavior, and documents the stricter model contract. Because the package has not been released, no legacy bare-model compatibility or migration behavior is required.

## Glossary

- **Brainstorming Pro config**: Configuration loaded from bundled defaults plus user, project, and project-local config files for the clarification orchestrator.
- **Bundled defaults**: Built-in default config in `extensions/clarification-orchestrator/config.ts`; these do not count as user/project configuration for first-run setup.
- **First-run setup**: Interactive `/clarify` startup flow that discovers pi models, prompts for default/fallback choices, and writes `~/.pi/agent/brainstorming-pro/config.json`.
- **Interactive mode**: A command context where `hasUI !== false` and `ctx.ui.input` is available.
- **Non-interactive mode**: A headless/test context or command path without input support.
- **Provider-qualified model**: A configured model string containing a slash that is not the first or last character, such as `openai/gpt-4o-mini`.
- **Subagent**: A child pi process launched by Brainstorming Pro for roles such as designer, reviewer, triager, refiner, or verifier.

## Requirements

### Requirement 1: Provider-Qualified Model Resolution

**User Story:** As a Brainstorming Pro maintainer, I want subagent model selection to reject ambiguous bare model names, so that subagents run with deterministic provider/model routing.

#### Acceptance Criteria

1. WHEN `resolveAgentModel()` builds candidate models from requested model, agent config, agent frontmatter, current model, default model, and fallbacks, THEN the system SHALL validate each non-empty candidate before availability checks or process spawning.
2. WHEN a candidate is provider-qualified with a slash that is not the first or last character, THEN the system SHALL treat it as syntactically valid and pass the trimmed value through unchanged.
3. WHEN a candidate is bare, starts with `/`, ends with `/`, or is otherwise not provider-qualified, THEN the system SHALL reject resolution with a recoverable `model-unavailable` workflow error.
4. WHEN multiple fallback candidates are configured, THEN the system SHALL preserve deterministic fallback order across valid provider-qualified candidates.
5. WHEN a candidate contains additional slashes after the provider qualifier boundary, THEN the system SHALL allow it and defer provider/model semantic validation to pi.
6. WHEN all configured model values are empty, undefined, or whitespace-only, THEN the system SHALL ignore them and allow subagent invocation without an explicit `--model` argument.

### Requirement 2: One-Shot Non-Interactive Subagent Invocation

**User Story:** As a Brainstorming Pro user, I want subagent pi processes to process one prompt and exit, so that cross-review and other phases do not hang in interactive mode.

#### Acceptance Criteria

1. WHEN `buildPiProcessArgs()` constructs subagent CLI arguments, THEN the system SHALL include `--print`, `--mode json`, and `--no-session`.
2. WHEN an actual model is resolved, THEN the system SHALL pass the provider-qualified model through `--model <provider/model-id>`.
3. WHEN no actual model is resolved, THEN the system SHALL omit the `--model` flag while retaining one-shot non-interactive flags.
4. WHEN tool configuration is an empty array, THEN the system SHALL continue emitting `--no-tools`.
5. WHEN tool configuration contains tools, THEN the system SHALL continue emitting `--tools` with the comma-separated tool list.
6. WHEN the child pi process returns JSON event output, THEN existing subagent output parsing and schema validation behavior SHALL remain unchanged.

### Requirement 3: First-Run Model Configuration Bootstrap

**User Story:** As a new Brainstorming Pro user, I want `/clarify` to offer model choices discovered from pi, so that I can configure provider-qualified models without manually typing provider or model IDs.

#### Acceptance Criteria

1. WHEN `/clarify` starts and `loadConfig()` returns `loadedFiles.length === 0`, THEN the system SHALL run first-run setup before normal non-dry-run workflow execution.
2. WHEN any user, project, or project-local Brainstorming Pro config file is loaded, THEN the system SHALL skip first-run setup even if that file does not define model fields.
3. WHEN first-run setup runs in interactive mode, THEN the system SHALL execute `pi --list-models`, parse model choices, prompt for one default model, prompt for optional fallback models, and write `~/.pi/agent/brainstorming-pro/config.json`.
4. WHEN first-run setup writes config successfully, THEN the system SHALL reload Brainstorming Pro config and use the reloaded config for the rest of the `/clarify` command.
5. WHEN `/clarify` has no loaded config file but is non-interactive, THEN the system SHALL stop with a clear setup-required message instructing the user to run `/clarify` interactively once or create config manually.
6. WHEN `/clarify --dry-run` executes, THEN the system SHALL not require interactive first-run setup before producing the dry-run plan.

### Requirement 4: pi Model List Parsing and Selection

**User Story:** As a Brainstorming Pro user with multiple pi providers, I want first-run setup to parse pi's model table robustly, so that provider names with hyphens, mixed case, and non-ASCII characters are selectable.

#### Acceptance Criteria

1. WHEN `pi --list-models` outputs a whitespace-aligned table containing `provider` and `model` headers, THEN the system SHALL parse provider/model rows by header column positions.
2. WHEN provider names include mixed case, hyphens, or non-ASCII characters, THEN the system SHALL preserve provider text exactly as printed by pi.
3. WHEN parsed rows contain missing provider or model values, THEN the system SHALL ignore those rows.
4. WHEN duplicate generated `provider/model-id` values appear, THEN the system SHALL de-duplicate them while preserving first-seen order.
5. WHEN the output contains blank lines, THEN the system SHALL ignore them.
6. WHEN the output has no parseable provider/model rows or the format changes incompatibly, THEN the system SHALL fail safely with no choices and surface setup guidance instead of guessing.
7. WHEN users choose fallback models, THEN the system SHALL de-duplicate selected fallbacks and exclude the selected default model from fallback values.

### Requirement 5: Error Handling and User Guidance

**User Story:** As a Brainstorming Pro user or maintainer, I want clear error messages for model setup and invocation failures, so that I can diagnose configuration problems quickly.

#### Acceptance Criteria

1. WHEN model validation rejects ambiguous candidates, THEN the error SHALL explain the required `provider/model-id` format and list ambiguous candidates.
2. WHEN `pi --list-models` cannot be executed or returns a non-zero exit code, THEN `/clarify` SHALL stop with a warning that pi model discovery failed.
3. WHEN first-run setup discovers no parseable models, THEN `/clarify` SHALL stop and ask the user to configure pi models first.
4. WHEN first-run user input references an invalid default or fallback choice, THEN the system SHALL report an invalid choice error without writing partial config.
5. WHEN existing timeout, retry, output-limit, or schema validation failures occur during subagent execution, THEN their behavior SHALL remain unchanged.

### Requirement 6: Documentation and Verification

**User Story:** As a Brainstorming Pro maintainer, I want documentation and tests updated with the stricter model contract, so that future changes preserve this behavior.

#### Acceptance Criteria

1. WHEN README configuration examples show model settings, THEN they SHALL use provider-qualified values.
2. WHEN README describes first-run behavior, THEN it SHALL explain discovery from `pi --list-models` and the provider-qualified model requirement.
3. WHEN unit tests cover `buildPiProcessArgs()`, THEN they SHALL assert `--print` is present and provider-qualified models are passed unchanged.
4. WHEN unit tests cover `resolveAgentModel()`, THEN they SHALL verify fallback between provider-qualified candidates and rejection of bare names.
5. WHEN unit tests cover first-run parsing, THEN they SHALL include observed provider examples such as `Hotaru-claude`, `Msutools`, `OneXModel`, `星辰-claude-cheap`, and `星辰-gpt-pro`.
6. WHEN command or integration tests cover first-run setup, THEN they SHALL verify config writing when no config exists and setup skipping when `loadedFiles.length > 0`.
7. WHEN implementation is complete, THEN `npm run test:unit` and `npm run typecheck` SHALL pass.
