# Command Surface Cleanup Design

## Summary

Brainstorming Pro will simplify its public slash command surface and fix first-run model discovery failures. The package will expose only the core lifecycle commands users need (`/clarify`, `/clarify-status`, `/spec-plan`, `/spec-exec`), stop publishing internal prompt fragments as user commands, and replace raw `spawn pi ENOENT` failures with actionable first-run setup guidance.

## Goals

- Remove the confusing duplicate `/clarify` entry caused by `prompts/clarify.md` being exposed as a pi prompt command.
- Reduce public commands to a focused set: `/clarify`, `/clarify-status`, `/spec-plan`, and `/spec-exec`.
- Keep internal prompt markdown files available to the orchestrator without exposing them as slash commands.
- Make first-run model discovery resilient and user-friendly when the `pi` executable is not on `PATH`.
- Update validation, tests, and README documentation to match the new public command surface.

## Primary Users / Roles

- **Brainstorming Pro users**: want a clear command list and a predictable `/clarify <request>` workflow.
- **Package maintainers**: need internal prompt resources, validation, and tests to remain reliable after removing prompt command publication.
- **First-time users**: need clear setup guidance when Brainstorming Pro cannot auto-discover pi models.

## Non-Goals

- Do not redesign the `/clarify` workflow or artifact schema.
- Do not implement full `/spec-plan` or `/spec-exec` workflows beyond existing lifecycle boundary behavior.
- Do not delete historical clarification artifacts.
- Do not implement a new alias, hidden command, or advanced command framework.
- Do not remove the `clarify-diff` and `clarify-clean` handler files as part of the first cleanup; unregistering them from the public slash command surface is sufficient.

## Context

The package currently declares extension, skill, and prompt resources in `package.json`. Because `pi.prompts` includes `./prompts`, `prompts/clarify.md` appears to users as a `/clarify` prompt command titled `Clarify Workflow Prompt Fragment`, while the extension also registers `/clarify` with the description `Run a structured multi-agent clarification workflow for a complex topic.` This creates two visible `/clarify` commands with different descriptions.

The extension currently registers six commands in `extensions/clarification-orchestrator/index.ts`: `/clarify`, `/clarify-status`, `/clarify-diff`, `/clarify-clean`, `/spec-plan`, and `/spec-exec`. User feedback indicates that the command surface is too large and includes low-frequency maintenance commands.

First-run configuration in `extensions/clarification-orchestrator/first-run-config.ts` runs `pi --list-models` via `spawn(piCommand ?? process.env.PI_COMMAND ?? "pi", ["--list-models"])`. In environments where the package runs inside pi but the `pi` executable is not available on the extension process `PATH`, `/clarify <request>` fails with `Error: pi --list-models failed to start: spawn pi ENOENT`. This can happen even when the user can run `pi --list-models` successfully in an interactive shell, because the extension process may not inherit shell initialization changes from `.bashrc`, `.zshrc`, nvm, npm global bin setup, or a wrapper that makes `pi` available only in that shell session.

## Discovery

### Key Discoveries

- The duplicate `/clarify` is likely caused by the package exposing internal prompt files through `package.json.pi.prompts`; the extension command itself is not duplicated in `index.ts`.
- `prompts/*.md` are used as internal orchestrator resources by `extensions/clarification-orchestrator/prompts.ts`, so they can remain bundled files without being registered as pi prompt commands.
- `/clarify-diff` and `/clarify-clean` are useful but low-frequency maintenance operations. Keeping them public increases cognitive load for typical users.
- The first-run setup only needs `pi --list-models` when no user or project Brainstorming Pro config exists. Existing config should bypass model discovery.

### Scope Decisions

- Keep `/clarify-status` public because it supports recovery, status inspection, and troubleshooting.
- Remove `/clarify-diff` and `/clarify-clean` from public registration, but leave their handlers in the codebase for now to minimize refactor risk.
- Remove `pi.prompts` from `package.json` to prevent internal prompt fragments from appearing as slash commands.
- Update package validation to treat prompts as bundled internal resources, not pi prompt registry resources.
- Improve missing pi CLI handling with actionable setup guidance instead of exposing low-level `ENOENT` details as the primary error.
- Treat `spawn pi ENOENT` as "the extension process cannot find `pi`" rather than "pi is not installed", because users may still be able to run `pi --list-models` from their interactive shell.

## Proposed Solution

Use a small command-surface refactor plus first-run error-handling hardening. The extension remains the only source of user-facing slash commands for Brainstorming Pro. Prompt markdown files remain in the package and continue to be loaded directly by the orchestrator, but they are no longer advertised through the pi prompt registry.

### Architecture

The cleanup affects three layers:

1. **Public command layer**
   - `extensions/clarification-orchestrator/index.ts`
   - Registers only `/clarify`, `/clarify-status`, `/spec-plan`, and `/spec-exec`.

2. **Internal resource layer**
   - `prompts/*.md`
   - Remain package-owned prompt fragments and methodology resources loaded by TypeScript code.
   - Are no longer exposed through `package.json.pi.prompts`.

3. **First-run model discovery layer**
   - `extensions/clarification-orchestrator/first-run-config.ts`
   - Resolves the pi command more carefully and converts missing-executable failures into clear setup guidance.

### Components

- **`package.json`**
  - Remove `pi.prompts` from the pi manifest.
  - Keep `pi.extensions` and `pi.skills`.

- **`extensions/clarification-orchestrator/index.ts`**
  - Keep command registrations for:
    - `clarify`
    - `clarify-status`
    - `spec-plan`
    - `spec-exec`
  - Remove public registrations for:
    - `clarify-diff`
    - `clarify-clean`
  - Remove now-unused imports if applicable.

- **`prompts/*.md`**
  - No content change required for command-surface cleanup.
  - Continue to be loaded by internal prompt loader functions.

- **`scripts/validate-package.ts`**
  - Stop requiring `pkg.pi.prompts`.
  - Continue checking that required internal prompt files exist and include expected methodology versions where applicable.

- **`README.md` and docs**
  - List the public commands as:
    - `/clarify <request>`
    - `/clarify --resume`
    - `/clarify-status <topic>`
    - `/spec-plan <topic>`
    - `/spec-exec <topic>`
  - Move `--verbose` and `--dry-run` to advanced/troubleshooting options.
  - Remove or clearly de-publicize `/clarify-diff` and `/clarify-clean`.
  - Explain that prompt files are internal package resources and are not user slash commands.

- **`extensions/clarification-orchestrator/first-run-config.ts`**
  - Resolve the pi command in this order:
    1. Explicit `piCommand` option.
    2. `process.env.PI_COMMAND`.
    3. A safe current-process-derived command path if available and plausible.
    4. Fallback to `pi`.
  - Treat `PI_COMMAND` as an executable path, not a shell command string with arguments. Users should set it to the absolute path printed by `which pi` in the shell where `pi --list-models` works.
  - On `ENOENT`, throw a friendly error explaining that Brainstorming Pro could not run `pi --list-models` because `pi` was not found in the extension process `PATH`. The message should explicitly note that this can happen even when `pi --list-models` works in the user's interactive shell.
  - Do not convert every spawn failure into a missing-pi message. Only `ENOENT` means the command could not be found. Other spawn errors, such as `EACCES`, should keep distinct diagnostics.
  - Include remediation options:
    - In the shell where `pi --list-models` works, run `which pi`, then set `PI_COMMAND` to that absolute path before starting pi.
    - Restart pi from an environment whose `PATH` includes the pi executable, especially when using nvm/npm global installs.
    - Manually create `~/.pi/agent/brainstorming-pro/config.json` with provider-qualified model IDs.

### Data Flow

Primary `/clarify <request>` flow after cleanup:

1. pi loads the Brainstorming Pro package.
2. The package registers extension commands only; internal prompt files are not registered as prompt commands.
3. The user sees a single `/clarify` command.
4. User invokes `/clarify <request>`.
5. `handleClarifyCommand` parses arguments and loads Brainstorming Pro config.
6. If user/project config exists, the workflow continues without running `pi --list-models`.
7. If no config exists, first-run setup attempts model discovery using the resolved pi command.
8. If model discovery succeeds, the user chooses default/fallback models and config is written.
9. If model discovery cannot start because pi is missing, the user receives actionable setup guidance.
10. Clarification proceeds normally once configuration is available.

## Error Handling

- **Duplicate `/clarify`**: Prevented by removing `package.json.pi.prompts`, so `prompts/clarify.md` is no longer registered as a prompt command.
- **Removed public commands**: `/clarify-diff` and `/clarify-clean` no longer appear in the slash command list. Their handlers may remain in the repo for future reuse or scripted maintenance.
- **Missing pi CLI in extension process**: `ENOENT` from `spawn` is caught and converted to a friendly setup error with concrete remediation steps. The message should avoid implying that pi is not installed globally; it should explain that the extension process could not find `pi`, even if the user's interactive shell can run `pi --list-models`.
- **No discovered models**: Existing behavior remains: if `pi --list-models` runs but no provider-qualified models can be parsed, the user is told to configure pi models first or create config manually.
- **Existing config**: Existing user/project config bypasses first-run discovery and should not attempt to spawn pi.

## Testing

Critical test cases:

- **Command registration**
  - Assert registered public commands are exactly or at least limited to `clarify`, `clarify-status`, `spec-plan`, and `spec-exec` for this extension.
  - Assert `clarify-diff` and `clarify-clean` are not registered publicly.

- **Package validation**
  - Assert package validation passes without `pi.prompts`.
  - Assert required internal prompt files still exist.
  - Assert methodology prompt files still contain expected version markers.

- **Prompt loading**
  - Existing prompt loader tests continue to verify internal prompt files load from disk.
  - Verify removing `pi.prompts` does not affect `loadClarifyV0Prompt` or related prompt assembly.

- **First-run model discovery**
  - Verify explicit `piCommand` or `PI_COMMAND` is used when provided.
  - Verify `PI_COMMAND` is documented and handled as an executable path, not a shell command string with embedded arguments.
  - Verify missing executable failures produce the friendly Brainstorming Pro setup message, including guidance to run `which pi` and set `PI_COMMAND`.
  - Verify the `ENOENT` message explains extension-process `PATH` mismatch rather than claiming pi is uninstalled.
  - Verify non-`ENOENT` spawn errors such as `EACCES` are not reported as missing pi CLI.
  - Verify parse behavior for successful `pi --list-models` output remains unchanged.

- **Documentation consistency**
  - README command section matches the public command surface.

## Open Questions

- Should `/clarify-diff` and `/clarify-clean` later return as a single advanced maintenance command or external script?
- Should first-run setup offer a fully interactive manual model entry fallback when `pi --list-models` cannot run, instead of requiring users to create config manually?
