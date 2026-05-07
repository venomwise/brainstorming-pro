# Requirements Document: Command Surface Cleanup

## Introduction

Command Surface Cleanup simplifies Brainstorming Pro's user-facing slash commands while preserving the internal orchestration resources needed by the clarification workflow. It removes duplicated and low-frequency public entries so users see a focused lifecycle surface for clarification, status inspection, planning handoff, and execution handoff.

The work is scoped to the Brainstorming Pro package manifest, clarification orchestrator command registration, package validation, documentation, and first-run model discovery diagnostics. It does not redesign the `/clarify` workflow, remove historical artifacts, delete the existing diff/clean handler modules, or implement new lifecycle behavior beyond the existing `/spec-plan` and `/spec-exec` boundary checks.

## Glossary

- **Brainstorming Pro**: The pi package in this repository that provides structured requirement clarification workflows.
- **Slash command surface**: The set of commands registered with pi and shown to users as invokable `/command` entries.
- **Prompt registry**: The `package.json.pi.prompts` manifest field that exposes prompt markdown files as pi prompt commands.
- **Internal prompt resource**: A markdown prompt file loaded directly by Brainstorming Pro TypeScript code and not intended to appear as a user slash command.
- **Clarification Orchestrator**: The extension under `extensions/clarification-orchestrator/` that registers commands and runs workflow handlers.
- **First-run setup**: The interactive configuration path that runs `pi --list-models`, asks the user to select models, and writes `~/.pi/agent/brainstorming-pro/config.json` when no user/project config exists.
- **PI_COMMAND**: Environment variable used by Brainstorming Pro as an executable path for invoking pi during first-run model discovery.
- **ENOENT**: Node.js spawn error code indicating that the requested executable could not be found by the extension process.

## Requirements

### Requirement 1: Focused Public Command Surface

**User Story:** As a Brainstorming Pro user, I want only the core lifecycle commands to appear publicly, so that I can choose the correct command without duplicate or maintenance-oriented distractions.

#### Acceptance Criteria

1. WHEN the clarification orchestrator extension loads, THEN the system SHALL register public commands `clarify`, `clarify-status`, `spec-plan`, and `spec-exec`.
2. WHEN the clarification orchestrator extension loads, THEN the system SHALL NOT register public commands `clarify-diff` or `clarify-clean`.
3. WHEN a user invokes the remaining public commands, THEN the system SHALL route them to the existing `handleClarifyCommand`, `handleStatusCommand`, `handleSpecPlanCommand`, and `handleSpecExecCommand` handlers respectively.
4. WHEN `commands/diff.ts`, `commands/clean.ts`, `run-diff.ts`, or `retention.ts` remain in the repository, THEN their presence SHALL NOT cause `/clarify-diff` or `/clarify-clean` to appear in the public slash command list.
5. IF command registration is inspected in tests with an empty extension API stub, THEN the registered command names SHALL exactly match the focused public command set.

### Requirement 2: Internal Prompt Resources Without Prompt Command Publication

**User Story:** As a Brainstorming Pro maintainer, I want prompt markdown files to remain available to the orchestrator without being published as user commands, so that internal methodology resources do not duplicate `/clarify` or confuse users.

#### Acceptance Criteria

1. WHEN `package.json` is read as a pi package manifest, THEN the `pi` object SHALL include `extensions` and `skills` but SHALL NOT include `prompts`.
2. WHEN `prompts/clarify.md` exists in the repository, THEN it SHALL NOT be exposed via the pi prompt registry as a second `/clarify` command.
3. WHEN `loadClarifyV0Prompt` or related prompt loader functions run, THEN they SHALL continue reading required files from `prompts/` directly from disk.
4. WHEN package validation runs, THEN it SHALL verify required internal prompt files exist even though `package.json.pi.prompts` is absent.
5. IF required internal prompt files are missing or methodology version markers are absent, THEN package validation SHALL fail with an actionable error naming the missing or invalid prompt file.

### Requirement 3: Package Validation and Documentation Consistency

**User Story:** As a package maintainer, I want validation and README content to reflect the cleaned command surface, so that release checks and user documentation match runtime behavior.

#### Acceptance Criteria

1. WHEN `npm run validate-package` runs, THEN it SHALL pass without requiring `package.json.pi.prompts`.
2. WHEN `npm run validate-package` runs, THEN it SHALL continue validating `pi.extensions`, `pi.skills`, bundled agents, bundled defaults, required prompt files, and methodology version markers.
3. WHEN the README command section is viewed, THEN it SHALL list `/clarify <request>`, `/clarify --resume`, `/clarify-status <topic>`, `/spec-plan <topic>`, and `/spec-exec <topic>` as public commands.
4. WHEN advanced or troubleshooting options are documented, THEN `/clarify <request> --verbose` and `/clarify <request> --dry-run` MAY be listed outside the core public command list.
5. WHEN README content describes internal prompts, THEN it SHALL explain that prompt files are package resources and are not user slash commands.
6. IF `/clarify-diff` or `/clarify-clean` are mentioned in README after cleanup, THEN the documentation SHALL clearly state they are not public commands or SHALL remove those mentions.

### Requirement 4: First-Run Pi Command Resolution

**User Story:** As a first-time user, I want Brainstorming Pro to use the most reliable pi executable path for model discovery, so that setup succeeds in more environments.

#### Acceptance Criteria

1. WHEN first-run setup receives an explicit `piCommand` option, THEN `listPiModels` SHALL use that value as the executable before any environment fallback.
2. WHEN no explicit `piCommand` is provided and `process.env.PI_COMMAND` is set, THEN `listPiModels` SHALL use `PI_COMMAND` as the executable.
3. WHEN neither explicit `piCommand` nor `PI_COMMAND` is provided and a safe current-process-derived pi command path is available and plausible, THEN `listPiModels` SHALL use that path before falling back to `pi`.
4. WHEN no explicit, environment, or safe derived command path is available, THEN `listPiModels` SHALL fall back to executable `pi`.
5. WHEN `PI_COMMAND` contains a value, THEN the system SHALL treat it as a single executable path rather than a shell command string with embedded arguments.
6. IF the resolved command exits with code `0`, THEN `listPiModels` SHALL return stdout unchanged for existing parsing behavior.

### Requirement 5: Friendly First-Run Failure Diagnostics

**User Story:** As a first-time user, I want missing pi executable failures to produce actionable setup guidance, so that I can fix environment issues without interpreting raw Node.js spawn errors.

#### Acceptance Criteria

1. WHEN `spawn` emits an `ENOENT` error during `pi --list-models`, THEN `listPiModels` SHALL reject with a friendly Brainstorming Pro setup message instead of primarily surfacing raw `spawn pi ENOENT` text.
2. WHEN the friendly `ENOENT` message is rendered, THEN it SHALL explain that the extension process could not find `pi` on its `PATH` and that this may happen even when `pi --list-models` works in an interactive shell.
3. WHEN the friendly `ENOENT` message is rendered, THEN it SHALL include remediation to run `which pi` in the working shell and set `PI_COMMAND` to that absolute path before starting pi.
4. WHEN the friendly `ENOENT` message is rendered, THEN it SHALL include remediation to restart pi from an environment whose `PATH` includes the pi executable or manually create `~/.pi/agent/brainstorming-pro/config.json` with provider-qualified model IDs.
5. IF `spawn` emits a non-`ENOENT` error such as `EACCES`, THEN `listPiModels` SHALL preserve distinct diagnostics and SHALL NOT report it as a missing pi executable.
6. IF a user or project Brainstorming Pro config already exists, THEN `/clarify` SHALL bypass first-run model discovery and SHALL NOT attempt to spawn pi.

### Requirement 6: Regression Coverage for Cleanup Behavior

**User Story:** As a maintainer, I want deterministic tests around the cleaned command surface and first-run setup behavior, so that future changes do not reintroduce duplicate commands or raw setup failures.

#### Acceptance Criteria

1. WHEN unit tests run, THEN they SHALL cover clarification orchestrator command registration and assert the public command names exclude `clarify-diff` and `clarify-clean`.
2. WHEN package validation tests or scripts run, THEN they SHALL cover operation without `package.json.pi.prompts` while preserving internal prompt checks.
3. WHEN prompt loader tests run, THEN they SHALL verify prompt loading is independent of the pi prompt registry.
4. WHEN first-run config unit tests run, THEN they SHALL cover explicit `piCommand`, `PI_COMMAND`, missing executable `ENOENT`, non-`ENOENT` spawn errors, and unchanged successful parse behavior.
5. WHEN integration tests for `/clarify` first-run setup run, THEN they SHALL verify config writing when no config exists and setup skipping when a user or project config exists.
6. IF documentation or command registration changes in the future, THEN tests or validation SHALL fail when README/public command expectations diverge from the cleaned command surface.
