# Implementation Plan: Pi Invocation Resolver

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md). The work is organized into seven phases: implement the shared resolver, migrate first-run model discovery, migrate subagent command construction, add doctor diagnostics and command registration, update documentation, add/adjust tests, and run final validation. The resolver comes first because both first-run and subagent paths depend on it; doctor is added after the resolver so its report can reuse the same candidate and formatting logic.

The implementation is TypeScript inside `extensions/clarification-orchestrator/` using Node built-ins (`node:path`, `node:fs`, `node:child_process`, `node:os`). The main resolver remains synchronous and deterministic. Active process probes and shell probing live only in doctor code.

## Tasks

- [✅] 1. Phase 1: Add shared Pi invocation resolver
  - [✅] 1.1 Create resolver module and types
    - Create `extensions/clarification-orchestrator/pi-command.ts`
    - Add `PiInvocationSource`, `PiInvocation`, and `PiInvocationResolverOptions` types
    - Add `formatPiInvocationCommand(invocation, args?)` to render `command`, `argsPrefix`, and optional runtime args in execution order
    - _Requirements: 1.1, 1.6_
  - [✅] 1.2 Implement explicit and environment override resolution
    - Implement `resolvePiInvocationSync(options?)` priority for `options.piCommand` before `options.env?.PI_COMMAND ?? process.env.PI_COMMAND`
    - Return `source: "explicit"` for explicit command and `source: "env"` for `PI_COMMAND`
    - Preserve `argsPrefix: []` for both override paths and do not split command strings by whitespace
    - _Requirements: 1.2, 1.3, 1.4_
  - [✅] 1.3 Implement current CLI entrypoint detection
    - Add `deriveCurrentPiCliScript(argv?)` that accepts only absolute `argv[1]` values recognized as pi CLI paths such as `@mariozechner/pi-coding-agent/dist/cli.js` or `pi-coding-agent/dist/cli.js`
    - In `resolvePiInvocationSync`, return `source: "current-cli"`, `command: execPath`, and `argsPrefix: [script]` when detection succeeds
    - Ignore unrecognized or relative `argv[1]` values and continue fallback resolution
    - _Requirements: 2.1, 2.2_
  - [✅] 1.4 Implement deterministic local fallback candidates
    - Add sibling npm bin detection near `path.dirname(execPath)` using injected `fileExists`/`isExecutable` checks when provided
    - Add package-local candidate detection for `node_modules/.bin/pi` from `options.cwd ?? process.cwd()` and any package-root-relative path judged necessary during implementation
    - Return `source: "sibling-bin"` or `source: "package-bin"` before bare `pi`
    - Return final fallback `{ command: "pi", argsPrefix: [], source: "path" }` when no deterministic file candidate applies
    - _Requirements: 1.5, 2.3, 2.4, 2.5_
  - [✅]* 1.5 Add resolver unit tests
    - Create `tests/unit/pi-command.test.ts`
    - Test explicit command priority, `PI_COMMAND` priority, current-cli detection, ignored unrecognized argv, sibling fallback, package fallback, bare `pi` fallback, injected file checks, and display formatting
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 7.4_

- [✅] 2. Phase 2: Migrate first-run model discovery
  - [✅] 2.1 Update first-run imports and compatibility exports
    - Modify `extensions/clarification-orchestrator/first-run-config.ts` to import `resolvePiInvocationSync` and `formatPiInvocationCommand` from `pi-command.ts`
    - Replace or adapt existing `resolvePiCommand` and `deriveCurrentProcessPiCommand` exports so tests and callers use the new invocation model, preserving only compatibility wrappers if needed
    - _Requirements: 1.1, 3.1_
  - [✅] 2.2 Use PiInvocation in `listPiModels`
    - Modify `listPiModels(piCommand?)` to resolve a `PiInvocation`
    - Change spawn to `spawn(invocation.command, [...invocation.argsPrefix, "--list-models"], { env: process.env })`
    - Preserve stdout/stderr collection and successful output behavior
    - _Requirements: 3.1, 3.2, 3.3_
  - [✅] 2.3 Improve first-run startup diagnostics
    - Update the `child.on("error")` branch in `listPiModels` to include selected invocation source and `formatPiInvocationCommand(invocation, ["--list-models"])`
    - Update `formatMissingPiCommandMessage` or replace it with a message that recommends `/clarify-doctor` and keeps `PI_COMMAND` as a fallback single-executable path
    - Ensure non-`ENOENT` start errors include the selected display command and underlying error message
    - _Requirements: 5.1, 5.2, 5.4, 5.5_
  - [✅] 2.4 Preserve first-run bypass behavior
    - Inspect `extensions/clarification-orchestrator/commands/clarify.ts` to ensure user/project config still bypasses `ensureFirstRunConfig`
    - Ensure `/clarify --dry-run` still skips first-run setup
    - Avoid changing model parsing, prompt selection, or config writing behavior
    - _Requirements: 3.3, 3.4, 3.5, 3.6_
  - [✅]* 2.5 Update first-run unit and integration tests
    - Modify `tests/unit/first-run-config.test.ts` to cover fake current-cli invocation using `node fake-pi-cli.js --list-models` with `PATH` not containing pi
    - Update missing executable assertions to expect `/clarify-doctor`, selected invocation context, `which pi`, and `PI_COMMAND` fallback guidance where applicable
    - Modify `tests/integration/clarify-first-run.test.ts` to cover current-cli success and existing-config bypass if current test helpers allow it
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 7.5_

- [✅] 3. Phase 3: Migrate subagent Pi process construction
  - [✅] 3.1 Update runner command construction
    - Modify `extensions/clarification-orchestrator/runner.ts` to import and use `resolvePiInvocationSync`
    - Change `buildPiProcessArgs` to resolve a `PiInvocation` using `params.piCommand`
    - Return `command: invocation.command` and `args: [...invocation.argsPrefix, ...existingPiArgs]`
    - Remove direct fallback logic `params.piCommand ?? process.env.PI_COMMAND ?? "pi"`
    - _Requirements: 4.1, 4.2, 4.4_
  - [✅] 3.2 Preserve subagent environment and result behavior
    - Ensure `buildPiProcessArgs` still merges `process.env`, `params.env`, and `BRAINSTORMING_PRO_SUBAGENT: "1"`
    - Do not change `spawnPiProcess`, timeout handling, cancellation, output limits, parsing, model resolution, or retry classification beyond receiving the new command/args shape
    - _Requirements: 4.3, 4.5_
  - [✅]* 3.3 Update runner unit tests
    - Modify `tests/unit/runner.test.ts` expectations for default command construction to account for resolver behavior
    - Add a test where current-cli detection prepends the CLI script before `--print`
    - Add or update a test proving explicit `piCommand` still overrides automatic detection
    - Verify env merge and `BRAINSTORMING_PRO_SUBAGENT` behavior remains unchanged
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 7.5_

- [✅] 4. Phase 4: Add doctor diagnostics and command
  - [✅] 4.1 Implement doctor report collection
    - Create `extensions/clarification-orchestrator/pi-doctor.ts`
    - Add `collectPiDoctorReport(options?)` to gather platform, cwd, `process.execPath`, `process.argv0`, `process.argv`, `process.argv[1]`, `PI_COMMAND` status, and extension-process `PATH` entries
    - Include selected resolver invocation and meaningful deterministic candidates using `pi-command.ts` helpers
    - _Requirements: 6.2, 6.3, 6.4_
  - [✅] 4.2 Implement bounded active probes
    - In `pi-doctor.ts`, add a helper to spawn selected invocation with `--list-models` using a short timeout
    - Report exit status, timeout status, parseable model count via `parsePiListModels`, and concise stderr/stdout summaries
    - Ensure probe failure, timeout, or spawn error is recorded in the report rather than thrown as the whole doctor failure
    - _Requirements: 6.5, 6.7_
  - [✅] 4.3 Implement diagnostic-only shell probe
    - Add doctor-only `$SHELL -lc 'command -v pi'` probing with a timeout when `$SHELL` is available
    - Clearly mark shell probe output as diagnostic-only and not automatically used by the main resolver
    - Handle missing shell, non-zero exit, empty output, and timeout as report entries
    - _Requirements: 6.6, 6.7_
  - [✅] 4.4 Render human-readable doctor report
    - Add a renderer in `pi-doctor.ts` that produces copyable markdown/plain text with sections for Process, PATH, Resolver, Active Probe, Shell Probe, and Recommendations
    - Include recommendation text for automatic resolver success and for fallback `PI_COMMAND` usage only when needed
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [✅] 4.5 Register `/clarify-doctor`
    - Create `extensions/clarification-orchestrator/commands/doctor.ts` with `handleDoctorCommand(args, ctx)`
    - Modify `extensions/clarification-orchestrator/index.ts` to register `clarify-doctor` with an advanced troubleshooting description
    - Ensure `clarify-diff` and `clarify-clean` remain unregistered
    - _Requirements: 6.1_
  - [✅]* 4.6 Add doctor and registration tests
    - Add `tests/unit/pi-doctor.test.ts` for report process fields, selected invocation, active probe success/failure, shell probe success, and shell probe failure/timeout behavior using injectable probe helpers where needed
    - Update `tests/unit/extension-registration.test.ts` to include `clarify-doctor` and continue excluding `clarify-diff` and `clarify-clean`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 7.6_

- [✅] 5. Checkpoint - Verify resolver migration and doctor behavior
  - Run targeted unit tests for resolver, first-run config, runner, doctor, and command registration
  - Run targeted integration tests for first-run setup if available
  - Inspect error output manually or through tests to confirm `/clarify-doctor` appears in first-run startup failures

- [✅] 6. Phase 5: Update documentation and package validation
  - [✅] 6.1 Update README configuration and troubleshooting docs
    - Modify `README.md` configuration/first-run section to explain automatic pi invocation resolution before manual `PI_COMMAND`
    - Preserve guidance that `PI_COMMAND` must be a single executable path and not a command string with arguments
    - Add `/clarify-doctor` to advanced troubleshooting documentation rather than the core lifecycle command list if possible
    - _Requirements: 7.1, 7.2, 7.3_
  - [✅] 6.2 Update validation if command surface expectations exist
    - Inspect `scripts/validate-package.ts` and package validation tests for hard-coded command expectations
    - Update validation rules or snapshots to allow `clarify-doctor` while keeping `clarify-diff` and `clarify-clean` non-public
    - _Requirements: 6.1, 7.6_
  - [✅]* 6.3 Add documentation validation tests if existing patterns support them
    - Extend README or command-surface tests to assert `/clarify-doctor` appears only as troubleshooting guidance
    - Assert README still documents `PI_COMMAND` as an executable path only
    - _Requirements: 7.1, 7.2, 7.3_

- [✅] 7. Checkpoint - Final validation
  - Run `npm run typecheck`
  - Run `npm run test:unit`
  - Run `npm run test:integration`
  - Run `npm run validate-package`
  - If any command is unavailable in the environment, run the closest targeted `node --test` command and record the limitation

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP, but test tasks are intentionally listed for regression protection.
- The main resolver must stay synchronous and must not execute login shells.
- `/clarify-doctor` may execute shell probes, but their results are diagnostic-only and must not mutate config or process environment.
- `PI_COMMAND` remains a single executable path override; supporting shell snippets would require a separate quoting and security design.
- Keep command surface changes limited to adding `/clarify-doctor`; do not reintroduce `/clarify-diff` or `/clarify-clean`.
