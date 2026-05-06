# Subagent Model Provider Design

## Summary

Fix Brainstorming Pro subagent invocation so cross-review and other subagent phases run pi in reliable non-interactive mode and reject ambiguous model configuration. The change requires configured subagent models to use pi's provider-qualified `provider/model-id` form, preventing accidental resolution against the default provider. On first use, Brainstorming Pro bootstraps its model config by listing models from pi itself and letting the user choose from that list.

## Goals

- Ensure subagent pi processes run as one-shot non-interactive commands.
- Prevent ambiguous bare model names such as `gpt-4o` or `sonnet` in Brainstorming Pro config.
- Preserve deterministic fallback behavior across configured provider-qualified models.
- Avoid duplicate manual provider/model entry by reusing `pi --list-models` as the model source.
- Bootstrap Brainstorming Pro config on first interactive `/clarify` when no Brainstorming Pro config file is loaded.
- Update tests and documentation to reflect the stricter model format and first-run setup.

## Primary Users / Roles

- Brainstorming Pro users configuring reviewer/designer/refiner/verifier models.
- Maintainers debugging `/clarify` cross-review subagent execution.

## Non-Goals

- Add a separate `provider` field to Brainstorming Pro config.
- Ask users to manually type provider or model IDs during first-run setup.
- Parse `~/.pi/agent/models.json` directly; pi remains the authority for model discovery.
- Implement custom provider registration; pi continues to own provider/model discovery.
- Change reviewer selection, concurrency, or artifact formats.
- Change skill loading or lifecycle command behavior.

## Context

Current subagent execution builds CLI args in `extensions/clarification-orchestrator/runner.ts` as:

```bash
pi --mode json --no-session --model <model> [--tools ...] <prompt>
```

Pi supports `--provider <name>` and also supports provider-qualified `--model provider/model-id`. Because Brainstorming Pro only stores model strings, the safest deterministic contract is to require provider-qualified model strings. The current invocation also omits `--print`, even though subagents are intended to process one prompt and exit.

## Discovery

### Key Discoveries

- Pi CLI supports `--model provider/model-id`.
- Pi CLI supports `--print` for non-interactive one-shot execution.
- Pi CLI supports `pi --list-models`, whose output is a whitespace-aligned table with `provider` and `model` columns.
- Current observed `pi --list-models` output includes provider names with mixed case, hyphens, and non-ASCII characters such as `星辰-gpt-pro`.
- Current Brainstorming Pro schema has only `model?: string`, `models.default?: string`, and `models.fallback: string[]`; no provider field exists.
- Bare model names can be ambiguous or route through pi's default provider.

### Scope Decisions

- Use strict provider-qualified model validation instead of adding a provider field.
- Discover first-run choices from `pi --list-models` instead of asking users to enter model strings.
- Parse the `pi --list-models` table by header/column positions rather than ASCII-only token assumptions, so provider names like `星辰-claude-cheap` are supported.
- Validate all resolved model candidates before invoking pi so failures are explicit and early.
- Keep validation local to Brainstorming Pro's runner/config path rather than changing pi itself.
- Because Brainstorming Pro has not been released and has no existing users, no legacy bare-model compatibility or migration path is required.

## Proposed Solution

Require every configured model string used for subagents to include a provider prefix in the form `provider/model-id`. Add `--print` to subagent pi CLI args. When no Brainstorming Pro config file exists, run an interactive first-run bootstrap that calls `pi --list-models`, parses the provider/model table, lets the user choose default and fallback models, writes `~/.pi/agent/brainstorming-pro/config.json`, reloads config, and then continues. Update README examples and unit tests.

### Architecture

The change stays inside the existing runner/config boundary plus a first-run bootstrap step in `/clarify` startup:

- Config loading continues to parse model strings.
- `/clarify` checks `loadConfig()`'s `loadedFiles` result. Bundled defaults do not count as loaded user/project configuration.
- First-run setup runs only when `loadedFiles.length === 0`. If any user, project, or project-local Brainstorming Pro config file is loaded, setup is skipped even if that file does not define model fields.
- Interactive mode means the command context is input-capable: `hasUI !== false` and `ctx.ui.input` is available. Non-interactive mode includes headless/test contexts and any command path without input support.
- If no config file was loaded and UI is interactive, Brainstorming Pro runs `pi --list-models` and asks the user to choose from discovered provider/model pairs.
- If no config file was loaded and UI is non-interactive, `/clarify` stops with a clear setup-required message.
- `resolveAgentModel()` continues choosing requested/default/fallback candidates.
- Before availability resolution or process spawning, model strings are validated for provider qualification.
- `buildPiProcessArgs()` emits `--print --mode json --no-session` and passes the qualified model through `--model`.

### Components

- `runner.ts`
  - Add model qualification validation helper.
  - Apply validation to requested/default/fallback candidates in `resolveAgentModel()`.
  - Add `--print` to `buildPiProcessArgs()`.
- `extensions/clarification-orchestrator/first-run-config.ts`
  - Spawn `pi --list-models`.
  - Parse the table into `{ provider, model, id: `${provider}/${model}` }` records.
  - Prompt the user to select `models.default` and optional `models.fallback` values.
  - Write `~/.pi/agent/brainstorming-pro/config.json`.
- `extensions/clarification-orchestrator/commands/clarify.ts`
  - Detect `loadedFiles.length === 0` after startup config loading and before normal workflow starts.
  - Run first-run setup only when the command context has interactive input support.
  - Reload config after setup and use the reloaded config for the rest of the command.
- `tests/unit/runner.test.ts`
  - Update fixture models to provider-qualified values.
  - Assert `--print` appears in generated args.
  - Add a test rejecting bare model names.
- First-run tests
  - Parse the observed `pi --list-models` table, including non-ASCII provider names.
  - Verify missing/empty model list stops setup.
  - Verify generated config is written once and skipped when existing config files are loaded.
- `README.md`
  - Update configuration example to use `provider/model-id`.
  - Document first-run model selection from `pi --list-models` and the provider-qualified model requirement.

### Data Flow

1. User runs `/clarify`.
2. Brainstorming Pro loads config from the existing config chain.
3. If at least one Brainstorming Pro config file was loaded, continue without asking setup questions.
4. If no Brainstorming Pro config file was loaded:
   - Interactive mode (`hasUI !== false` and `ctx.ui.input` exists): call `pi --list-models`, parse model choices, prompt for default/fallback selection, write user config, and reload config.
   - Non-interactive mode: stop and instruct the user to run `/clarify` interactively once or create config manually.
5. A subagent phase calls `runSubagent()`.
6. `resolveAgentModel()` gathers candidate models from requested model, agent config, agent frontmatter, current model, default model, and fallbacks.
7. Each non-empty candidate must be provider-qualified before availability checks run.
8. The first available valid candidate becomes `actualModel`.
9. `buildPiProcessArgs()` creates:

```bash
pi --print --mode json --no-session --model provider/model-id [--tools ...] <prompt>
```

10. The child pi process returns JSON output for schema validation.

### Model qualification validation

Validation is intentionally syntactic and local to Brainstorming Pro; pi remains responsible for knowing which providers and model IDs actually exist.

- Trim configured model strings before validation and invocation.
- A valid configured model must contain a slash that is not the first or last character.
- Empty, undefined, or whitespace-only values are ignored when building the candidate list.
- Bare names such as `sonnet` and `gpt-4o` are rejected.
- Leading slash values such as `/gpt-4o` and trailing slash values such as `openai/` are rejected.
- Additional slashes inside the model ID are allowed and passed through unchanged, because pi owns provider/model syntax beyond the provider qualifier boundary.
- Apply validation to requested model, agent config model, agent frontmatter model, current model, default model, and fallback models after model resolution has built the non-empty candidate list.

### `pi --list-models` parsing

Observed output:

```text
provider         model              context  max-out  thinking  images
 Hotaru-claude    claude-opus-4-7    1M       128K     yes       yes
 星辰-gpt-pro       gpt-5.5            1M       128K     yes       yes
```

Parsing rules:

- Assume `pi --list-models` prints plain text without ANSI styling and preserves whitespace padding in stdout.
- Ignore blank lines.
- Find the header line containing at least `provider` and `model`.
- Determine the start index of the `provider`, `model`, and next column (`context`) from the header.
- For each subsequent row:
  - `provider = row.slice(providerStart, modelStart).trim()`
  - `model = row.slice(modelStart, nextColumnStart).trim()`
  - Ignore rows with missing provider or model.
  - Create model ID `${provider}/${model}`.
- Do not restrict provider names to ASCII. Preserve provider text exactly as printed by pi.
- De-duplicate generated IDs while preserving order.
- If pi changes the output format, parsing should fail safely by producing no choices and surfacing setup instructions rather than guessing.

## Error Handling

- Bare model strings fail with a clear `model-unavailable`/configuration-style error explaining the required `provider/model-id` format and listing the ambiguous candidates.
- If first-run setup cannot execute `pi --list-models`, `/clarify` stops with a warning that pi model discovery failed.
- If `pi --list-models` returns no parseable provider/model rows, `/clarify` stops and asks the user to configure pi models first.
- Empty or undefined model values remain allowed only when no model is configured, but first-run setup is intended to create explicit provider-qualified defaults before subagents run.
- Existing timeout, retry, output limit, and validation errors remain unchanged.

## Testing

- Unit test `buildPiProcessArgs` includes `--print` and passes provider-qualified models unchanged.
- Unit test `resolveAgentModel` falls back between provider-qualified candidates.
- Unit test bare model rejection.
- Unit test `pi --list-models` parsing with the observed output, including `Hotaru-claude`, `Msutools`, `OneXModel`, `星辰-claude-cheap`, and `星辰-gpt-pro`.
- Integration or command test first-run setup writes `~/.pi/agent/brainstorming-pro/config.json` when no config exists.
- Test setup is skipped when `loadedFiles.length > 0`.
- Run `npm run test:unit` and `npm run typecheck`.

## Open Questions

None.
