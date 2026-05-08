# Brainstorming Pro

Brainstorming Pro is being refactored around a single durable workflow runtime. The public command surface is intentionally narrow: users express workflow intent through `/brainstorm-pro`, while code-owned state, artifact refs, review decisions, and approval gates enforce lifecycle boundaries.

## Commands

Public commands:

- `/brainstorm-pro "<request>" --topic <english-kebab-case-topic>` — start a runtime-managed workflow. The runtime creates `specs/<topic>/.workflow/runs/<run-id>/state.json` and enters `designing`.
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
  -> awaiting-plan-review-decision
  -> plan-review | awaiting-plan-approval
  -> awaiting-plan-approval
  -> executing
  -> execution-review
  -> done
```

The runtime pauses at mandatory gates:

- `awaiting-design-review-decision` — inspect the candidate design and choose `skip`, `minimal`, future `full`, revise, or exit. `skip` is recorded explicitly with `reason = "user-selected-skip"`; unavailable `full` is reported without downgrading.
- `awaiting-design-approval` — approve the exact reviewed/skipped design artifact before planning can start, request revision, show status, or exit.
- `awaiting-plan-review-decision` — inspect current `requirements.md` and `tasks.md` refs and choose plan review depth.
- `awaiting-plan-approval` — approve exact requirements/tasks refs before execution can start.

Blocked, failed, and terminal states do not auto-advance on resume.

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
    runs/<run-id>/
      state.json
```

Runtime artifact references include kind, version, relative path, timestamp, and SHA-256 checksum. Review decisions and approvals are rejected if their referenced versions are stale, missing, outside the topic directory, empty, or checksum-mismatched.

## Security model

- Workflow topics must be strict English kebab-case and are constrained to `specs/<topic>/`.
- Workflow paths and artifact refs must stay inside the topic directory.
- Runtime gates are code-enforced; phase adapters, agents, reviewers, and the parent LLM cannot approve or skip gates directly.
- User-selected `skip` is explicit state, not an implicit no-op.
- The runtime fails closed for invalid transitions, missing artifacts, checksum mismatches, corrupted state, or blocked/failed phases.

## Testing and development

```bash
npm run typecheck
npm test
npm run test:unit
npm run test:integration
npm run test:security
npm run validate-package
```
