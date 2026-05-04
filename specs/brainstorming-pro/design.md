# Brainstorming Pro Design

## Summary

Brainstorming Pro is a pi package that turns complex requirement clarification into a structured, multi-agent design review workflow. It keeps the existing lightweight `brainstorming` skill useful for simple requests, while adding a `/clarify <topic>` command for complex requests that need independent review, prioritization, user decision gates, iterative refinement, and verification before generating implementation specs. The core idea is to combine a pi extension for orchestration, subagents for isolated perspectives, skills/prompts for editable methodology, and file-based artifacts for durable state across contexts.

## Goals

- Provide a `/clarify <topic>` command that runs a repeatable complex requirement clarification workflow.
- Reduce repeated manual work in the current design-review-refine-review loop.
- Preserve independent reviewer context by using subagents instead of only one long conversation context.
- Produce a final, user-approved `specs/<topic>/design.md` suitable as input to `spec-plan`.
- Persist review issues, triage results, user decisions, design versions, and verification results as artifacts.
- Keep the user involved only at high-value decision points, especially deciding which optimization items should be accepted, deferred, rejected, or discussed.
- Support different automation levels for users with different confidence levels.
- Make the workflow configurable through markdown agents, prompts, and skill files rather than hardcoding all reasoning policy in TypeScript.

## Primary Users / Roles

- **Primary user / product owner**: describes a complex feature or behavior change, reviews important trade-offs, and makes final decisions on accepted optimizations.
- **Designer agent**: performs initial clarification and produces the initial design.
- **Reviewer agents**: independently inspect the design from different perspectives and identify gaps, risks, inconsistencies, overengineering, and improvement opportunities.
- **Triager agent**: evaluates reviewer findings, ranks them by priority, explains cost/benefit, and recommends which items should be handled now.
- **Refiner agent**: updates the design according to accepted decisions without expanding scope unnecessarily.
- **Verifier agent**: checks whether accepted decisions were fully implemented and whether refinement introduced new severe regressions.

## Non-Goals

- Replace the existing `brainstorming` skill for simple requests.
- Implement coding tasks directly from `/clarify`; implementation remains the responsibility of `spec-plan` and `spec-exec`.
- Guarantee that every possible future enhancement is included in the current design.
- Create unrestricted agent debate loops without structure or termination conditions.
- Require users to accept all reviewer suggestions.
- Build a general-purpose project management system or issue tracker.
- Make project-local agents trusted by default; project-local agent prompts must be treated as repo-controlled and potentially unsafe.

## Context

Pi intentionally keeps features like subagents and plan mode out of the core, but supports them through extensions, skills, prompt templates, and packages. The official pi repository already includes a subagent extension example that launches separate `pi` subprocesses for delegated work, giving each subagent an isolated context window.

The current manual workflow for complex requirements is:

1. Use `brainstorming` to clarify requirements and create an initial design.
2. Give the design to another agent or fresh context for review.
3. Ask the reviewer to list missing or improvable areas.
4. Ask the original or another agent to evaluate whether those improvements are necessary.
5. Classify improvements by priority, such as P0/P1/P2.
6. Let the user decide which items should actually be accepted.
7. Update the design.
8. Re-review whether accepted improvements were completed.
9. Repeat until the design is good enough.
10. Generate requirements and tasks for implementation.

This workflow works well but is repetitive, context-heavy, and error-prone when performed manually. Brainstorming Pro formalizes it as an orchestrated process.

## Discovery

### Key Discoveries

- Complex requirements often degrade in a single long context because the agent loses precision over time.
- Independent review in a new context reliably surfaces missing requirements, design weaknesses, or better trade-offs.
- Reviewer suggestions are not all equal; some are essential now, while others are future-facing or speculative.
- The user's key contribution is not repeating agent work, but making product/scope decisions about which improvements are worth doing now.
- A second review should usually verify accepted changes rather than reopen unlimited new ideation.
- Durable files are needed so the workflow can survive context resets and so future spec planning can understand why decisions were made.

### Scope Decisions

- Include a pi extension because orchestration, subagent spawning, structured state, user gates, and iterative loops require programmatic control.
- Include skills/prompts/agent markdown because reasoning policy should remain editable without changing TypeScript code.
- Use `/clarify <topic>` as the main command.
- Use `brainstorming-pro` as the package and feature name.
- Default to a hybrid automation mode where P0/P1 items are recommended for user approval and P2/P3 items are deferred unless the user chooses otherwise.
- Limit automatic review/refine loops with explicit termination rules to avoid endless optimization.

## Proposed Solution

Build `brainstorming-pro` as a pi package containing:

- a `clarification-orchestrator` extension that registers `/clarify <topic>`;
- a `brainstorming-pro` skill that documents the workflow and decision policy;
- subagent definitions for designer, reviewers, triager, refiner, and verifier;
- prompt templates for common clarification workflows;
- artifact storage under `specs/<topic>/clarification/`.

The extension owns state, file IO, subagent execution, user interaction, and loop control. The markdown skill and agent prompts own the reasoning methodology, priority definitions, review criteria, and role behavior.

### Architecture

```text
User
  |
  | /clarify <topic>
  v
Clarification Orchestrator Extension
  |
  |-- Artifact Store
  |-- User Decision Gate
  |-- Subagent Runner
  |-- Workflow State Machine
  |
  +--> Designer Agent
  +--> Reviewer Agents
  +--> Triager Agent
  +--> Refiner Agent
  +--> Verifier Agent
  |
  v
specs/<topic>/design.md
specs/<topic>/clarification/*
```

The orchestrator runs the workflow as a state machine:

```text
INIT
  -> DISCOVERY
  -> INITIAL_DESIGN
  -> REVIEW
  -> TRIAGE
  -> USER_DECISION
  -> REFINE
  -> VERIFY
  -> FINAL_APPROVAL
  -> COMPLETE
```

If verification finds missing accepted P0/P1 work, the workflow can return to `REFINE`, bounded by `maxRounds`.

### Components

#### 1. `brainstorming-pro` pi package

Responsibilities:

- Bundle extension, skill, agents, and prompts.
- Provide a convenient installable unit.
- Allow future sharing through npm or git.

Expected package layout:

```text
brainstorming-pro/
├── package.json
├── extensions/
│   └── clarification-orchestrator/
│       ├── index.ts
│       ├── types.ts
│       ├── runner.ts
│       ├── artifact-store.ts
│       ├── workflow.ts
│       └── user-gate.ts
├── agents/
│   ├── designer.md
│   ├── reviewer-product.md
│   ├── reviewer-architecture.md
│   ├── reviewer-risk.md
│   ├── reviewer-testing.md
│   ├── triager.md
│   ├── refiner.md
│   └── verifier.md
├── skills/
│   └── brainstorming-pro/
│       └── SKILL.md
└── prompts/
    ├── clarify.md
    ├── clarify-review.md
    └── clarify-refine.md
```

#### 2. Clarification Orchestrator Extension

Responsibilities:

- Register `/clarify <topic>`.
- Parse command options.
- Create the spec directory.
- Spawn subagents using isolated pi processes.
- Collect structured outputs.
- Persist artifacts.
- Ask the user for decisions at gates.
- Control iteration and termination.
- Optionally hand off to `spec-plan` after final approval.

Initial command shape:

```text
/clarify <topic> [--mode manual|hybrid|auto] [--max-rounds N] [--threshold P0|P1|P2] [--reviewers list] [--auto-spec-plan]
```

Default options:

```text
mode = hybrid
maxRounds = 2
threshold = P1
reviewers = product,architecture,risk,testing
autoSpecPlan = false
```

#### 3. Subagent Runner

Responsibilities:

- Launch subagent tasks in isolated contexts.
- Pass controlled prompts and artifact content.
- Support sequential and parallel execution.
- Capture structured output.
- Propagate cancellation.
- Record usage metadata when available.

The runner should initially follow the official pi subagent example approach: spawn separate `pi` subprocesses in JSON mode for each subagent invocation.

#### 4. Artifact Store

Responsibilities:

- Read and write workflow artifacts.
- Maintain versioned design snapshots.
- Maintain `decision-log.md`.
- Support resume/status in later versions.

Expected output layout:

```text
specs/<topic>/
├── design.md
└── clarification/
    ├── 00-user-idea.md
    ├── 01-discovery.md
    ├── 02-design-v1.md
    ├── 03-review-r1.md
    ├── 04-triage-r1.md
    ├── 05-user-decisions-r1.md
    ├── 06-design-v2.md
    ├── 07-verification-r1.md
    └── decision-log.md
```

For additional rounds:

```text
08-review-r2.md
09-triage-r2.md
10-user-decisions-r2.md
11-design-v3.md
12-verification-r2.md
```

#### 5. User Decision Gate

Responsibilities:

- Present triaged issues to the user.
- Allow decisions: accept, reject, defer, or needs-discussion.
- In manual mode, ask for all relevant issues.
- In hybrid mode, focus on P0/P1 and conflicting or uncertain items.
- In auto mode, auto-accept P0/P1 and defer P2/P3 unless a high-cost, low-confidence, or scope-expanding issue requires confirmation.

Decision format:

```ts
type UserDecision = {
  issueId: string;
  decision: "accept" | "reject" | "defer" | "needs-discussion";
  reason?: string;
};
```

#### 6. Reviewer Agents

Responsibilities:

- Review the current design from specialized perspectives.
- Produce structured issues only.
- Avoid rewriting the design directly.
- Distinguish current blockers from future improvements.

Initial reviewer set:

- `reviewer-product`: user goals, UX, scope, success criteria.
- `reviewer-architecture`: component boundaries, data flow, integration, maintainability.
- `reviewer-risk`: security, permissions, failure modes, operational risks.
- `reviewer-testing`: testability, acceptance criteria, edge cases.

#### 7. Triager Agent

Responsibilities:

- Deduplicate reviewer issues.
- Assign priority.
- Explain necessity, trade-offs, estimated cost, and recommended action.
- Identify conflicts and dependencies between issues.

Priority policy:

- **P0**: must fix now; current design cannot safely or correctly satisfy the core goal without it.
- **P1**: should fix now; not fatal, but likely to cause ambiguity, rework, or significant quality issues.
- **P2**: reasonable improvement but deferrable; useful for future extension or polish.
- **P3**: optional or likely overengineering; not recommended for current scope.

Structured issue format:

```ts
type DesignIssue = {
  id: string;
  title: string;
  description: string;
  category:
    | "requirement-gap"
    | "architecture"
    | "data-flow"
    | "error-handling"
    | "security"
    | "ux"
    | "testing"
    | "maintainability"
    | "scope-risk"
    | "future-extension";
  severity: "P0" | "P1" | "P2" | "P3";
  confidence: "high" | "medium" | "low";
  evidence: string[];
  riskIfIgnored: string;
  suggestedChange: string;
  estimatedCost: "low" | "medium" | "high";
  recommendation:
    | "must-fix-now"
    | "should-fix-now"
    | "defer"
    | "optional"
    | "reject";
  tradeoffs: {
    pros: string[];
    cons: string[];
  };
  dependsOn?: string[];
  conflictsWith?: string[];
};
```

#### 8. Refiner Agent

Responsibilities:

- Update `design.md` according to accepted decisions.
- Preserve the approved scope.
- Avoid implementing rejected or deferred items.
- Add deferred improvements to the design only when useful as non-blocking future notes.
- Produce a concise change log mapping accepted issue IDs to design changes.

#### 9. Verifier Agent

Responsibilities:

- Compare accepted decisions against the refined design.
- Mark each accepted issue as completed, partially completed, missing, or over-implemented.
- Identify severe regressions introduced by refinement.
- Avoid reopening broad ideation unless a new P0/P1 regression appears.

Verification format:

```ts
type VerificationResult = {
  issueId: string;
  status: "completed" | "partially-completed" | "missing" | "over-implemented";
  evidence: string;
  requiredFollowup?: string;
};
```

### Data Flow

#### Primary `/clarify <topic>` Flow

1. User runs `/clarify <topic>` and optionally provides initial context or options.
2. Orchestrator creates `specs/<topic>/` and `specs/<topic>/clarification/`.
3. Orchestrator records the original user idea in `00-user-idea.md`.
4. Designer agent performs initial discovery and writes `01-discovery.md`.
5. Designer agent creates initial `design.md`; orchestrator snapshots it as `02-design-v1.md`.
6. Reviewer agents independently review the design and produce structured findings.
7. Orchestrator writes reviewer output to `03-review-r1.md`.
8. Triager agent deduplicates and prioritizes findings.
9. Orchestrator writes triage output to `04-triage-r1.md`.
10. User Decision Gate asks the user which items to accept, reject, defer, or discuss.
11. Orchestrator writes decisions to `05-user-decisions-r1.md` and appends them to `decision-log.md`.
12. Refiner agent updates `design.md` according to accepted decisions.
13. Orchestrator snapshots refined design as `06-design-v2.md`.
14. Verifier agent checks accepted decisions against the refined design.
15. Orchestrator writes verification output to `07-verification-r1.md`.
16. If accepted P0/P1 items are missing and `maxRounds` is not reached, return to refinement or review as needed.
17. Orchestrator asks for final user approval.
18. On approval, `design.md` becomes the final design for `spec-plan`.

#### Automation Modes

##### Manual Mode

- User reviews and decides every triaged issue above the configured threshold.
- Best for high-risk or product-sensitive changes.

##### Hybrid Mode

- Default mode.
- P0/P1 items are shown for user confirmation.
- P2/P3 items are deferred by default but visible in the summary.
- High-cost, low-confidence, or scope-expanding items are always shown.

##### Auto Mode

- P0/P1 items are accepted automatically unless they are high-cost, low-confidence, or scope-expanding.
- P2/P3 items are deferred automatically.
- User is only interrupted for conflicts, ambiguity, or major scope changes.

## Error Handling

- **Subagent failure**: capture stderr/stdout, write a failure artifact, and ask the user whether to retry, skip that reviewer, or abort.
- **Invalid structured output**: attempt one repair pass with the same subagent or a parser/normalizer prompt; if still invalid, save raw output and ask the user whether to continue.
- **User abort**: stop active subprocesses, preserve completed artifacts, and leave a status note for future resume.
- **Conflicting reviewer findings**: triager marks conflicts explicitly and routes them to the user gate.
- **No issues found**: skip refinement and proceed to final approval.
- **Verifier reports missing accepted P0/P1 items**: return to refinement if within `maxRounds`; otherwise present unresolved items to the user for manual decision.
- **Project-local agent risk**: default to user-level agents only. If project-local agents are enabled, require confirmation before running them.
- **Artifact write failure**: stop the workflow and report the failed path; do not continue without durable state.
- **Context too large**: pass summarized artifacts and direct file paths instead of full history where possible.

## Testing

### Unit Tests

- Command option parsing for `/clarify`.
- Topic normalization to kebab-case spec directory names.
- Artifact path generation.
- Issue schema validation.
- Decision schema validation.
- Priority threshold filtering.
- Automation mode decision defaults.
- Termination condition evaluation.

### Integration Tests

- Run a mock `/clarify <topic>` workflow with fake subagent outputs.
- Verify artifacts are written in the expected order.
- Verify accepted decisions are passed to the refiner.
- Verify verifier failures trigger another refinement round when allowed.
- Verify `maxRounds` prevents infinite loops.
- Verify user abort preserves partial state.

### Manual / End-to-End Tests

- Simple request: confirm workflow does not add excessive ceremony.
- Complex request: confirm reviewers surface useful issues and triage is actionable.
- Hybrid mode: confirm P0/P1 user gate behavior.
- Auto mode: confirm low-risk requirements can proceed with minimal interruption.
- Project-local agents: confirm security prompt appears before execution.

## Open Questions

- Should `/clarify <topic>` call the existing `brainstorming` skill directly for initial discovery, or should Brainstorming Pro provide its own designer agent prompt that mirrors the skill methodology?
- Should final approval automatically invoke `spec-plan`, or should that remain an explicit user action by default?
- What UI should be used for the decision gate in the first implementation: simple markdown prompt, selectable TUI list, or both?
- Should reviewer agents be configurable globally, per project, or per invocation?
- Should P2 deferred items be included in the final `design.md`, kept only in `decision-log.md`, or both?
- Should the extension support resuming an interrupted clarification workflow in the first version, or defer resume support to a later iteration?
