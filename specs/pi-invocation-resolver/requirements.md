# Requirements Document: Pi Invocation Resolver

## Introduction

Pi Invocation Resolver improves Brainstorming Pro's ability to launch pi subprocesses from extension code without relying on the extension process having the same `PATH` as the user's interactive shell. It introduces a shared, deterministic invocation resolver for first-run model discovery and subagent execution, plus a `/clarify-doctor` troubleshooting command that reports environment and resolver diagnostics.

The system remains bounded to Brainstorming Pro's clarification orchestrator extension. It continues to use the pi CLI as the subprocess boundary and does not call pi internal APIs, does not depend on LLM tool calls during first-run setup, and does not run login-shell probes in the main execution resolver. `PI_COMMAND` remains an advanced single-executable override, while normal npm/nvm/global-install environments should succeed through automatic current-process or local-bin detection.

## Glossary

- **Pi invocation**: A structured description of how to execute pi, including the executable command, any prefix arguments, display text, and source.
- **Resolver**: The deterministic code path that selects a Pi invocation for normal first-run and subagent execution.
- **Current CLI entrypoint**: The current process entry script, usually `process.argv[1]`, when it points to pi's CLI script such as `@mariozechner/pi-coding-agent/dist/cli.js`.
- **Args prefix**: Arguments that must be inserted before normal pi arguments, for example the pi CLI script path when executing `node <cli.js> --list-models`.
- **First-run model discovery**: The setup flow that runs pi model listing, prompts for model choices, and writes `~/.pi/agent/brainstorming-pro/config.json` when no user/project config exists.
- **Subagent execution**: Brainstorming Pro workflow phases that start isolated pi subprocesses with `--print --mode json --no-session`.
- **Doctor report**: A diagnostic report produced by `/clarify-doctor` that summarizes process environment, resolver candidates, active probes, and recommendations.
- **Shell probe**: A diagnostic-only command such as `$SHELL -lc 'command -v pi'` used by doctor to compare interactive shell resolution with extension-process resolution.
- **PI_COMMAND**: Environment variable treated as a single executable path override for launching pi.

## Requirements

### Requirement 1: Shared Pi Invocation Resolution

**User Story:** As a Brainstorming Pro maintainer, I want all pi subprocess callers to use one resolver, so that command lookup behavior is consistent and testable.

#### Acceptance Criteria

1. WHEN Brainstorming Pro needs to launch pi from extension code, THEN the system SHALL use a shared `PiInvocation` structure containing `command`, `argsPrefix`, `displayCommand`, and `source`.
2. WHEN an explicit `piCommand` option is provided, THEN the resolver SHALL select it before any environment or automatic fallback.
3. WHEN no explicit `piCommand` is provided and `PI_COMMAND` is set, THEN the resolver SHALL select `PI_COMMAND` before current-process or path-based detection.
4. WHEN `PI_COMMAND` is selected, THEN the system SHALL treat it as a single executable path and SHALL NOT parse it as a shell command with arguments.
5. WHEN no higher-priority source is available, THEN the resolver SHALL fall back to a bare `pi` command as the final `PATH`-based fallback.
6. WHEN the resolver formats a command for logs or errors, THEN it SHALL include both `command` and any `argsPrefix` values in execution order.

### Requirement 2: Current Process and Local Bin Detection

**User Story:** As a first-time user running pi from an npm/nvm installation, I want Brainstorming Pro to reuse the current pi CLI automatically, so that first-run setup does not fail when the extension process `PATH` is incomplete.

#### Acceptance Criteria

1. WHEN `process.argv[1]` is an absolute path recognized as pi's CLI entrypoint, THEN the resolver SHALL select a current-cli invocation using `process.execPath` as `command` and `[process.argv[1]]` as `argsPrefix`.
2. WHEN `process.argv[1]` is not an absolute recognized pi CLI entrypoint, THEN the resolver SHALL ignore it and continue to lower-priority candidates.
3. WHEN current-cli detection does not apply and a sibling npm bin candidate exists beside `process.execPath`, THEN the resolver SHALL select it before package-local and bare `pi` fallback.
4. WHEN sibling-bin detection does not apply and a package-local `node_modules/.bin/pi` candidate exists in a supported search location, THEN the resolver SHALL select it before bare `pi` fallback.
5. WHEN file existence or executability checks are injected for tests, THEN the resolver SHALL use those injected checks instead of hard-coded filesystem behavior.

### Requirement 3: First-Run Model Discovery Uses Resolver

**User Story:** As a first-time Brainstorming Pro user, I want `/clarify` setup to discover models using the resolved pi invocation, so that setup works without manual `PI_COMMAND` configuration in common environments.

#### Acceptance Criteria

1. WHEN `listPiModels()` runs, THEN it SHALL resolve a `PiInvocation` and spawn `invocation.command` with `invocation.argsPrefix` followed by `--list-models`.
2. WHEN current-cli detection is available and extension `PATH` does not contain `pi`, THEN `listPiModels()` SHALL still be able to run model discovery through `process.execPath process.argv[1] --list-models`.
3. WHEN `pi --list-models` output is returned successfully, THEN existing provider/model parsing behavior SHALL remain unchanged.
4. WHEN no user or project Brainstorming Pro config file exists and `/clarify` is interactive, THEN first-run setup SHALL continue to prompt for default and fallback models after successful discovery.
5. WHEN a user or project Brainstorming Pro config file exists, THEN `/clarify` SHALL continue to bypass first-run model discovery and SHALL NOT spawn pi for setup.
6. WHEN `/clarify --dry-run` is used, THEN first-run setup SHALL continue to be skipped.

### Requirement 4: Subagent Execution Uses Resolver

**User Story:** As a Brainstorming Pro user, I want subagents to launch through the same reliable pi invocation as setup, so that workflows do not fail later with `spawn pi ENOENT`.

#### Acceptance Criteria

1. WHEN `buildPiProcessArgs()` constructs a subagent command, THEN it SHALL use the shared resolver instead of directly computing `params.piCommand ?? process.env.PI_COMMAND ?? "pi"`.
2. WHEN a resolved invocation includes `argsPrefix`, THEN subagent arguments SHALL place that prefix before `--print --mode json --no-session`.
3. WHEN subagent environment variables are built, THEN the system SHALL preserve existing behavior including `BRAINSTORMING_PRO_SUBAGENT=1` and caller-provided environment overrides.
4. WHEN explicit `piCommand` is provided to subagent execution, THEN it SHALL continue to override automatic detection.
5. WHEN subagent process execution returns stdout, stderr, timeout, cancellation, or output-limit states, THEN existing result classification and retry behavior SHALL remain unchanged.

### Requirement 5: Concise Failure Diagnostics

**User Story:** As a user encountering setup failure, I want a concise message showing what Brainstorming Pro tried and where to get more diagnostics, so that I can recover without guessing about PATH issues.

#### Acceptance Criteria

1. WHEN first-run model discovery fails to start because the selected invocation emits `ENOENT`, THEN the error message SHALL identify the selected invocation source and display command.
2. WHEN a selected invocation cannot start for a non-`ENOENT` spawn error, THEN the error message SHALL include the selected display command and the underlying start error message.
3. WHEN model discovery exits with a non-zero code, THEN the system SHALL preserve stdout/stderr details as it does today while including enough command context to identify the invocation.
4. WHEN a first-run startup failure is reported, THEN the message SHALL recommend `/clarify-doctor` for a full report.
5. WHEN fallback remediation mentions `PI_COMMAND`, THEN the message SHALL state that it must be a single executable path and not a shell command with arguments.

### Requirement 6: Clarify Doctor Command

**User Story:** As an advanced user or maintainer, I want `/clarify-doctor` to produce a complete environment report, so that pi can help analyze resolver and PATH problems.

#### Acceptance Criteria

1. WHEN the clarification orchestrator extension loads, THEN it SHALL register a `clarify-doctor` command without re-registering removed `clarify-diff` or `clarify-clean` commands.
2. WHEN `/clarify-doctor` runs, THEN it SHALL report process context including platform, cwd, `process.execPath`, `process.argv0`, `process.argv`, and `process.argv[1]`.
3. WHEN `/clarify-doctor` runs, THEN it SHALL report `PI_COMMAND` status and extension-process `PATH` entries.
4. WHEN `/clarify-doctor` runs, THEN it SHALL report the selected resolver invocation and meaningful deterministic candidates.
5. WHEN active probing is enabled by the doctor implementation, THEN it SHALL run bounded probes with timeouts and report success, failure, timeout, parseable model count, and stderr summaries without failing the whole command on probe failure.
6. WHEN `$SHELL` is available, THEN doctor MAY run `$SHELL -lc 'command -v pi'` as diagnostic-only shell probing and SHALL clearly state that the shell result is not automatically used by the main resolver.
7. WHEN shell probing fails, times out, or produces no path, THEN `/clarify-doctor` SHALL still produce a report with partial diagnostics and recommendations.

### Requirement 7: Documentation and Validation

**User Story:** As a user or maintainer, I want documentation and tests to describe the new automatic resolution and doctor workflow, so that the behavior is discoverable and protected from regressions.

#### Acceptance Criteria

1. WHEN README troubleshooting or configuration guidance is viewed, THEN it SHALL explain that automatic pi invocation resolution is attempted before asking users to set `PI_COMMAND`.
2. WHEN README documents `PI_COMMAND`, THEN it SHALL continue to state that `PI_COMMAND` is a single executable path, not a command string with arguments.
3. WHEN README lists advanced troubleshooting commands, THEN it SHALL include `/clarify-doctor` and describe the report it produces.
4. WHEN unit tests run, THEN they SHALL cover resolver source priority, current-cli detection, sibling/package fallback, bare `pi` fallback, and display formatting.
5. WHEN first-run, runner, and doctor tests run, THEN they SHALL verify the resolver is used consistently by model discovery, subagent argument construction, and diagnostics.
6. WHEN command registration tests run, THEN they SHALL verify `clarify-doctor` is registered and `clarify-diff` and `clarify-clean` remain unregistered.
