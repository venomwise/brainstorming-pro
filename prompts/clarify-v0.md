# Clarify V0 Prompt

Canonical methodology resource: `brainstorming-methodology.md`
Methodology version: `brainstorming-pro-v1`

Load and follow the package-owned Brainstorming Pro V0 Clarification Methodology, then apply these clarify-specific constraints:

- Use the captured request and confirmed topic from run metadata.
- Write the initial complete design snapshot to `versions/v0/design.md` through orchestrator artifact APIs.
- Write discovery/context notes to `versions/v0/discovery.md` through orchestrator artifact APIs.
- Mirror the latest complete design to top-level `specs/<topic>/design.md`.
- Record assumptions, blind spots, request summary, and `brainstorming-pro-v1` in metadata or discovery artifacts.
- Stop at the design review gate after V0 is complete.
- Do not invoke `/spec-plan`; final approval only prints the handoff command.
