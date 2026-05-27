# Pi List Model Agent Model Design

## Summary

Brainstorming Pro will use `pi --list-models` as the authoritative model discovery source for workflow agent model selection, parse its provider/model table, format the selected row into the CLI model argument form `<provider>/<model>`, and persist that string in workflow state. This fixes over-strict provider validation such as rejecting `Alpha/gpt-5.5`, avoids depending on `~/.pi/agent/models.json` which omits built-in models, and keeps the existing `WorkflowState.agentModel: string` shape to minimize runtime and migration complexity.

## Goals

- Discover selectable workflow agent models from the same model set Pi exposes through `pi --list-models`, including built-in and custom providers.
- Preserve existing durable workflow state shape by continuing to store `agentModel` as a string.
- Treat `<provider>/<model>` as Brainstorming Pro's internal persisted/CLI argument format, not as the literal output shape of `pi --list-models`.
- Remove custom provider-name restrictions; provider names returned by Pi, including uppercase, hyphenated, and non-ASCII names, must remain valid.
- Keep model validation minimal and focused on structural safety before passing `--model` to child Pi processes.
- Provide clear diagnostics when model discovery fails or no parseable models are returned.

## Primary Users / Roles

- Brainstorming Pro users who start or resume `/brainstorm-pro` workflows and need child agent phases to use a valid configured Pi model.
- Maintainers who need deterministic model selection without maintaining a parallel provider naming policy.

## Non-Goals

- Do not change Pi's model configuration format or provider registration behavior.
- Do not replace Pi's model registry or implement a generic model manager UI.
- Do not persist structured `{ provider, id }` objects in workflow state for this change.
- Do not read only `~/.pi/agent/models.json` as the primary source, because it does not include all built-in models.
- Do not validate provider names against Brainstorming Pro-owned naming rules such as lowercase-only regexes.
- Do not add shell command parsing for `PI_COMMAND`; existing safe invocation resolution remains in force.

## Context

Current agent execution validates model strings with a regex that requires the provider segment to start with lowercase ASCII characters. That rejects valid Pi provider names such as `Alpha/gpt-5.5` even though the value is already in the form Pi can accept via `--model`.

Pi's custom model documentation says custom providers live in `~/.pi/agent/models.json`, but that file is not a complete source for all usable models because built-in models are not necessarily represented there. Pi already exposes the complete configured model list through `pi --list-models`. Existing Brainstorming Pro specs also rely on first-run model discovery and guidance around `pi --list-models`, so the smallest correction is to make that command the source for model choices and loosen Brainstorming Pro's own validation.

Relevant modules include:

- `extensions/clarification-orchestrator/runtime/agent-execution/model-policy.ts` for final child-execution model validation.
- Existing first-run/model discovery helpers that spawn Pi with `--list-models`.
- `/brainstorm-pro` command model resolution that persists `WorkflowState.agentModel`.
- `extensions/clarification-orchestrator/workflow/types.ts`, where `agentModel?: string` already exists for workflow state.

## Discovery

### Key Discoveries

- `provider-qualified` should mean the model argument contains a provider segment and model segment separated by `/`; it should not imply Brainstorming Pro owns provider naming rules.
- `pi --list-models` does not return raw `<provider>/<model>` strings. It returns model data as provider/model columns or an equivalent list representation that must be parsed before formatting.
- `~/.pi/agent/models.json` is structured and useful for custom models, but it is incomplete as a discovery source because built-in Pi models are not guaranteed to be stored there.
- Persisting structured model references would be cleaner conceptually, but it expands schema and migration scope. The selected change should keep `agentModel: string` and only format at the discovery boundary.

### Scope Decisions

- Include parsing `pi --list-models` output into provider/model rows and formatting selected rows as `${provider}/${model}`.
- Include relaxing model validation to accept any non-empty provider and model segments separated by `/`, excluding line breaks/control characters.
- Exclude switching workflow state to structured model objects, because preserving `agentModel: string` reduces blast radius.
- Exclude direct primary reads from `~/.pi/agent/models.json`, because it misses built-in models.
- Exclude custom provider case normalization; provider strings returned by Pi must be preserved exactly.

## Proposed Solution

Use `pi --list-models` for interactive model discovery. Parse each returned row into a small internal discovery record:

```ts
type ListedPiModel = {
  provider: string;
  model: string;
  label: string;
};
```

When a user selects a model, format it into the persisted runtime model id:

```ts
function toAgentModelId(entry: ListedPiModel): string {
  return `${entry.provider}/${entry.model}`;
}
```

Continue storing this value in `WorkflowState.agentModel`. When child agents run, pass it unchanged to Pi as:

```bash
pi --model <provider>/<model>
```

Replace the strict provider regex with minimal format validation that trims the value, requires one slash not at either edge, and rejects newline/control characters. Do not reject uppercase, non-ASCII, hyphenated, dotted, or underscored provider names.

### Architecture

1. **Discovery boundary**: executes the resolved Pi invocation with `--list-models`, parses provider/model rows, and returns `ListedPiModel[]`.
2. **Selection boundary**: presents parsed choices to the user and converts the selected row into `<provider>/<model>` via `toAgentModelId()`.
3. **Workflow state**: persists the formatted string in existing `WorkflowState.agentModel`.
4. **Execution boundary**: validates minimal structure and passes the string to child Pi via `--model`.

### Components

- **Pi model discovery parser**
  - Input: stdout from `pi --list-models`.
  - Output: `ListedPiModel[]` with exact provider/model text preserved.
  - Responsibility: support whitespace-aligned table output and provider names containing uppercase letters, hyphens, and non-ASCII characters.

- **Model formatter**
  - Input: `ListedPiModel`.
  - Output: `${provider}/${model}`.
  - Responsibility: centralize the conversion from discovered row to persisted/CLI model argument.

- **Model policy validator**
  - Input: persisted model string.
  - Output: normalized string or model-policy error.
  - Responsibility: reject empty, slash-less, leading-slash, trailing-slash, newline/control-character values only.

- **Workflow model resolver**
  - Input: command context and discovery results.
  - Output: selected `agentModel: string`.
  - Responsibility: use current selected model when available if it can be represented as provider/model; otherwise invoke discovery and picker.

### Data Flow

1. User starts a workflow without an already persisted `agentModel`.
2. Brainstorming Pro resolves the Pi command using existing invocation rules.
3. Brainstorming Pro runs `pi --list-models`.
4. The parser extracts provider/model rows from the output.
5. The UI presents readable labels, preserving exact provider and model values.
6. User selects one row.
7. Brainstorming Pro formats the row as `${provider}/${model}`.
8. The formatted string is minimally validated and stored in `state.json` as `agentModel`.
9. On resume, the persisted `agentModel` is reused without re-discovery or substitution.
10. Agent-backed phases pass the persisted value to child Pi as `--model`.

## Error Handling

- **Pi command cannot be spawned**: preserve existing friendly diagnostic explaining that the extension process cannot run `pi --list-models`, including remediation through `PI_COMMAND` or launching Pi from an environment with the correct `PATH`.
- **`pi --list-models` exits non-zero**: stop before workflow creation or legacy patching and report that Pi model discovery failed, including stderr summary when safe.
- **No parseable model rows**: stop with guidance to verify `pi --list-models` output and Pi model configuration.
- **User cancels selection**: stop without creating or mutating workflow state.
- **Persisted legacy invalid model string**: fail closed before child execution with a clear message that the value must have non-empty provider and model segments separated by `/`.
- **Provider/model contains line breaks or control characters**: reject before persistence or execution to avoid corrupt state or unsafe CLI arguments.

## Testing

- Unit test `model-policy.ts` accepts:
  - `Alpha/gpt-5.5`
  - `openai/gpt-4o`
  - `星辰-gpt-pro/some-model`
  - model ids containing colon, dot, dash, and underscore when no newline/control character is present.
- Unit test `model-policy.ts` rejects:
  - empty string
  - `gpt-5.5`
  - `/gpt-5.5`
  - `Alpha/`
  - strings containing `\n`, `\r`, or other control characters.
- Unit test `pi --list-models` parsing with table output that includes uppercase, hyphenated, and non-ASCII provider names.
- Unit test formatter converts parsed rows into exact `${provider}/${model}` strings without lowercasing or normalization.
- Command tests verify first-run selection persists `agentModel` as a string and resume reuses it without rediscovery.
- Regression test that `Alpha/gpt-5.5` no longer triggers `not provider-qualified` from Brainstorming Pro.

## Open Questions

- Does `pi --list-models` have a stable machine-readable mode available now or planned later? If yes, prefer it over text table parsing when available.
- Should discovery prefer `ctx.modelRegistry.getAvailable()` when running inside Pi and fall back to `pi --list-models`, or should this change standardize entirely on `pi --list-models` for consistency with user-visible behavior?
- Should the minimal validator reject all Unicode control characters or only line breaks? The safer default is all control characters while preserving printable non-ASCII provider names.
