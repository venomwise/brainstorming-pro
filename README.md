# Brainstorming Pro

Brainstorming Pro is a pi package for structured, recoverable requirement clarification. It provides slash commands that create durable clarification artifacts under `specs/<topic>/clarification/run-*` and leave the approved design at `specs/<topic>/design.md` for handoff to `spec-plan`.

## Commands

- `/clarify <topic>` — start a clarification workflow.
- `/clarify <topic> --resume` — resume the current run for a topic.
- `/clarify <topic> --mode manual|hybrid|auto` — choose decision gate automation.
- `/clarify <topic> --max-rounds N --threshold P0|P1|P2|P3` — tune verification/refinement loops.
- `/clarify <topic> --reviewers product,architecture,risk,testing` — select reviewers.
- `/clarify <topic> --verbose` — emit phase/activity logging.
- `/clarify <topic> --dry-run` — validate setup and write a planned prompt/debug artifact without launching subagents.
- `/clarify-status <topic>` — show run phase, artifacts, pending decisions, errors, and resume command.
- `/clarify-diff <topic> [run1 run2]` — compare design, issue, and decision artifacts.
- `/clarify-clean <topic> [--dry-run] [--keep N]` — delete old runs while protecting the current/newest runs.

## Configuration

Configuration is loaded in this order:

1. Bundled defaults.
2. `~/.pi/agent/brainstorming-pro/config.json`.
3. `<project>/.pi/brainstorming-pro/config.json`.
4. `<project>/.pi/brainstorming-pro/config.local.json`.
5. Command-line overrides.

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
    "default": "sonnet",
    "fallback": ["gpt-4o"]
  },
  "security": {
    "allowProjectAgents": false,
    "allowProjectToolExpansion": false,
    "debugArtifacts": "redacted"
  }
}
```

Project-local agents and security-sensitive project config require confirmation. In non-interactive contexts they are rejected unless explicitly trusted by user-level config.

## Artifact layout

```text
specs/<topic>/
  design.md
  clarification/
    current.json
    current -> run-...
    run-YYYYMMDD-HHMMSS/
      state.json
      execution.log.json
      execution.log.txt
      01-discovery.md/json
      02-design-v1.md
      review-r1.md/json
      triage-r1.md/json
      decisions-r1.md/json
      refine-r1-1.md/json
      verification-r1-1.md/json
      final-approval.md
      debug/
```

Canonical state is JSON (`state.json` plus phase JSON artifacts). Markdown files are human-readable summaries and are not required for status/resume decisions.

## Security model

- Project files, project-local resources, and subagent outputs are treated as untrusted data.
- Downstream prompts delimit prior artifacts in `<untrusted-data>` blocks.
- Refiner agents return structured design content; only the orchestrator writes `design.md`.
- Artifact writes are constrained to the topic spec/run directories.
- Cleanup deletes only selected `run-*` directories.
- Debug artifacts can be `enabled`, `redacted`, or `disabled`.

## Testing and development

```bash
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run validate-package
```

## Handoff to spec-plan

After final approval, run `spec-plan` manually with `specs/<topic>/design.md` and the clarification artifacts as context. Brainstorming Pro does not auto-invoke `spec-plan`.
