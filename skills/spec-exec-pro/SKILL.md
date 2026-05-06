---
name: spec-exec-pro
description: Execution boundary for Brainstorming Pro. Use only with user-approved `requirements.md` and `tasks.md`; refuse when planning artifacts are missing or scope changes.
---

# Spec Exec Pro

Spec Exec Pro implements approved planning artifacts one task at a time.

## Canonical Methodology

Use `prompts/spec-exec-methodology.md` (`methodologyVersion: spec-exec-pro-v1`).

## Required Inputs

- Approved `specs/<topic>/requirements.md`.
- Approved `specs/<topic>/tasks.md`.
- Any referenced approved `design.md` context.

## Workflow

1. Read `requirements.md` and `tasks.md`.
2. Resume from the first incomplete required task.
3. Implement exactly one task at a time.
4. Validate against explicit task instructions and referenced acceptance criteria.
5. Mark the task complete immediately after successful validation.
6. Stop at checkpoints and ask the user before continuing.

## Refusal and Pause Behavior

- Refuse to execute without approved requirements and tasks.
- Do not implement scope that is absent from approved planning artifacts.
- If execution reveals scope changes or unresolved design ambiguity, pause and route back to `/spec-plan <topic>` or `/clarify <request>`.
