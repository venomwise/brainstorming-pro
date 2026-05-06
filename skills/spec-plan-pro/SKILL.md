---
name: spec-plan-pro
description: Planning boundary for Brainstorming Pro. Use after `/clarify` final approval to turn an approved `design.md` into user-approved `requirements.md` and `tasks.md`.
---

# Spec Plan Pro

Spec Plan Pro consumes an explicitly approved Brainstorming Pro design and produces planning artifacts. It does not clarify from scratch and does not execute implementation.

## Canonical Methodology

Use `prompts/spec-plan-methodology.md` (`methodologyVersion: spec-plan-pro-v1`).

## Required Inputs

- `specs/<topic>/design.md` exists and represents an approved clarification design.
- A final approval artifact or metadata from the clarification run records approval.
- The user confirms planning should proceed for the topic.

## Workflow

1. Locate and review approved design and final approval context.
2. Refuse or pause if approval context is missing or ambiguous.
3. Produce `requirements.md` with testable acceptance criteria traceable to the approved design.
4. Produce `tasks.md` with checkbox task structure suitable for `spec-exec-pro`.
5. Ask the user to approve planning artifacts before execution.

## Boundaries

- Do not invent scope missing from the approved design.
- If design context is missing, route the user back to `/clarify <request>`.
- If planning reveals design ambiguity or scope changes, pause and request design revision through `/clarify`.
- Do not implement code.
