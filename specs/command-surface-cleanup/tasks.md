# Implementation Plan: Command Surface Cleanup

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The cleanup is organized into four phases: public command and manifest changes, first-run model discovery hardening, documentation/validation alignment, and regression verification. The work is intentionally small and TypeScript-focused: update the pi package manifest, extension registration, first-run config helpers, validation script, README, and targeted Node test files without redesigning workflow state or deleting existing maintenance handler modules.

## Tasks

- [✅] 1. Phase 1: Clean public command and prompt registry surface
  - [✅] 1.1 Remove prompt registry publication from the package manifest
    - Modify `package.json` to remove the `pi.prompts` array while retaining `pi.extensions` and `pi.skills`
    - Keep the `prompts/` directory and all prompt markdown files unchanged as internal resources loaded by code
    - _Requirements: 2.1, 2.2, 2.3_
  - [✅] 1.2 Unregister low-frequency maintenance commands from the extension
    - Modify `extensions/clarification-orchestrator/index.ts` to remove imports of `handleDiffCommand` and `handleCleanCommand`
    - Remove `pi.registerCommand("clarify-diff", ...)` and `pi.registerCommand("clarify-clean", ...)`
    - Keep registrations for `clarify`, `clarify-status`, `spec-plan`, and `spec-exec` routed to their existing handlers
    - Leave `extensions/clarification-orchestrator/commands/diff.ts`, `commands/clean.ts`, `run-diff.ts`, and `retention.ts` in place without public registration
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [✅]* 1.3 Add command registration regression tests
    - Create `tests/unit/extension-registration.test.ts` with an `ExtensionAPI` stub that records names passed to `registerCommand`
    - Assert the registered command names exactly equal `clarify`, `clarify-status`, `spec-plan`, and `spec-exec`
    - Assert `clarify-diff` and `clarify-clean` are absent from the recorded command names
    - _Requirements: 1.5, 6.1_

- [✅] 2. Phase 2: Harden first-run pi model discovery
  - [✅] 2.1 Implement pi command resolution helpers
    - Modify `extensions/clarification-orchestrator/first-run-config.ts` to add `resolvePiCommand(piCommand?: string): string`
    - Resolve commands in order: explicit `piCommand`, `process.env.PI_COMMAND`, safe current-process-derived pi path, then `pi`
    - Add a helper such as `deriveCurrentProcessPiCommand(argv?: string[], execPath?: string): string | undefined` that returns only plausible executable paths and never appends shell arguments
    - Ensure `listPiModels` calls `spawn(resolvePiCommand(piCommand), ["--list-models"], { env: process.env })`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [✅] 2.2 Convert missing executable failures to setup guidance
    - Modify the `child.on("error")` branch in `extensions/clarification-orchestrator/first-run-config.ts`
    - Add `formatMissingPiCommandMessage(command: string): string` with guidance about extension-process `PATH`, interactive shell mismatch, `which pi`, `PI_COMMAND`, restarting pi with a correct `PATH`, and manual config creation
    - Detect `(error as NodeJS.ErrnoException).code === "ENOENT"` and reject with the friendly setup message
    - Preserve non-`ENOENT` error messages with distinct diagnostics including the resolved command and original error message
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [✅] 2.3 Preserve successful and configured first-run behavior
    - Keep `parsePiListModels`, `renderModelChoices`, `writeFirstRunConfig`, and successful `listPiModels` stdout behavior unchanged
    - Confirm `handleClarifyCommand` continues to skip `ensureFirstRunConfig` when `loadConfig` reports user or project config files
    - Do not run first-run setup for `/clarify --dry-run`
    - _Requirements: 4.6, 5.6, 6.5_
  - [✅]* 2.4 Add first-run config unit tests
    - Modify `tests/unit/first-run-config.test.ts` to import and test `listPiModels`, `resolvePiCommand`, and any derived-command helper exported for testability
    - Test explicit `piCommand` by pointing to a temporary executable that returns a provider/model table
    - Test `PI_COMMAND` by temporarily setting `process.env.PI_COMMAND` to a temporary executable path and calling `listPiModels()`
    - Test a missing executable path rejects with the friendly Brainstorming Pro setup message and includes `which pi` plus `PI_COMMAND`
    - Test a non-executable file or directory path produces a non-`ENOENT` diagnostic and is not described as missing from `PATH`
    - _Requirements: 4.1, 4.2, 4.6, 5.1, 5.2, 5.3, 5.5, 6.4_
  - [✅]* 2.5 Extend `/clarify` first-run integration coverage
    - Modify `tests/integration/clarify-first-run.test.ts` to assert project config continues to bypass missing `PI_COMMAND`
    - Add or update a test for missing pi discovery during interactive no-config setup that verifies user-facing notification includes friendly setup guidance
    - Keep existing config writing test with a fake pi executable to verify setup still writes config and proceeds
    - _Requirements: 5.1, 5.2, 5.6, 6.5_

- [✅] 3. Checkpoint - Verify command surface and first-run behavior
  - [✅]* 3.1 Run targeted tests for changed areas
    - Run `npm run test:unit -- tests/unit/extension-registration.test.ts tests/unit/first-run-config.test.ts tests/unit/prompts.test.ts` or the closest supported test command for those files
    - Run `node --test tests/integration/clarify-first-run.test.ts`
    - Inspect failures before continuing to documentation changes
    - _Requirements: 1.5, 2.3, 5.1, 6.1, 6.3, 6.4, 6.5_

- [✅] 4. Phase 3: Align validation and documentation
  - [✅] 4.1 Update package validation for internal prompt resources
    - Modify `scripts/validate-package.ts` to stop requiring `pkg.pi.prompts`
    - Keep the `required` file list entries for `prompts/clarify.md`, `prompts/clarify-v0.md`, `prompts/brainstorming-methodology.md`, `prompts/spec-plan-methodology.md`, `prompts/spec-exec-methodology.md`, `prompts/clarify-review.md`, and `prompts/clarify-refine.md`
    - Keep methodology version checks for `brainstorming-pro-v1`, `spec-plan-pro-v1`, and `spec-exec-pro-v1`
    - _Requirements: 2.4, 2.5, 3.1, 3.2, 6.2_
  - [✅] 4.2 Update README command documentation
    - Modify `README.md` `## Commands` to list public commands `/clarify <request>`, `/clarify --resume`, `/clarify-status <topic>`, `/spec-plan <topic>`, and `/spec-exec <topic>`
    - Move `/clarify <request> --verbose` and `/clarify <request> --dry-run` into an advanced/troubleshooting subsection rather than the core command list
    - Remove `/clarify-diff` and `/clarify-clean` from the public command list or clearly state they are no longer public commands
    - Add a note that `prompts/*.md` are internal package resources loaded by the orchestrator and are not user slash commands
    - _Requirements: 3.3, 3.4, 3.5, 3.6_
  - [✅] 4.3 Document first-run `PI_COMMAND` remediation
    - Modify `README.md` first-run configuration or troubleshooting text to explain that `PI_COMMAND` must be a single executable path, not a shell command with arguments
    - Document the workflow: run `which pi` in a shell where `pi --list-models` works, set `PI_COMMAND` to that absolute path, then restart pi
    - Mention manual creation of `~/.pi/agent/brainstorming-pro/config.json` with provider-qualified model IDs as a fallback
    - _Requirements: 4.5, 5.2, 5.3, 5.4_
  - [✅]* 4.4 Add documentation consistency checks
    - Add assertions to an existing test file or create `tests/unit/readme-command-surface.test.ts` that reads `README.md`
    - Verify README contains the five public command forms and does not list `/clarify-diff` or `/clarify-clean` as public commands
    - Verify README mentions internal prompt resources are not slash commands and documents `PI_COMMAND`
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 6.6_

- [✅] 5. Phase 4: Final validation and cleanup
  - [✅]* 5.1 Run package validation and full tests
    - Run `npm run validate-package`
    - Run `npm run typecheck`
    - Run `npm test`
    - _Requirements: 3.1, 3.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [✅]* 5.2 Review changed command surface manually
    - Inspect `package.json`, `extensions/clarification-orchestrator/index.ts`, `README.md`, and test output for any remaining public `/clarify-diff`, `/clarify-clean`, or `pi.prompts` exposure
    - Confirm prompt files remain loadable through `extensions/clarification-orchestrator/prompts.ts`
    - _Requirements: 1.2, 2.1, 2.3, 3.6_
  - [✅]* 5.3 Summarize implementation results
    - Record completed changes, commands run, and any follow-up issues in the final response or project notes
    - Mention that diff/clean handler files remain present but unregistered unless future work reintroduces them intentionally
    - _Requirements: 1.4, 3.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for a minimal implementation pass, but they capture the expected regression and verification work for a safe cleanup.
- The cleanup should not delete existing `prompts/`, `commands/diff.ts`, `commands/clean.ts`, `run-diff.ts`, `retention.ts`, or historical `specs/*/clarification` artifacts.
- `PI_COMMAND` is intentionally treated as an executable path only; supporting shell snippets or arguments would require a different security and quoting design.
