---
methodologyVersion: spec-plan-pro-v1
---

# Spec Plan Pro Lifecycle Handoff Contract

`spec-plan-pro-v1` begins only after `/clarify` has produced an explicitly approved `design.md` and final approval artifact.

## Inputs

- Approved `specs/<topic>/design.md`.
- Clarification run metadata and final approval artifact.
- Accepted, rejected, deferred, and unresolved risk summaries.

## Boundaries

- Do not invent product scope that is absent from the approved design.
- If the approved design is missing, ambiguous, or contradicted by the user's request, pause and route the user back to `/clarify` or request design revision.
- Produce `requirements.md` and `tasks.md` only after the user confirms the planning scope.
- Keep planning separate from execution; do not implement code.
