# Brainstorming Pro

Brainstorming Pro is being refactored around a single durable workflow runtime. The public command surface is intentionally narrow: users express workflow intent through `/brainstorm-pro`, while code-owned state, artifact refs, review decisions, and approval gates enforce lifecycle boundaries.

## Commands

Public commands:

- `/brainstorm-pro "<request>"` — start a new runtime-managed workflow. The runtime asks the selected LLM to summarize the request into a safe English kebab-case topic, creates `specs/<topic>/.workflow/runs/<run-id>/state.json`, and enters `designing`.
- `/brainstorm-pro "<request>" --topic <existing-topic>` — continue an existing brainstorm with the current `design.md` as background context. This creates a new run for the same topic, records the supplemental request, resets design review/approval state, and returns to `designing`.
- `/brainstorm-pro --topic <existing-topic>` — resume an existing workflow by topic.
- `/brainstorm-pro --resume [topic]` — resume the next runtime-managed workflow step. Resume is state-aware: it displays review choices at review decision gates, displays approval choices at approval gates, returns blocked/failed states fail-closed, and never silently chooses review depth or approval.
- `/brainstorm-pro --status [topic]` — show runtime phase, pending decision, latest artifact refs, review status, and last error for a runtime-managed workflow.

Internal helper flags such as `--choose-review` and `--decision` are accepted only with `--resume`; they are not a replacement for the state-aware gate model and cannot bypass runtime validation.

## Runtime lifecycle

```text
intake
  -> designing
  -> awaiting-design-review-decision
  -> design-review | awaiting-design-approval
  -> awaiting-design-approval
  -> planning
  -> plan-review
  -> awaiting-plan-approval
  -> executing
  -> execution-review
  -> done
```

The runtime pauses at mandatory gates:

- `awaiting-design-review-decision` — inspect the candidate design and choose `skip`, `minimal`, `full`, revise, or exit. `skip` is recorded explicitly with `reason = "user-selected-skip"`; `minimal` runs a lightweight workflow-owned review, and `full` runs the complete five-role design reviewer pack (Product, Architecture, Risk/Security, Testing, and Scope/Simplicity) by default. Full design review may bind a user-selected subset of those package-owned reviewers to the exact design artifact; invalid, empty, duplicate, minimal, unknown, stale, or unregistered selections are rejected before a review run is created. No review mode is silently downgraded.
- `awaiting-design-approval` — approve the exact reviewed/skipped design artifact before planning can start, request revision, show status, or exit. Review readiness is not the same as approval.
- `plan-review` — automatic fixed three-role plan review validates approved design to requirements coverage, requirements to tasks coverage, and dependency/order readiness. It does not accept `skip`, `minimal`, or `full` mode input and never approves or executes the plan.
- `awaiting-plan-approval` — approve exact requirements/tasks refs covered by the latest ready automatic plan review before execution can start.

Blocked, failed, and terminal states do not auto-advance on resume. A partial full design review is reported as blocked with `reason = "incomplete-design-review"`, `status = "partial"`, and readiness `incomplete-review`; it is not a passed review. Design review now also writes a deterministic triage report that groups findings into must-fix, should-fix, and note tiers, surfaces conflicts and unresolved questions, and preserves incomplete coverage truthfully. Triage readiness is advisory only: stale or checksum-mismatched triage is ignored, `ready-for-user-approval` still requires the explicit design approval gate, and blocked/incomplete/failed/skipped summaries never imply approval. Runtime status may expose recovery actions such as revising the design once from bound review evidence, answering blocking revision questions, retrying failed reviewers, explicitly accepting a safe incomplete review, replacing reviewer selection, or viewing the review ledger. Accept incomplete is a separate explicit user decision and still only moves the workflow to the design approval gate; it never approves design or starts planning.

A design revision authorization is single-use: one user authorization permits at most one runtime-owned revised `design` artifact commit and one automatic post-revision design review. The reviser agent can only return complete replacement design markdown plus structured metadata; it cannot write files, approve design, retry reviewers, accept incomplete reviews, or enter planning. After a revised design commits, prior review/triage/readiness evidence remains provenance only and cannot approve the new design ref. Post-revision review results are shown in status/resume as a handoff with the revised design ref, post-review run id, readiness/triage summary, and next recovery actions. If post-review passes, the workflow stops at the explicit design approval gate; if it blocks, fails, is partial, or is unavailable, the workflow pauses for user decision and does not auto-revise again.

## Skill phase adapters

The `designing` and `planning` phases now use workflow-owned Skill Phase Adapters. `BrainstormingPhaseAdapter` invokes the controlled Agent Execution Runtime with the `design-author` role to draft candidate `design.md` content, then returns an artifact commit request; the runtime performs the actual versioned commit and stops at `awaiting-design-review-decision`. After exact design review/approval gates pass, `SpecPlanPhaseAdapter` invokes the `plan-author` role to draft `requirements.md` and `tasks.md`, returns a commit request, and the runtime enters automatic `plan-review`.

Adapters compile package-owned methodology into prompt templates and structured output schemas. Child Pi processes remain constrained by `--no-session`, `--no-skills`, role policy, provider-qualified model validation, recursion guard, and bounded output capture. Adapters do not write approvals, review decisions, event logs, or `state.json` directly.

`SpecExecPhaseAdapter` is intentionally unavailable until a follow-up controlled execution adapter lands. When reached, it blocks with diagnostics instead of handing the full `tasks.md` to an LLM or marking the workflow done.

## Runtime artifact layout

```text
specs/<topic>/
  design.md
  requirements.md
  tasks.md
  .workflow/
    events.jsonl
    artifacts/
      design/v<N>.md
      requirements/v<N>.md
      tasks/v<N>.md
    decisions/
    approvals/
      design-approval.json
      plan-approval.json
    reviews/
      design/
        <review-run-id>/
          review-run.json
          reviewer-results/
            minimal-reviewer.json | product-reviewer.json | architecture-reviewer.json | risk-security-reviewer.json | testing-reviewer.json | scope-simplicity-reviewer.json
          attempts/
            attempt-001/
              attempt.json
              reviewer-results/<role>.json
          coverage.json
          aggregated-findings.json
          readiness.json
          triage-report.json
          accept-incomplete-decision.json
    revisions/
      design/
        <revision-id>/
          authorization.json
          request.json
          prompt.md
          system-prompt.md
          child-result.json
          output.json
          validation.json
          record.json
    runs/<run-id>/
      state.json
```

Runtime artifact references include kind, version, relative path, timestamp, and SHA-256 checksum. Review decisions, reviewer retry attempts, accept-incomplete decisions, and approvals are rejected if their referenced versions are stale, missing, outside the topic directory, empty, or checksum-mismatched. Failed reviewer retry preserves the original review run id, stable selected reviewer set, and exact design artifact binding while updating latest effective reviewer results only after durable ledger and event writes.

## Security model

- Workflow topics must be strict English kebab-case and are constrained to `specs/<topic>/`.
- New workflow topics are proposed by the selected LLM from the request and then validated by code before any workflow path is created.
- Workflow paths and artifact refs must stay inside the topic directory.
- Runtime gates are code-enforced; phase adapters, agents, reviewers, and the parent LLM cannot approve or skip gates directly.
- User-selected `skip` is explicit state, not an implicit no-op.
- The runtime fails closed for invalid transitions, missing artifacts, checksum mismatches, corrupted state, or blocked/failed phases.

## Infrastructure-only pi-subagents reuse

Brainstorming Pro may copy or adapt selected business-agnostic infrastructure from [`nicobailon/pi-subagents`](https://github.com/nicobailon/pi-subagents) under the MIT License, but it does not directly depend on, register, or expose the generic `pi-subagents` product model. Reuse is limited to local Brainstorming Pro-owned helpers such as formatting, terminal rendering, atomic JSON persistence, live snapshot presentation, and future foreground child execution patterns.

This package must not add `pi-subagents` as a runtime dependency, register a public generic `subagent` command/tool, expose arbitrary `single`/`parallel`/`chain`/`async` orchestration, import intercom/background async runner modules, or copy upstream builtin role files as user-visible agents. Derived code is tracked by `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json`, attributed by `extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md`, and constrained by package validation and product-boundary tests.

Maintainers should review the reuse policy before adding or synchronizing derived code:

- `specs/pi-subagents-infrastructure-reuse/design.md`
- `specs/pi-subagents-infrastructure-reuse/requirements.md`
- `extensions/clarification-orchestrator/vendor/pi-subagents/`

Future agent execution runtime or workflow TUI specs must reference the reuse inventory and adaptation rules rather than independently copying upstream code.

## Testing and development

```bash
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run validate-package
```
