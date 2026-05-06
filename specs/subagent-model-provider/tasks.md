# Implementation Plan: Subagent Model Provider

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is split into five phases: harden subagent model resolution and process arguments, complete first-run model discovery/configuration, integrate first-run setup into `/clarify`, update documentation, and verify the behavior. The execution order starts with pure runner/config helpers because they are the safest unit-testable foundation, then adds first-run parsing and command startup wiring, and ends with README and verification. The implementation uses the existing TypeScript extension modules under `extensions/clarification-orchestrator`, Node's built-in test runner, and existing config/workflow types.

## Tasks

- [✅] 1. Phase 1: Harden subagent model resolution and CLI args
  - [✅] 1.1 Update model qualification helpers in `extensions/clarification-orchestrator/runner.ts`
    - Ensure `isProviderQualifiedModel(model: string)` validates trimmed provider-qualified strings by requiring a slash that is not first or last.
    - Add or update a helper such as `normalizeModelCandidate(model: string)` so configured model values are trimmed before validation and invocation.
    - Keep additional slashes after the first qualifier slash valid and pass them through unchanged.
    - _Requirements: 1.1, 1.2, 1.3, 1.5_
  - [✅] 1.2 Apply validation and normalization in `resolveAgentModel()`
    - Build candidates from requested model, agent config, agent frontmatter, current model, config default, and fallback models.
    - Drop empty, undefined, and whitespace-only values from the candidate list.
    - Reject invalid non-empty candidates with a recoverable `model-unavailable` `WorkflowError` that lists ambiguous candidates and required format.
    - Preserve first-seen fallback order after normalization and de-duplication.
    - _Requirements: 1.1, 1.3, 1.4, 1.6, 5.1_
  - [✅] 1.3 Update `buildPiProcessArgs()` in `extensions/clarification-orchestrator/runner.ts`
    - Ensure args start with `--print --mode json --no-session`.
    - Pass the normalized provider-qualified model through `--model` when present.
    - Continue omitting `--model` when no actual model is resolved.
    - Preserve existing `--no-tools`, `--tools`, prompt, environment, and pi command behavior.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [✅]* 1.4 Update runner unit tests in `tests/unit/runner.test.ts`
    - Update model fixtures to provider-qualified values.
    - Add tests for trimming, bare model rejection, leading slash rejection, trailing slash rejection, additional slash passthrough, empty value ignoring, and deterministic fallback order.
    - Assert `buildPiProcessArgs()` includes `--print` and preserves tool argument behavior.
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 6.3, 6.4_

- [✅] 2. Checkpoint - Verify runner behavior
  - [✅]* 2.1 Run focused runner validation
    - Run `npm run test:unit -- tests/unit/runner.test.ts` if the script accepts file arguments, or run `node --test tests/unit/runner.test.ts` directly.
    - Fix any regressions in model resolution, process args, output parsing, retries, or existing timeout/output-limit behavior.
    - _Requirements: 2.6, 5.5, 6.3, 6.4_

- [✅] 3. Phase 2: Complete first-run model discovery and config writing
  - [✅] 3.1 Update `parsePiListModels()` in `extensions/clarification-orchestrator/first-run-config.ts`
    - Parse the `provider`, `model`, and next column boundaries from the header line.
    - Ignore blank lines and rows with missing provider or model values.
    - Preserve provider text exactly, including mixed case, hyphens, and non-ASCII characters.
    - De-duplicate generated IDs while preserving first-seen order.
    - Return an empty list when the header or parseable rows are missing.
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [✅] 3.2 Update selection and config writing in `extensions/clarification-orchestrator/first-run-config.ts`
    - Ensure `ensureFirstRunConfig()` requires interactive input support before prompting.
    - Prompt for default model and optional comma-separated fallback numbers from parsed choices.
    - Exclude the selected default model from fallback values and de-duplicate fallback selections.
    - Write only `version` and `models` to `~/.pi/agent/brainstorming-pro/config.json` using `writeFirstRunConfig()`.
    - Avoid writing config when default or fallback selection is invalid.
    - _Requirements: 3.3, 4.7, 5.4_
  - [✅] 3.3 Harden `listPiModels()` error handling in `extensions/clarification-orchestrator/first-run-config.ts`
    - Spawn `pi --list-models` using the configured pi command or `PI_COMMAND` fallback.
    - Resolve stdout only on zero exit code.
    - Reject with an actionable error on spawn failure or non-zero exit code, including trimmed stderr/stdout context when available.
    - _Requirements: 3.3, 5.2_
  - [✅]* 3.4 Add first-run unit tests
    - Create or update `tests/unit/first-run-config.test.ts` for table parsing, non-ASCII providers, duplicate IDs, missing headers, empty outputs, invalid choices, fallback de-duplication, and default exclusion.
    - Include provider examples `Hotaru-claude`, `Msutools`, `OneXModel`, `星辰-claude-cheap`, and `星辰-gpt-pro`.
    - Verify `writeFirstRunConfig()` writes the expected JSON shape to a temporary path.
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 5.3, 5.4, 6.5_

- [✅] 4. Checkpoint - Verify first-run module
  - [✅]* 4.1 Run focused first-run tests
    - Run `node --test tests/unit/first-run-config.test.ts`.
    - Fix parser, selection, or config writing regressions before command integration.
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 5.3, 5.4, 6.5_

- [✅] 5. Phase 3: Integrate first-run setup into `/clarify`
  - [✅] 5.1 Modify startup config handling in `extensions/clarification-orchestrator/commands/clarify.ts`
    - Import `ensureFirstRunConfig()` from `../first-run-config.ts`.
    - After initial `loadConfig(cwd, options)`, detect whether `loadedFiles.length === 0`.
    - Treat interactive mode as `hasUI !== false` and `(ctx.ui as any).input` availability for first-run setup.
    - Run setup before normal non-dry-run workflow execution when no config file was loaded and interactive input exists.
    - Reload config after successful setup and use the reloaded config for resume, security confirmation, topic confirmation, dry-run plan, and workflow execution as appropriate.
    - _Requirements: 3.1, 3.3, 3.4_
  - [✅] 5.2 Handle non-interactive and dry-run startup boundaries in `extensions/clarification-orchestrator/commands/clarify.ts`
    - When no config file was loaded and command execution is non-interactive, throw a clear setup-required error before subagent phases can run.
    - Ensure `/clarify --dry-run` does not require interactive first-run setup before writing the dry-run plan.
    - Preserve the existing non-interactive `/clarify` restriction for real workflows and existing security-sensitive config confirmation behavior.
    - _Requirements: 3.5, 3.6, 5.2, 5.3_
  - [✅] 5.3 Preserve loaded-config skip semantics in `extensions/clarification-orchestrator/commands/clarify.ts`
    - Ensure any loaded user, project, or project-local config file skips first-run setup, even if model fields are absent.
    - Ensure bundled defaults alone do not skip first-run setup for real interactive `/clarify` runs.
    - _Requirements: 3.1, 3.2_
  - [✅]* 5.4 Add command/integration tests for `/clarify` first-run behavior
    - Add or update tests under `tests/integration/workflow.test.ts` or a new command-level test file to mock `ctx.ui.input`, `ctx.ui.notify`, and `listModels`/pi command behavior.
    - Verify config is written when no config exists and interactive input is available.
    - Verify config reload is used after setup.
    - Verify setup is skipped when `loadedFiles.length > 0`.
    - Verify non-interactive no-config execution reports setup-required guidance.
    - Verify `--dry-run` can produce a dry-run plan without first-run setup.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.2, 5.3, 6.6_

- [✅] 6. Checkpoint - Verify command integration
  - [✅]* 6.1 Run focused command and integration tests
    - Run the updated command/integration tests that cover `/clarify` startup behavior.
    - Run `npm run test:unit` to catch unit-level regressions across runner, config, and first-run modules.
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 6.6, 6.7_

- [✅] 7. Phase 4: Update documentation
  - [✅] 7.1 Update model configuration examples in `README.md`
    - Replace bare example values such as `sonnet` and `gpt-4o` with provider-qualified examples.
    - Explain that configured subagent models must use `provider/model-id` and that pi owns provider/model discovery.
    - Mention that Brainstorming Pro does not support a separate provider field.
    - _Requirements: 6.1, 6.2_
  - [✅] 7.2 Document first-run model selection in `README.md`
    - Describe that first interactive `/clarify` with no Brainstorming Pro config calls `pi --list-models`.
    - Describe default and fallback selection behavior and the generated config path.
    - Document non-interactive setup guidance for users who need to create config manually.
    - _Requirements: 3.3, 3.5, 6.2_
  - [✅]* 7.3 Review docs for consistency with `specs/subagent-model-provider/design.md`
    - Ensure README terminology matches provider-qualified model, first-run setup, and pi model discovery terms from the design.
    - Ensure no documentation implies manual provider/model typing during first-run setup.
    - _Requirements: 6.1, 6.2_

- [✅] 8. Checkpoint - Final verification
  - [✅]* 8.1 Run full required verification
    - Run `npm run test:unit`.
    - Run `npm run typecheck`.
    - Investigate and fix failures related to model validation, first-run setup, command startup, or TypeScript typing.
    - _Requirements: 5.5, 6.7_
  - [✅]* 8.2 Summarize implementation readiness
    - Confirm `requirements.md`, `tasks.md`, and `design.md` remain aligned.
    - Note any deliberate deviations or unresolved implementation risks before execution begins.
    - _Requirements: 6.7_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP, but test and verification tasks should be completed before considering the implementation ready.
- This project intentionally does not include legacy bare-model compatibility or migration because Brainstorming Pro has not been released.
- Pi remains the authority for provider/model existence; Brainstorming Pro performs only local syntactic validation before invoking pi.
