# Brainstorming Pro Design

## Summary

Brainstorming Pro is a pi package that turns complex requirement clarification into a structured, multi-agent design review workflow. It keeps the existing lightweight `brainstorming` skill useful for simple requests, while adding a `/clarify <topic>` command for complex requests that need independent review, prioritization, user decision gates, iterative refinement, verification, durable state, and safe recovery before generating implementation specs.

The core idea is to combine:

- a pi extension for deterministic orchestration;
- isolated subagents for independent perspectives;
- markdown skills/prompts/agent definitions for editable reasoning methodology;
- machine-readable and human-readable artifacts for durable state and traceability;
- explicit user decision gates for product/scope trade-offs.

The initial implementation target is a complete, recoverable, observable, and safe clarification workflow. It should not be treated as a minimal MVP that intentionally defers core workflow capabilities. Later iteration is reserved for new operation modes, extra management commands, additional reviewer packs, richer dashboards, or bug fixes.

## Goals

- Provide a `/clarify <topic>` command that runs a repeatable complex requirement clarification workflow.
- Reduce repeated manual work in the current design-review-refine-review loop.
- Preserve independent reviewer context by using subagents instead of only one long conversation context.
- Produce a final, user-approved `specs/<topic>/design.md` suitable as input to `spec-plan`.
- Persist review issues, triage results, user decisions, design versions, verification results, logs, and workflow state as artifacts.
- Keep the user involved only at high-value decision points, especially deciding which optimization items should be accepted, deferred, rejected, or discussed.
- Support manual, hybrid, and auto automation modes.
- Support status and resume for interrupted workflows.
- Support comparing, cleaning, and managing multiple clarification runs.
- Make the workflow configurable through bundled defaults, user/project config, markdown agents, prompts, and skill files rather than hardcoding all reasoning policy in TypeScript.
- Provide robust error recovery, structured output validation, observability, and safety boundaries for project-controlled content.

## Primary Users / Roles

- **Primary user / product owner**: describes a complex feature or behavior change, reviews important trade-offs, and makes final decisions on accepted optimizations.
- **Designer agent**: performs initial clarification and produces discovery notes plus the initial design.
- **Reviewer agents**: independently inspect the design from different perspectives and identify gaps, risks, inconsistencies, overengineering, and improvement opportunities.
- **Triager agent**: deduplicates reviewer findings, ranks them by priority, explains cost/benefit, and recommends which items should be handled now.
- **Refiner agent**: produces an updated design according to accepted decisions without expanding scope unnecessarily.
- **Verifier agent**: checks whether accepted decisions were fully implemented and whether refinement introduced severe regressions.
- **Clarification orchestrator extension**: owns state, file IO, subagent execution, user interaction, retries, cancellation, validation, artifact writing, and loop control.

## Non-Goals

- Replace the existing `brainstorming` skill for simple requests.
- Implement coding tasks directly from `/clarify`; implementation remains the responsibility of `spec-plan` and `spec-exec`.
- Guarantee that every possible future enhancement is included in the current design.
- Create unrestricted agent debate loops without structure or termination conditions.
- Require users to accept all reviewer suggestions.
- Build a general-purpose project management system or issue tracker.
- Make project-local agents, prompts, skills, extensions, or config trusted by default.
- Provide background daemon execution, custom TUI checklist UI, or automatic `spec-plan` invocation as part of the core clarification workflow. These are valid future feature additions but are not required for a complete foreground clarification workflow.

## Context

Pi intentionally keeps features like subagents and plan mode out of the core, but supports them through extensions, skills, prompt templates, packages, custom commands, subprocess execution, and session/UI APIs. The official pi repository includes a subagent extension example that launches separate `pi` subprocesses for delegated work, giving each subagent an isolated context window.

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
- Pi packages do not natively discover `agents/` resources, so bundled agent definitions must be resolved by Brainstorming Pro itself.
- Project-local resources and project files are untrusted inputs and require explicit trust boundaries.

### Scope Decisions

- Include a pi extension because orchestration, subagent spawning, structured state, user gates, retries, cancellation, and iterative loops require programmatic control.
- Include skills/prompts/agent markdown because reasoning policy should remain editable without changing TypeScript code.
- Use `/clarify <topic>` as the main command.
- Use `brainstorming-pro` as the package and feature name.
- Default to hybrid automation mode where P0/P1 items are shown for user approval and P2/P3 items are deferred unless the user chooses otherwise.
- Limit automatic review/refine loops with explicit termination rules to avoid endless optimization.
- Do not directly invoke the existing `brainstorming` skill as a command inside `/clarify`; instead, the designer agent prompt incorporates compatible methodology while the orchestrator owns workflow control.
- Do not automatically invoke `spec-plan` by default. Final approval outputs a clear handoff instruction. Automatic `spec-plan` invocation can be added later as an explicit opt-in feature.
- Refiner subagents do not directly write arbitrary files. They return revised design content and a change log; the orchestrator validates and writes `design.md`.

## Proposed Solution

Build `brainstorming-pro` as a pi package containing:

- a `clarification-orchestrator` extension that registers `/clarify`, `/clarify-status`, `/clarify-diff`, `/clarify-clean`, and related core workflow commands;
- a `brainstorming-pro` skill that documents the methodology and decision policy;
- bundled subagent definitions for designer, reviewers, triager, refiner, and verifier;
- prompt templates/fragments for clarification workflows;
- artifact storage under `specs/<topic>/clarification/<run-id>/`.

The extension owns deterministic workflow concerns: state, file IO, subagent execution, retries, cancellation, user interaction, schema validation, artifact writing, logs, and termination conditions. Markdown skill/agent/prompt resources own reasoning methodology, priority definitions, review criteria, and role behavior.

### Architecture

```text
User
  |
  | /clarify <topic>
  v
Clarification Orchestrator Extension
  |
  |-- Config Loader
  |-- Topic / Path Guard
  |-- Artifact Store
  |-- Workflow State Machine
  |-- User Decision Gate
  |-- Subagent Runner
  |-- Schema Validator / Repair
  |-- Progress Reporter
  |-- Execution Logger
  |
  +--> Designer Agent
  +--> Reviewer Agents
  +--> Triager Agent
  +--> Refiner Agent
  +--> Verifier Agent
  |
  v
specs/<topic>/design.md
specs/<topic>/clarification/<run-id>/*
```

The orchestrator runs the workflow as a bounded state machine:

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

After the first refinement, the default loop is `VERIFY -> REFINE`, not a new broad `REVIEW -> TRIAGE` cycle. A new broad review round requires explicit user approval or detection of a severe new P0/P1 regression. If verification finds missing accepted P0/P1 work, the workflow can return to `REFINE`, bounded by `maxRounds`.

`maxRounds` counts refinement attempts after the initial design. With the default `maxRounds = 2`, the workflow supports:

1. initial design;
2. broad review + triage + decisions;
3. refinement attempt 1 + verification;
4. optional refinement attempt 2 if accepted P0/P1 items are still missing.

## Package Resource Loading

### Package Layout

```text
brainstorming-pro/
├── package.json
├── extensions/
│   └── clarification-orchestrator/
│       ├── index.ts
│       ├── types.ts
│       ├── config.ts
│       ├── runner.ts
│       ├── artifact-store.ts
│       ├── workflow.ts
│       ├── validation.ts
│       ├── progress.ts
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

### Package Manifest

`package.json` declares pi resources for extensions, skills, and prompts. The `agents/` directory is not a native pi package resource type and is discovered by the Brainstorming Pro extension itself.

```json
{
  "name": "brainstorming-pro",
  "keywords": ["pi-package"],
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "typebox": "*"
  },
  "pi": {
    "extensions": ["./extensions/clarification-orchestrator"],
    "skills": ["./skills"],
    "prompts": ["./prompts"]
  }
}
```

### Agent Definition Discovery

Brainstorming Pro does not rely on pi core to discover `agents/`. The orchestrator resolves bundled agent files relative to the package root.

Agent source priority:

1. **Bundled agents** from the package `agents/` directory. These are trusted as package code.
2. **User-level overrides** from `~/.pi/agent/brainstorming-pro/agents/*.md`, if enabled by config.
3. **Project-local overrides** from `.pi/brainstorming-pro/agents/*.md`, disabled by default and requiring explicit confirmation because they are repo-controlled.

Project-local agents must never silently override bundled or user-level agents. If enabled, the user must be shown which project-local agent files will run and what tools they request.

## Commands

### `/clarify`

```text
/clarify <topic> [--mode manual|hybrid|auto] [--max-rounds N] [--threshold P0|P1|P2|P3] [--reviewers list] [--resume] [--verbose] [--dry-run]
```

Default options:

```text
mode = hybrid
maxRounds = 2
threshold = P1
reviewers = product,architecture,risk,testing
verbose = false
dryRun = false
```

`threshold` controls which priorities require explicit handling. In hybrid mode, the default threshold is P1, meaning P0/P1 issues are shown for user confirmation while P2/P3 are summarized and deferred by default. Use “at or above threshold” semantics.

### `/clarify-status`

```text
/clarify-status <topic>
```

Displays current run, workflow phase, progress, completed artifacts, pending decisions, failures, and resume instructions.

### `/clarify-diff`

```text
/clarify-diff <topic> [<run1> <run2>]
```

Compares two clarification runs. If run IDs are omitted, compares the current run with the previous run. Shows:

- design.md differences;
- issues found in each run (new, removed, priority changes);
- decision differences;
- execution summary comparison (duration, cost, success rate).

### `/clarify-clean`

```text
/clarify-clean <topic> [--dry-run] [--keep N]
```

Cleans old clarification runs according to retention policy. By default uses config `artifacts.retention` settings. Options:

- `--dry-run`: show what would be deleted without actually deleting;
- `--keep N`: override config and keep the most recent N runs.

Protected runs (current run and most recent 2 runs) are never auto-deleted unless explicitly forced.

### Future Commands

The following are useful future additions but are not required for the core workflow:

- `/clarify-rollback <topic> <run-id>`: rollback to a previous run's design;
- `/clarify-replay <topic> <agent>`: replay a specific agent with saved inputs for debugging.

## Configuration

### Config Locations and Precedence

Configuration is JSON with a `version` field and is loaded from low to high precedence:

```text
1. bundled defaults inside package
2. ~/.pi/agent/brainstorming-pro/config.json
3. <project>/.pi/brainstorming-pro/config.json
4. <project>/.pi/brainstorming-pro/config.local.json
5. command-line arguments
```

Project-level config is repo-controlled and treated as untrusted input. Security-sensitive options from project config, such as enabling project-local agents or expanding tools, require explicit user confirmation unless allowed by user-level config.

### Config Shape

Configuration includes:

- `defaults`: mode, maxRounds, threshold;
- `reviewers`: enabled reviewers, disabled reviewers, custom reviewers, concurrency;
- `agents`: per-agent model, tools, timeout;
- `models`: default model and fallback models;
- `retry`: max attempts, backoff, retryable errors;
- `security`: project-local agent policy, debug artifact policy, redaction;
- `artifacts`: retention metadata and current run handling;
- `ui`: progress display and verbose defaults.

### Config Validation and Merge

- Use TypeBox schemas for runtime config validation.
- Invalid config produces actionable errors with the config path and failing field.
- Configuration merge is schema-aware:
  - scalar fields override;
  - object fields deep merge;
  - arrays default to replace unless the schema explicitly marks them as appendable;
  - reviewer sets are resolved by explicit enabled/disabled/custom rules;
  - command-line `--reviewers` replaces configured reviewer selection for that run.

## Topic and Path Safety

The user-facing topic and filesystem slug are separate.

- Preserve the original topic as display name in metadata.
- Generate a deterministic filesystem slug:
  - ASCII letters/numbers are lowercased and kebab-cased;
  - Unicode letters/numbers may be preserved if supported;
  - unsafe characters are removed;
  - path separators, `..`, absolute paths, and empty normalized names are rejected or replaced with `clarification-<timestamp>` after confirmation.
- Empty topic is rejected.
- Very long topics are truncated for slug generation while preserving the original title in metadata.

If `specs/<topic>/design.md` already exists:

- if a clarification run exists, ask whether to resume, create a new run, overwrite after confirmation, or abort;
- if no clarification run exists, ask whether to create a new run using the existing design as input, overwrite after confirmation, or abort.

## Artifact Store and Run Layout

Each `/clarify` execution creates an isolated run directory.

```text
specs/<topic>/
├── design.md
└── clarification/
    ├── current -> run-20260504-143022
    ├── current.json
    └── run-20260504-143022/
        ├── state.json
        ├── execution.log.json
        ├── execution.log.txt
        ├── 00-user-idea.md
        ├── 01-discovery.md
        ├── 02-design-v1.md
        ├── 03-review-r1.md
        ├── issues-r1.json
        ├── 04-triage-r1.md
        ├── triage-r1.json
        ├── 05-user-decisions-r1.md
        ├── decisions-r1.json
        ├── 06-design-v2.md
        ├── 07-verification-r1.md
        ├── verification-r1.json
        ├── decision-log.md
        ├── interrupted.md
        └── debug/
            ├── designer-input.md
            ├── designer-output.raw.md
            ├── reviewer-product-input.md
            └── reviewer-product-output.raw.md
```

Use a `current` symlink when supported. Always also write `current.json` with the active run ID as a portable fallback.

Markdown artifacts are for humans. JSON artifacts are canonical machine-readable state for orchestration.

### Workflow State

`state.json` records:

- topic display name and slug;
- run ID;
- current phase;
- mode, threshold, maxRounds, reviewers;
- round number and refinement attempts;
- completed artifacts;
- pending decisions;
- accepted/rejected/deferred issue IDs;
- verification status;
- unresolved P0/P1 items;
- whether final design is verified;
- errors and recovery actions;
- timestamps and execution summary.

`/clarify --resume` and `/clarify-status` use `state.json` and `current.json` rather than parsing markdown.

## Structured Schemas

All structured outputs are validated at runtime with TypeBox schemas. TypeScript types document expected shapes, but runtime schemas are canonical.

### Design Issue

```ts
type DesignIssue = {
  id: string;
  sourceReviewer?: string;
  sourceIssueIds?: string[];
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
  evidence: Evidence[];
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
  supersedes?: string[];
  duplicateOf?: string;
};
```

Issue IDs are stable within a run and generated by the orchestrator, for example:

```text
BP-R1-I001
BP-R1-I002
```

Reviewer-local issue IDs are preserved in `sourceIssueIds`.

### Evidence

```ts
type Evidence =
  | { type: "design-section"; section: string; quote: string }
  | { type: "artifact"; path: string; quote?: string }
  | { type: "repo-file"; path: string; lineStart?: number; lineEnd?: number; quote?: string };
```

Evidence must not be empty or a placeholder.

### User Decision

```ts
type UserDecision = {
  issueId: string;
  decision: "accept" | "reject" | "defer" | "needs-discussion";
  reason?: string;
};
```

`needs-discussion` is terminal only for the gate interaction, not the workflow. Before `REFINE`, all issues at or above threshold must resolve to `accept`, `reject`, or `defer`. Discussion notes are appended to `decision-log.md`.

### Verification Result

```ts
type VerificationResult = {
  issueId: string;
  status: "completed" | "partially-completed" | "missing" | "over-implemented";
  evidence: string;
  requiredFollowup?: string;
};
```

Every accepted issue must have a verification result.

## Components

### 1. `brainstorming-pro` pi package

Responsibilities:

- Bundle extension, skill, agents, and prompts.
- Provide a convenient installable unit.
- Declare pi package resources in `package.json`.
- Resolve bundled agent definitions itself.
- Allow future sharing through npm or git.

### 2. Clarification Orchestrator Extension

Responsibilities:

- Register `/clarify`, `/clarify-status`, `/clarify-diff`, and `/clarify-clean`.
- Parse command options.
- Load and validate config.
- Normalize and validate topic paths.
- Create spec/run directories.
- Spawn subagents using isolated pi processes.
- Collect, validate, and repair structured outputs.
- Persist markdown and JSON artifacts.
- Ask the user for decisions at gates.
- Report progress and status.
- Control retries, cancellation, iteration, and termination.
- Write final `design.md` and print spec-plan handoff instructions.
- Compare runs and manage artifact retention.

### 3. Subagent Runner

Responsibilities:

- Launch subagent tasks in isolated contexts.
- Pass controlled prompts and artifact content.
- Support sequential and parallel execution.
- Capture stdout/stderr and raw output.
- Validate final output against schemas.
- Propagate cancellation by terminating subprocesses.
- Enforce timeout, retry, and rate-limit backoff.
- Record usage metadata when available.

The runner follows the official pi subagent example approach: spawn separate `pi` subprocesses in JSON/print-compatible mode for each subagent invocation.

#### Subagent Execution Contract

Each subagent invocation defines:

- cwd;
- agent system prompt;
- task prompt;
- model selection and fallback;
- allowed tools;
- timeout;
- maximum output size;
- whether project-local resources are allowed;
- expected output schema;
- output repair prompt if validation fails.

Subagent subprocesses run with an environment marker:

```text
BRAINSTORMING_PRO_SUBAGENT=1
```

When this marker is present, Brainstorming Pro must avoid recursively starting orchestration for `/clarify`.

### 4. Agent Tool Permissions

Default tool policy:

| Agent | Tools |
|---|---|
| designer | read, find, grep, ls; limited bash only if configured |
| reviewers | read, find, grep, ls |
| triager | no project file tools by default; receives review JSON/artifacts as data |
| refiner | no direct write/edit; returns revised design and change log |
| verifier | read-only access to design/artifacts |
| orchestrator | file IO under `specs/<topic>/` |

If project config or custom agents request broader tools, user confirmation is required.

### 5. Reviewer Agents

Responsibilities:

- Review the current design from specialized perspectives.
- Produce structured issues only.
- Avoid rewriting the design directly.
- Distinguish current blockers from future improvements.
- Provide concrete evidence.

Initial reviewer set:

- `reviewer-product`: user goals, UX, scope, success criteria.
- `reviewer-architecture`: component boundaries, data flow, integration, maintainability.
- `reviewer-risk`: security, permissions, failure modes, operational risks.
- `reviewer-testing`: testability, acceptance criteria, edge cases.

### 6. Triager Agent

Responsibilities:

- Deduplicate reviewer issues.
- Assign stable issue IDs.
- Assign priority.
- Explain necessity, trade-offs, estimated cost, and recommended action.
- Identify conflicts and dependencies between issues.

Priority policy:

- **P0**: must fix now; current design cannot safely or correctly satisfy the core goal without it.
- **P1**: should fix now; not fatal, but likely to cause ambiguity, rework, or significant quality issues.
- **P2**: reasonable improvement but deferrable; useful for future extension or polish.
- **P3**: optional or likely overengineering; not recommended for current scope.

### 7. Refiner Agent

Responsibilities:

- Return revised `design.md` content according to accepted decisions.
- Preserve approved scope.
- Avoid implementing rejected or deferred items.
- Add deferred improvements only as clearly non-blocking future considerations when useful.
- Produce a concise change log mapping accepted issue IDs to design changes.

If there are accepted decisions, the refiner must either produce a changed design or explicitly explain why the existing design already satisfies each accepted issue. No-op refinement is valid only when every accepted issue is already covered and the verifier can confirm it.

### 8. Verifier Agent

Responsibilities:

- Compare accepted decisions against the refined design.
- Mark each accepted issue as completed, partially completed, missing, or over-implemented.
- Identify severe regressions introduced by refinement.
- Avoid reopening broad ideation unless a new P0/P1 regression appears.

Verifier failure can only be skipped with explicit user confirmation. If skipped, final design must be marked as unverified in `state.json` and `decision-log.md`, and final approval must clearly disclose the risk.

## Data Flow

### Primary `/clarify <topic>` Flow

1. User runs `/clarify <topic>` and optionally provides options.
2. Orchestrator loads config, validates options, normalizes topic, and resolves run directory.
3. Orchestrator records the original user idea in `00-user-idea.md` and `state.json`.
4. Designer agent performs initial discovery and produces `01-discovery.md` plus initial design content.
5. Orchestrator writes `design.md` and snapshots it as `02-design-v1.md`.
6. Reviewer agents independently review the design and produce structured findings.
7. Orchestrator validates reviewer outputs, repairs once if needed, writes raw/debug outputs, and writes `03-review-r1.md` plus reviewer JSON.
8. Triager agent deduplicates and prioritizes findings.
9. Orchestrator validates triage output, assigns stable IDs, and writes `04-triage-r1.md` plus `triage-r1.json`.
10. User Decision Gate asks the user which relevant items to accept, reject, defer, or discuss.
11. Orchestrator writes decisions to `05-user-decisions-r1.md`, `decisions-r1.json`, and `decision-log.md`.
12. Refiner agent returns revised design content and change log.
13. Orchestrator validates the refiner output, writes `design.md`, and snapshots it as `06-design-v2.md`.
14. Verifier agent checks accepted decisions against the refined design.
15. Orchestrator writes verification output to `07-verification-r1.md` and `verification-r1.json`.
16. If accepted P0/P1 items are missing and `maxRounds` is not reached, return to `REFINE`.
17. If `maxRounds` is reached with unresolved P0/P1 items, present unresolved risks and ask the user whether to accept current design, manually edit and re-verify, increase maxRounds, or abort.
18. Orchestrator asks for final user approval.
19. On approval, `design.md` becomes the final design for `spec-plan`, and the orchestrator prints explicit handoff instructions.

### Automation Modes

#### Manual Mode

- User reviews and decides every triaged issue at or above the configured threshold.
- Best for high-risk or product-sensitive changes.

#### Hybrid Mode

- Default mode.
- P0/P1 items are shown for user confirmation.
- P2/P3 items are deferred by default but visible in the summary.
- High-cost, low-confidence, conflicting, or scope-expanding items are always shown.

#### Auto Mode

- P0/P1 items are accepted automatically unless they are high-cost, low-confidence, conflicting, or scope-expanding.
- P2/P3 items are deferred automatically.
- User is interrupted only for conflicts, ambiguity, major scope changes, or safety-sensitive decisions.

### Non-interactive Behavior

If `ctx.hasUI === false`:

- manual and hybrid modes stop after triage, write `pending-decisions.md`, update `state.json`, and print resume instructions;
- auto mode may continue without UI, but must stop for conflicts, scope-expanding issues, or high-cost/low-confidence decisions;
- future scripted decision input can be added separately, but core behavior must never hang waiting for unavailable UI.

## User Decision Gate

The initial decision gate uses a markdown/numbered prompt compatible with interactive and RPC contexts. A custom TUI checklist is a future UX enhancement, not a dependency for the core workflow.

Example presentation:

```text
P0/P1 items:
[1] P0 - Missing security model
    Recommendation: accept
    Cost: medium
    Risk if ignored: ...

Choose for each item:
1=accept, 2=defer, 3=reject, 4=discuss
```

Decision notes are persisted in `decision-log.md`.

## Reliability and Error Handling

### Retry and Backoff

- Default max attempts: 3.
- Exponential backoff: 1s, 2s, 4s, capped by config.
- Retryable errors: transient process errors, API errors, rate limit errors.
- Non-retryable errors: user cancellation, invalid output after repair fails, unsafe path/config violations.

### Model Fallback

Model fallback is configuration-driven:

1. agent-specific configured model;
2. current pi model;
3. configured global fallback models that are available in `ctx.modelRegistry` and have API keys;
4. fail with an actionable error.

The actual model used is recorded in `execution.log.json`.

### Partial Failure Policy

- Designer failure: abort; workflow cannot continue without initial design.
- Reviewer phase:
  - at least 75% success: continue automatically and record failures;
  - 50-75% success: ask user whether to continue, retry failed reviewers, or abort;
  - below 50% success: stop and ask user to retry or abort.
- Triager failure: retry; if still failing, stop and preserve state.
- Refiner failure: retry; if still failing, preserve accepted decisions and ask the user whether to manually edit and resume or abort.
- Verifier failure: retry; if still failing, require explicit user confirmation to skip and mark final design as unverified.

### Invalid Structured Output

- Validate every structured output with TypeBox.
- On validation failure, run one repair prompt containing validation errors, raw output, and expected schema.
- If repair fails, save raw output to debug artifacts and stop or ask user according to phase policy.

### Cancellation

On user abort or Ctrl+C:

- stop active subagent subprocesses;
- terminate process groups where possible;
- write latest `state.json`;
- write `interrupted.md` with phase, completed artifacts, and resume instructions;
- preserve all completed artifacts.

### Edge Cases

- No reviewer issues: skip triage/decision/refinement and proceed to final approval.
- Empty triage result: same as no issues.
- All reviewers fail: ask user whether to retry, continue without review, or abort. Continuing without review must mark the design as unreviewed.
- Over-implementation: show verifier details and ask user whether to accept, re-refine, manually edit, or abort.
- Corrupted `state.json`: attempt recovery from JSON artifacts; if impossible, ask user whether to create a new run, manually repair, or abort.
- Artifact write failure: stop immediately and report the failed path; do not continue without durable state.
- Context too large: pass summarized artifacts and direct file paths instead of full history.

## Progress and User Control

The orchestrator reports:

- current phase;
- overall phase progress;
- reviewer status: pending/running/complete/failed;
- current activity description;
- completed artifacts;
- failures and recovery actions.

Verbose mode additionally shows:

- phase start/end;
- agent start/end;
- model used;
- token/cost metadata when available;
- artifact writes;
- retries and repair attempts.

Remaining time estimates are best-effort and not required for correctness.

## Observability and Debugging

### Execution Logs

Each run writes:

- `execution.log.json`: structured workflow execution log;
- `execution.log.txt`: human-readable summary.

The structured log includes:

- workflow metadata;
- phase timings and status;
- agent inputs/outputs metadata;
- retry and recovery actions;
- actual models used;
- token/cost metadata when available;
- final success/failure summary.

### Debug Artifacts

`debug/` stores agent inputs, raw outputs, parse failures, and prompt hashes.

Debug artifacts may contain sensitive project context. They are stored only under the project run directory, are never uploaded by the extension, and can be disabled or redacted through config.

### Dry Run

`--dry-run` generates planned phases, selected agents, generated prompts, models, tools, and estimated input sizes without invoking subagents. It writes prompts to the debug directory and validates config/path setup.

## Resource Management

- Reviewer agents run with bounded concurrency using a semaphore/queue.
- Designer, triager, refiner, and verifier run serially.
- Default reviewer concurrency is configurable, defaulting to 4.
- Rate limit errors trigger backoff and may reduce concurrency for the current run.
- The runner tracks child process IDs and cleans them up on completion, failure, or cancellation.
- Process timeouts are configurable per agent.
- Memory monitoring is best-effort. If reliable per-process memory data is unavailable on the host platform, the runner falls back to static concurrency limits.

## Trust Boundaries and Security

- Bundled package prompts and agents are trusted as package code.
- Project files are untrusted input.
- Project-local agents, prompts, skills, extensions, and config are untrusted by default.
- Subagent outputs are untrusted data, not instructions.
- The orchestrator passes prior agent outputs inside delimited data blocks and instructs downstream agents not to follow embedded instructions.
- Machine-readable JSON artifacts are schema validated before use.
- Security-sensitive project config changes require user confirmation.
- Refiner subagents do not directly write files.
- Topic slugs and artifact paths are guarded against path traversal.

## Output Quality Gates

### Reviewer Output Quality

- Schema validation.
- Required fields must be non-empty.
- Evidence must be concrete and non-placeholder.
- Duplicate issues from the same reviewer are filtered.
- Vague, non-actionable issues are rejected or downgraded by triage.

### Triager Output Quality

- No duplicate canonical issues.
- `dependsOn` and `conflictsWith` references must exist.
- P0 issues must use `must-fix-now` recommendation.
- High-cost + low-confidence issues cannot be P0 without explicit justification.

### Refiner Output Quality

- Change log must map accepted issue IDs to design changes or explicit no-op justification.
- Rejected/deferred issues must not be implemented as current requirements.
- Revised design must preserve template headings and scope boundaries.

### Verifier Output Quality

- Every accepted issue must have a verification result.
- Evidence must point to `design.md` content or explain why the issue is missing.
- New severe regressions must be explicitly identified.

## Testing

### Unit Tests

- Command option parsing for `/clarify`.
- Topic normalization and path safety.
- Config loading, merge, and validation.
- Agent discovery and source priority.
- Artifact path generation and run/current handling.
- Issue schema validation.
- Decision schema validation.
- Verification schema validation.
- Priority threshold filtering.
- Automation mode decision defaults.
- Termination condition evaluation.
- Retry/backoff classification.

### Integration Tests

- Run a mock `/clarify <topic>` workflow with fake subagent outputs.
- Verify artifacts are written in the expected order.
- Verify JSON artifacts are canonical state and markdown artifacts are summaries.
- Verify accepted decisions are passed to the refiner.
- Verify verifier failures trigger another refinement round when allowed.
- Verify `maxRounds` prevents infinite loops.
- Verify user abort preserves partial state and writes `interrupted.md`.
- Verify resume continues from saved `state.json`.
- Verify non-interactive manual/hybrid modes stop at pending decisions.
- Verify auto mode can continue without UI unless safety/conflict gates appear.
- Verify `/clarify-diff` correctly compares two runs.
- Verify `/clarify-clean` respects retention policy and protected runs.
- Verify multiple runs create isolated run directories with correct `current` tracking.

### Security Tests

- Topic path traversal is rejected.
- Project-local agents are disabled by default.
- Enabling project-local agents requires confirmation.
- Project config cannot silently expand trusted permissions.
- Subagent output containing malicious instructions is treated as data.
- Refiner cannot write outside orchestrator-controlled paths.
- Debug artifacts can be disabled/redacted.

### Subagent Runner Tests

- Timeout kills process.
- Cancellation kills process groups where possible.
- Invalid JSON triggers one repair pass.
- Repair failure saves raw output.
- stderr/stdout are captured.
- Unavailable model falls back according to config.
- Max output size is enforced and logged.
- Rate limit errors trigger backoff.

### Quality / Regression Tests

- Deterministic tests use mocked subagent outputs.
- Golden test fixtures cover known good and bad designs.
- Live-model evaluation may be run manually or in a non-blocking profile to monitor prompt quality over time.

### Manual / End-to-End Tests

- Simple request: confirm workflow does not add excessive ceremony.
- Complex request: confirm reviewers surface useful issues and triage is actionable.
- Hybrid mode: confirm P0/P1 user gate behavior.
- Auto mode: confirm low-risk requirements can proceed with minimal interruption.
- Project-local agents: confirm security prompt appears before execution.
- Interrupted run: confirm `/clarify --resume` works.

## Spec-Plan Handoff

After final approval, Brainstorming Pro does not automatically invoke `spec-plan` by default. It prints a clear next-step instruction containing:

- project/topic name;
- target directory `specs/<topic>/`;
- final design path;
- key decisions and unresolved risks, if any;
- whether the design is verified.

Example:

```text
Design approved: specs/<topic>/design.md
Next step: run spec-plan with target directory specs/<topic>/ and include decision-log.md as planning context.
```

## Open Questions

These questions are resolved for the core design:

- `/clarify` does not directly invoke the existing `brainstorming` skill. It uses its own designer agent prompt compatible with the methodology.
- Final approval does not automatically invoke `spec-plan` by default.
- Initial decision gate uses markdown/numbered prompts; custom TUI checklist is a future UX feature.
- Reviewer configuration supports bundled defaults, invocation overrides, user config, and guarded project config.
- Deferred P2/P3 items are canonical in JSON artifacts and `decision-log.md`; final `design.md` may include only concise future considerations when useful.
- Resume/status are core workflow capabilities.
- Artifact comparison and cleanup commands are core workflow capabilities.

Future feature questions:

- Whether to add background execution with notification on completion.
- Whether to add automatic `spec-plan` invocation as explicit opt-in.
- Whether to add rollback command for reverting to previous runs.
- Whether to add richer live-model prompt quality dashboards.
