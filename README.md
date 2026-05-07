# Brainstorming Pro

Brainstorming Pro is a pi package for structured, recoverable requirement clarification. It provides request-first slash commands that create durable clarification artifacts under `specs/<topic>/clarification/run-*`, keep the latest approved or in-review design at `specs/<topic>/design.md`, and hand off explicitly to planning and execution commands.

## Lifecycle

Brainstorming Pro uses explicit user gates between lifecycle stages:

```text
/clarify <request> -> /spec-plan <topic> -> /spec-exec <topic>
```

- `/clarify` turns a natural-language request into an approved `design.md`.
- `/spec-plan` validates approved design context before planning produces `requirements.md` and `tasks.md`.
- `/spec-exec` refuses to run until approved planning artifacts exist.

`/clarify` never auto-runs `/spec-plan`; final approval prints the next command for the user to run.

## Commands

Public commands:

- `/clarify <request>` — start a request-first clarification workflow. The system proposes safe topic candidates and asks you to confirm before creating artifacts.
- `/clarify --resume` — resume a pending clarification run. If multiple resumable runs exist, choose one interactively.
- `/clarify-status <topic>` — show run metadata, resume status, latest version, artifacts, pending decisions, errors, and resume hint.
- `/spec-plan <topic>` — lifecycle boundary command for planning from an approved design.
- `/spec-exec <topic>` — lifecycle boundary command for execution from approved `requirements.md` and `tasks.md`.

Advanced and troubleshooting options:

- `/clarify <request> --verbose` — preserve the request and emit phase/activity logging.
- `/clarify <request> --dry-run` — validate input and write planned debug artifacts without launching subagents or bypassing gates.
- `/clarify-doctor` — produce an advanced pi invocation, PATH, active probe, and diagnostic-only shell probe report for troubleshooting first-run or subagent launch issues.

`/clarify-diff` and `/clarify-clean` are no longer public commands; their maintenance handler files remain internal and are not registered as slash commands.

The markdown files under `prompts/*.md` are internal package resources loaded by the Brainstorming Pro orchestrator. They are not user slash commands and are not published through the pi prompt registry.

Public `/clarify` options are only `--resume`, `--verbose`, and `--dry-run`. Removed options such as `--mode`, `--threshold`, `--max-rounds`, and `--reviewers` are rejected for `/clarify`; reviewer defaults belong in package/user/project configuration.

## Configuration

Configuration is loaded in this order:

1. Bundled defaults.
2. `~/.pi/agent/brainstorming-pro/config.json`.
3. `<project>/.pi/brainstorming-pro/config.json`.
4. `<project>/.pi/brainstorming-pro/config.local.json`.

Example:

```json
{
  "version": 1,
  "reviewers": {
    "enabled": ["product", "architecture", "risk", "testing"],
    "disabled": [],
    "custom": [],
    "concurrency": 2
  },
  "models": {
    "default": "anthropic/claude-sonnet-4",
    "fallback": ["openai/gpt-4o-mini"]
  },
  "security": {
    "allowProjectAgents": false,
    "allowProjectToolExpansion": false,
    "debugArtifacts": "redacted"
  }
}
```

Subagent models must use pi's provider-qualified `provider/model-id` form, such as `anthropic/claude-sonnet-4` or `openai/gpt-4o-mini`. Bare model names such as `sonnet` or `gpt-4o` are rejected because pi could resolve them through an unintended default provider. Brainstorming Pro stores model strings only; it does not support a separate `provider` field, and pi remains the authority for provider/model discovery.

On the first interactive `/clarify` run, if no Brainstorming Pro config file is loaded from the user or project config paths above, Brainstorming Pro resolves a pi invocation automatically, runs `pi --list-models` (or the equivalent resolved invocation), displays the discovered provider/model choices, asks for one default model and optional fallback models, then writes `~/.pi/agent/brainstorming-pro/config.json`. The automatic resolver tries explicit options, `PI_COMMAND`, the current pi CLI entrypoint, nearby npm bin candidates, package-local `node_modules/.bin/pi`, and finally bare `pi` from the extension process `PATH`. Non-interactive first use stops with setup guidance; run `/clarify` interactively once or create the config file manually using provider-qualified model IDs from `pi --list-models`.

If first-run model discovery cannot find `pi` after automatic resolution, run `/clarify-doctor` for a full process, PATH, resolver, active probe, and diagnostic-only shell probe report. As a manual fallback, run `which pi` in a shell where `pi --list-models` works, set `PI_COMMAND` to that absolute executable path, then restart pi from that environment. `PI_COMMAND` must be a single executable path, not a shell command with arguments. You can also restart pi from an environment whose `PATH` already includes the pi executable, or manually create `~/.pi/agent/brainstorming-pro/config.json` with provider-qualified model IDs such as `anthropic/claude-sonnet-4`.

Project-local agents and security-sensitive project config require confirmation. In non-interactive contexts they are rejected unless explicitly trusted by user-level config.

## Artifact layout

```text
specs/<topic>/
  design.md                         # latest complete design mirror
  requirements.md                   # created later by /spec-plan
  tasks.md                          # created later by /spec-plan
  clarification/
    current.json
    current -> run-...
    run-YYYYMMDD-HHMMSS/
      metadata.json
      state.json
      request.md
      topic-proposal.json
      execution.log.json
      execution.log.txt
      versions/
        v0/
          design.md
          discovery.md
          discovery.json
          design-gate.json
        v<N>/
          design.md
          revision.md/json
          design-gate.json
      reviews/
        round-1/
          review.md/json
          triage.md/json
          decisions.md/json
          refine.md/json
      final-approval.md
      debug/
```

Canonical resume metadata is stored in `metadata.json` and mirrored in `state.json`. Markdown files are human-readable summaries.

## Design gates

Every complete design version pauses at the design review gate with four choices:

- `approve` — write final approval and complete `/clarify` without invoking `/spec-plan`.
- `review` — run cross-review and return to the gate after issue decisions/refinement.
- `revise` — enter conversational revision and return to the gate.
- `save` — persist progress for `/clarify --resume`.

Discussed or unresolved review issues block approval until they are accepted, rejected, or deferred.

## Security model

- Project files, project-local resources, and subagent outputs are treated as untrusted data.
- Downstream prompts delimit prior artifacts in `<untrusted-data>` blocks.
- Refiner agents return structured design content; only the orchestrator writes `design.md`.
- Topic and artifact writes are constrained to safe paths under the topic spec/run directories.
- Cleanup deletes only selected `run-*` directories.
- Debug artifacts can be `enabled`, `redacted`, or `disabled`.
- Non-dry-run `/clarify` requires interactive UI for topic confirmation and gates.

## Testing and development

```bash
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run validate-package
```

## Handoff

After final approval, Brainstorming Pro prints:

```text
/spec-plan <topic>
```

Run that command manually to create approved planning artifacts. Then run `/spec-exec <topic>` only after `requirements.md` and `tasks.md` are approved.
