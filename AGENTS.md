# Repository Guidelines

## Project Structure & Module Organization

This repository is a Pi package for structured requirement clarification workflows. Core TypeScript lives in `extensions/clarification-orchestrator/`, with command handlers in `commands/`, legacy clarification workflow phases in `phases/`, and the durable `/brainstorm-pro` runtime under `workflow/` (`types.ts`, `state-machine.ts`, `runtime.ts`, workflow artifact/event/gate helpers, and `workflow/adapters/*`). Shared modules include `config.ts`, `artifact-store.ts`, `schemas.ts`, `types.ts`, `pi-command.ts`, `pi-doctor.ts`, `topic-validation.ts`, and `topic-proposal-agent.ts`. Agent prompt definitions are in `agents/*.md`; internal prompt resources are in `prompts/*.md`; packaged Pi skills are in `skills/*/SKILL.md`. Tests are grouped by scope under `tests/unit/`, `tests/integration/`, and `tests/security/`, with workflow runtime unit tests in `tests/unit/workflow/`, runtime command tests in `tests/unit/commands/`, documentation alignment tests in `tests/unit/docs/`, and reusable sample data in `tests/fixtures/`. Specs and generated clarification artifacts belong under `specs/<topic>/`.

## Development Phase Guidance

This project is still in active development and does not require backward-compatibility guarantees. When refactoring or redesigning behavior, prioritize the best current implementation over preserving existing structure, APIs, or design choices. It is acceptable to make breaking internal changes when the new approach is demonstrably simpler, safer, more maintainable, or better aligned with the project goals; keep public documentation and tests updated to match the improved design.

## Build, Test, and Development Commands

- `npm run typecheck` — runs `tsc --noEmit` with strict NodeNext TypeScript settings.
- `npm test` — runs the full Node test suite.
- `npm run test:unit` — runs `tests/unit/*.test.ts`.
- `npm run test:integration` — runs workflow and lifecycle integration tests.
- `npm run test:security` — runs security-focused tests such as path traversal and redaction checks.
- `npm run validate-package` — validates package metadata and Pi package registration.

Run `npm run typecheck && npm test && npm run validate-package` before opening a PR.

## Coding Style & Naming Conventions

Use TypeScript ES modules with explicit `.ts` relative imports, matching existing files (for example, `./commands/clarify.ts`). Keep `strict` TypeScript clean: avoid `any` unless justified, model external data with schemas, and prefer small typed helper functions. Use two-space indentation, double quotes for strings, semicolons, and kebab-case filenames such as `first-run-config.ts`. Command names and public CLI options must match the README exactly.

## Testing Guidelines

Tests use Node’s built-in test runner (`node --test`). Name test files `*.test.ts` and place them in the scope that matches behavior: pure modules in `tests/unit`, full command/workflow flows in `tests/integration`, and trust-boundary behavior in `tests/security`. Add fixture files under `tests/fixtures/<scenario>/` when tests need stable artifacts. New commands, lifecycle gates, runtime state-machine transitions, artifact layout changes, config changes, path handling, and prompt/tool policy changes should include tests. Keep README and workflow design docs aligned with public `/brainstorm-pro` command names, state names, gate names, and persisted layout; update `tests/unit/docs/workflow-runtime.test.ts` when those docs intentionally change.

## Commit & Pull Request Guidelines

Recent history uses short imperative or descriptive subjects, sometimes with a prefix such as `bugfix:`; examples include `bugfix: first-run setup` and `Implement provider-qualified subagent models`. Keep commits focused and mention the affected command or module when useful.

PRs should include a concise summary, validation commands run, linked issue/spec if applicable, and screenshots or transcript snippets for user-visible command output changes. Document any changes to artifact layout, configuration paths, security defaults, or public command options in `README.md`.

## Security & Configuration Tips

Treat project-local configuration and agents as untrusted unless explicitly allowed. Preserve path traversal guards, strict clarification-topic validation (English kebab-case only), debug redaction behavior, provider-qualified model validation, and deterministic pi invocation resolution. `/brainstorm-pro` runtime files must stay constrained under `specs/<topic>/` and `.workflow/`; review decisions and approvals must remain bound to exact versioned artifact refs and checksums. `PI_COMMAND` must remain a single executable path override; do not add shell command parsing to normal resolver paths. Do not commit local config files or generated run artifacts unless they are intentional fixtures or docs examples.
