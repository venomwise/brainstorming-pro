# Repository Guidelines

## Project Structure & Module Organization

This repository is a Pi package for structured requirement clarification workflows. Core TypeScript lives in `extensions/clarification-orchestrator/`, with command handlers in `commands/`, workflow phases in `phases/`, and shared modules such as `config.ts`, `artifact-store.ts`, `schemas.ts`, and `types.ts`. Agent prompt definitions are in `agents/*.md`; internal prompt resources are in `prompts/*.md`; packaged Pi skills are in `skills/*/SKILL.md`. Tests are grouped by scope under `tests/unit/`, `tests/integration/`, and `tests/security/`, with reusable sample data in `tests/fixtures/`. Specs and generated clarification artifacts belong under `specs/<topic>/`.

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

Tests use Node’s built-in test runner (`node --test`). Name test files `*.test.ts` and place them in the scope that matches behavior: pure modules in `tests/unit`, full command/workflow flows in `tests/integration`, and trust-boundary behavior in `tests/security`. Add fixture files under `tests/fixtures/<scenario>/` when tests need stable artifacts. New commands, lifecycle gates, config changes, path handling, and prompt/tool policy changes should include tests.

## Commit & Pull Request Guidelines

Recent history uses short imperative or descriptive subjects, sometimes with a prefix such as `bugfix:`; examples include `bugfix: first-run setup` and `Implement provider-qualified subagent models`. Keep commits focused and mention the affected command or module when useful.

PRs should include a concise summary, validation commands run, linked issue/spec if applicable, and screenshots or transcript snippets for user-visible command output changes. Document any changes to artifact layout, configuration paths, security defaults, or public command options in `README.md`.

## Security & Configuration Tips

Treat project-local configuration and agents as untrusted unless explicitly allowed. Preserve path traversal guards, debug redaction behavior, and provider-qualified model validation. Do not commit local config files or generated run artifacts unless they are intentional fixtures or docs examples.
