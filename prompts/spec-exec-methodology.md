---
methodologyVersion: spec-exec-pro-v1
---

# Spec Exec Pro Lifecycle Boundary Contract

`spec-exec-pro-v1` executes only from user-approved planning artifacts.

## Required Inputs

- Approved `specs/<topic>/requirements.md`.
- Approved `specs/<topic>/tasks.md` with executable task checkboxes.
- Any referenced approved design context.

## Boundaries

- Refuse to execute when requirements or tasks are missing or not approved.
- Implement one task at a time and update task status immediately after successful validation.
- If execution reveals scope changes, pause and route the user back to `/spec-plan` or `/clarify`.
- Do not silently expand scope beyond approved requirements.
