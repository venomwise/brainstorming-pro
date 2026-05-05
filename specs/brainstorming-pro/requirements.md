# Requirements Document: Brainstorming Pro

## Introduction

Brainstorming Pro is a pi package that provides a `/clarify <topic>` command for complex requirement clarification. It orchestrates isolated subagents to create an initial design, review it from multiple perspectives, triage findings, collect user decisions, refine the design, verify accepted changes, and persist the full process as durable artifacts. The package is intended for product owners and coding-agent users who need a repeatable, recoverable, and auditable design workflow before handing work off to `spec-plan` and implementation.

The system boundary includes the pi extension, bundled skill/prompt/agent resources, configuration loading, subprocess-based subagent execution, artifact/state management, structured validation, user decision gates, status/resume, run comparison/cleanup, observability, and tests. It does not implement coding tasks, replace the lightweight `brainstorming` skill for simple requests, run as a background daemon, provide a custom TUI checklist, automatically invoke `spec-plan`, or provide rollback/replay commands as part of the core workflow.

## Glossary

- **Brainstorming Pro**: The pi package containing the clarification orchestrator extension, bundled agents, prompts, and skill resources.
- **Clarification Orchestrator**: The pi extension that registers commands, owns workflow state, launches subagents, validates output, writes artifacts, and controls user gates.
- **Subagent**: An isolated `pi` subprocess running a specialized prompt and tool/model configuration for designer, reviewer, triager, refiner, or verifier work.
- **Designer Agent**: The subagent that performs discovery and produces the initial design content.
- **Reviewer Agent**: A subagent that inspects the design from one specialized perspective and emits structured issues.
- **Triager Agent**: The subagent that deduplicates reviewer issues, assigns priorities, and recommends decisions.
- **Refiner Agent**: The subagent that returns revised design content and a change log for accepted decisions.
- **Verifier Agent**: The subagent that checks whether accepted decisions are represented in the refined design.
- **Run**: One `/clarify` execution stored under `specs/<topic>/clarification/<run-id>/`.
- **Artifact**: A human-readable markdown file or machine-readable JSON file produced during a run.
- **Workflow State**: The canonical `state.json` file used for status, resume, termination decisions, and recovery.
- **Decision Gate**: The user interaction step where triaged issues are accepted, rejected, deferred, or discussed.
- **Issue Severity**: P0/P1/P2/P3 priority assigned by triage, where P0 is must-fix-now and P3 is optional or overengineering.
- **Trusted Resource**: Bundled package code, prompts, and agents reviewed by the user before installation.
- **Untrusted Input**: Project files, project-local config, project-local agents/prompts/skills/extensions, and subagent outputs.
- **TypeBox Schema**: Runtime schema definitions used to validate config and structured LLM outputs.

## Requirements

### Requirement 1: Pi Package Resource Loading

**User Story:** As a pi user, I want Brainstorming Pro to install as a coherent pi package, so that its extension, skill, prompts, and bundled agents are available without manual wiring.

#### Acceptance Criteria

1. WHEN the package is installed through pi package mechanisms, THEN the system SHALL expose the clarification orchestrator extension, `brainstorming-pro` skill, and bundled prompt resources according to the package manifest.
2. WHEN the extension starts, THEN the system SHALL discover bundled agent markdown files relative to the package root instead of relying on pi core to discover `agents/`.
3. WHEN user-level agent overrides are enabled, THEN the system SHALL load them from `~/.pi/agent/brainstorming-pro/agents/*.md` with clear provenance metadata.
4. WHEN project-local agent overrides exist, THEN the system SHALL keep them disabled by default and require explicit confirmation before loading them.
5. IF multiple agent definitions share a name, THEN the system SHALL resolve them by the documented priority order and report which source was selected.
6. IF required bundled resources are missing or invalid, THEN the system SHALL fail startup or command execution with an actionable error naming the missing path.

### Requirement 2: Command Registration and Option Parsing

**User Story:** As a user, I want clear slash commands and options, so that I can run, inspect, resume, compare, and clean clarification workflows predictably.

#### Acceptance Criteria

1. WHEN Brainstorming Pro loads, THEN the system SHALL register `/clarify`, `/clarify-status`, `/clarify-diff`, and `/clarify-clean` commands.
2. WHEN `/clarify <topic>` is invoked without options, THEN the system SHALL use default mode `hybrid`, `maxRounds = 2`, `threshold = P1`, and reviewers `product,architecture,risk,testing`.
3. WHEN `/clarify` receives options, THEN the system SHALL parse and validate `--mode`, `--max-rounds`, `--threshold`, `--reviewers`, `--resume`, `--verbose`, and `--dry-run`.
4. IF an unknown option, invalid enum value, invalid number, or missing topic is provided, THEN the system SHALL stop before writing workflow artifacts and show a clear validation error.
5. WHEN `/clarify-status <topic>` is invoked, THEN the system SHALL show the current run, phase, progress, completed artifacts, pending decisions, failures, and resume instructions.
6. WHEN `/clarify-diff <topic>` is invoked without run IDs, THEN the system SHALL compare the current run with the previous run if both exist.
7. WHEN `/clarify-clean <topic> --dry-run` is invoked, THEN the system SHALL report candidate deletions without deleting files.

### Requirement 3: Configuration Loading and Validation

**User Story:** As a user, I want Brainstorming Pro to be configurable at package, user, project, local, and invocation levels, so that I can adapt models, reviewers, retries, artifacts, and security without editing TypeScript.

#### Acceptance Criteria

1. WHEN a command starts, THEN the system SHALL load config from bundled defaults, user config, project config, project local config, and command options in documented precedence order.
2. WHEN config objects are merged, THEN the system SHALL deep-merge objects, override scalar fields, use schema-aware array behavior, and let command-line `--reviewers` replace reviewer selection for that run.
3. WHEN config is loaded, THEN the system SHALL validate it with TypeBox schemas before using it.
4. IF config validation fails, THEN the system SHALL report the config file path, field path, expected shape, and invalid value when safe to display.
5. WHEN project-level config requests security-sensitive changes, THEN the system SHALL require explicit user confirmation unless a user-level config explicitly permits the change.
6. WHEN no config files exist beyond bundled defaults, THEN the system SHALL run with safe documented defaults.

### Requirement 4: Topic Normalization and Path Safety

**User Story:** As a user, I want topic names converted to safe spec directories, so that clarification artifacts are written only to intended locations.

#### Acceptance Criteria

1. WHEN a topic is provided, THEN the system SHALL preserve the original display name in metadata and derive a deterministic filesystem slug.
2. WHEN a topic contains ASCII words, whitespace, or punctuation, THEN the system SHALL normalize it to a lower-case kebab-case slug with unsafe characters removed.
3. WHEN a topic contains Unicode letters or numbers, THEN the system SHALL preserve safe Unicode characters when supported and store the original title in metadata.
4. IF the topic is empty, resolves to an empty slug, contains path separators, contains `..`, or is an absolute path, THEN the system SHALL reject it or require explicit confirmation for a generated fallback slug before writing files.
5. WHEN a normalized topic is too long for practical path use, THEN the system SHALL truncate the slug safely while preserving the full original topic in metadata.
6. WHEN `specs/<topic>/design.md` already exists, THEN the system SHALL ask whether to resume an existing run, create a new run, use the existing design as input, overwrite after confirmation, or abort according to available artifacts.

### Requirement 5: Artifact Store, Run Layout, and State

**User Story:** As a user, I want every clarification run to produce durable and machine-readable artifacts, so that work can be inspected, resumed, compared, and used as planning context.

#### Acceptance Criteria

1. WHEN a new clarification starts, THEN the system SHALL create an isolated run directory under `specs/<topic>/clarification/run-<timestamp>/`.
2. WHEN a run is selected or created, THEN the system SHALL update `current.json` and, when supported, a `current` symlink pointing to the active run.
3. WHEN each phase completes, THEN the system SHALL write human-readable markdown artifacts and canonical JSON artifacts for machine use.
4. WHEN workflow state changes, THEN the system SHALL update `state.json` with topic metadata, run ID, phase, options, rounds, decisions, verification status, errors, artifacts, and timestamps.
5. IF artifact writing fails, THEN the system SHALL stop immediately and not continue without durable state.
6. WHEN debug artifacts are enabled, THEN the system SHALL store raw inputs/outputs under the run `debug/` directory and apply configured redaction/disable rules.
7. WHEN multiple runs exist, THEN the system SHALL keep them isolated and never mix JSON state, debug output, or decision logs across runs.

### Requirement 6: Subagent Execution and Tool Boundaries

**User Story:** As a user, I want subagents to run in isolated, permission-bounded contexts, so that independent review benefits do not compromise project safety.

#### Acceptance Criteria

1. WHEN a subagent task starts, THEN the system SHALL launch an isolated `pi` subprocess with controlled cwd, prompt, model, tools, timeout, output limit, and expected schema.
2. WHEN launching a subagent, THEN the system SHALL set `BRAINSTORMING_PRO_SUBAGENT=1` to prevent recursive orchestration.
3. WHEN default agents run, THEN the system SHALL enforce role-appropriate tool policies: read-oriented tools for designer/reviewers/verifier, data-only behavior for triager, and no direct write/edit for refiner.
4. WHEN a custom or project-local agent requests broader tools, THEN the system SHALL require explicit user confirmation before allowing them.
5. WHEN a subagent produces stdout, stderr, raw output, usage metadata, or errors, THEN the system SHALL capture them in execution logs and debug artifacts according to config.
6. IF a subagent exceeds timeout or output limits, THEN the system SHALL terminate it, record the failure, and follow the phase-specific failure policy.

### Requirement 7: Clarification Workflow Orchestration

**User Story:** As a product owner, I want a structured clarification workflow, so that complex feature ideas become reviewed and verified design documents.

#### Acceptance Criteria

1. WHEN `/clarify <topic>` runs normally, THEN the system SHALL execute INIT, DISCOVERY, INITIAL_DESIGN, REVIEW, TRIAGE, USER_DECISION, REFINE, VERIFY, FINAL_APPROVAL, and COMPLETE phases in order.
2. WHEN the designer succeeds, THEN the system SHALL write discovery notes, initial `design.md`, and an initial design snapshot.
3. WHEN reviewers succeed, THEN the system SHALL collect independent findings without allowing reviewers to rewrite the design directly.
4. WHEN triage completes, THEN the system SHALL deduplicate issues, assign stable issue IDs, severity, cost, confidence, recommendation, dependencies, conflicts, and evidence.
5. WHEN decisions are accepted, rejected, or deferred, THEN the system SHALL pass only accepted decisions to refinement and record all decisions in the decision log.
6. WHEN refinement completes, THEN the orchestrator SHALL validate and write revised design content instead of allowing the refiner to write arbitrary files.
7. WHEN verification completes, THEN the system SHALL mark each accepted issue as completed, partially completed, missing, or over-implemented.
8. WHEN verification finds missing accepted P0/P1 items and `maxRounds` remains, THEN the system SHALL return to targeted REFINE rather than reopen broad review by default.
9. WHEN `maxRounds` is reached with unresolved P0/P1 items, THEN the system SHALL present unresolved risks and ask the user whether to accept, manually edit and re-verify, increase maxRounds, or abort.

### Requirement 8: Structured Output Schemas and Quality Gates

**User Story:** As a maintainer, I want all LLM-produced structured data validated, so that orchestration does not depend on fragile markdown parsing or low-quality outputs.

#### Acceptance Criteria

1. WHEN config, reviewer issues, triage results, user decisions, refiner output, or verification results are consumed, THEN the system SHALL validate them with TypeBox runtime schemas.
2. WHEN an issue is canonicalized, THEN the system SHALL assign a stable run-local ID such as `BP-R1-I001` and preserve reviewer-local source IDs.
3. WHEN evidence is provided, THEN the system SHALL require concrete non-placeholder evidence from design sections, artifacts, or repo files.
4. WHEN triage references dependencies or conflicts, THEN the system SHALL verify referenced issue IDs exist.
5. WHEN triage labels an issue P0, THEN the system SHALL require a `must-fix-now` recommendation or explicit justification.
6. WHEN refiner output is accepted, THEN the system SHALL require a change log mapping accepted issue IDs to design changes or explicit no-op justification.
7. WHEN verifier output is accepted, THEN the system SHALL require one verification result for every accepted issue.
8. IF structured output validation fails, THEN the system SHALL attempt one repair pass with validation errors, raw output, and expected schema before applying phase-specific failure handling.

### Requirement 9: User Decision Gates and Automation Modes

**User Story:** As a product owner, I want automation levels and explicit decision gates, so that I can control scope without reviewing every low-value suggestion manually.

#### Acceptance Criteria

1. WHEN manual mode is used, THEN the system SHALL ask the user to decide every triaged issue at or above the configured threshold.
2. WHEN hybrid mode is used, THEN the system SHALL show P0/P1 items by default, summarize P2/P3 items as deferred, and always surface high-cost, low-confidence, conflicting, or scope-expanding items.
3. WHEN auto mode is used, THEN the system SHALL auto-accept low-risk P0/P1 items, auto-defer P2/P3 items, and interrupt the user for conflicts, ambiguity, major scope changes, or safety-sensitive decisions.
4. WHEN a decision is marked `needs-discussion`, THEN the system SHALL keep the workflow at the decision gate until the issue is resolved to accept, reject, or defer.
5. WHEN `ctx.hasUI === false` in manual or hybrid mode, THEN the system SHALL stop after triage, write pending decisions, update state, and print resume instructions.
6. WHEN `ctx.hasUI === false` in auto mode, THEN the system SHALL continue only while no conflict, scope expansion, or high-cost/low-confidence gate requires user input.
7. WHEN final approval is requested, THEN the system SHALL disclose verification status, unresolved risks, skipped phases, and whether the design is marked reviewed/verified.

### Requirement 10: Reliability, Recovery, and Resume

**User Story:** As a user, I want long-running clarification workflows to survive transient failures and interruptions, so that I do not lose design progress.

#### Acceptance Criteria

1. WHEN a retryable process, API, or rate-limit error occurs, THEN the system SHALL retry up to the configured attempt limit with exponential backoff.
2. WHEN a requested model is unavailable, THEN the system SHALL use the configured model fallback order and record the actual model used.
3. WHEN designer failure persists, THEN the system SHALL abort because no workflow can continue without an initial design.
4. WHEN reviewer failures are partial, THEN the system SHALL apply the documented success-ratio policy and preserve failed reviewer information.
5. WHEN triager, refiner, or verifier failure persists, THEN the system SHALL preserve state and apply phase-specific stop/confirm behavior.
6. WHEN the user cancels or Ctrl+C is received, THEN the system SHALL terminate active subagents, write `state.json`, write `interrupted.md`, and preserve completed artifacts.
7. WHEN `/clarify <topic> --resume` is invoked, THEN the system SHALL load `current.json` and `state.json` and continue from the last recoverable phase.
8. IF `state.json` is corrupted, THEN the system SHALL attempt recovery from JSON artifacts and otherwise ask whether to create a new run, manually repair, or abort.

### Requirement 11: Progress, Observability, and Debugging

**User Story:** As a user and maintainer, I want progress feedback and execution logs, so that I can understand long workflows, debug failures, and inspect costs and outputs.

#### Acceptance Criteria

1. WHEN a workflow runs, THEN the system SHALL report current phase, overall progress, reviewer status, current activity, completed artifacts, and recovery actions.
2. WHEN verbose mode is enabled, THEN the system SHALL show phase start/end, agent start/end, model used, artifact writes, retries, repair attempts, and usage metadata when available.
3. WHEN a run executes, THEN the system SHALL write `execution.log.json` and `execution.log.txt`.
4. WHEN debug artifacts are enabled, THEN the system SHALL write subagent inputs, raw outputs, parse failures, and prompt hashes under the run `debug/` directory.
5. WHEN debug artifacts may contain sensitive project context, THEN the system SHALL support config-based disablement or redaction and SHALL never upload artifacts itself.
6. WHEN `--dry-run` is used, THEN the system SHALL validate config/path setup and generate planned phases, prompts, selected agents, tools, models, and estimated input sizes without invoking subagents.

### Requirement 12: Run Comparison and Cleanup

**User Story:** As a user, I want to compare and clean clarification runs, so that repeated clarification work remains manageable and auditable.

#### Acceptance Criteria

1. WHEN `/clarify-diff <topic> <run1> <run2>` is invoked, THEN the system SHALL compare design content, issues, decisions, and execution summaries for the selected runs.
2. WHEN `/clarify-diff <topic>` is invoked without run IDs, THEN the system SHALL compare current and previous runs if both are available.
3. IF requested runs are missing, corrupted, or not comparable, THEN the system SHALL report which run or artifact is unavailable.
4. WHEN `/clarify-clean <topic>` is invoked, THEN the system SHALL apply configured retention rules while protecting the current run and the most recent two runs.
5. WHEN `/clarify-clean <topic> --dry-run` is invoked, THEN the system SHALL list planned deletions without deleting anything.
6. IF deletion fails for any run, THEN the system SHALL report the failed path and continue only with remaining safe deletions.

### Requirement 13: Security and Trust Boundaries

**User Story:** As a user, I want Brainstorming Pro to treat repository-controlled content as untrusted, so that clarification workflows do not silently execute unsafe instructions or expand permissions.

#### Acceptance Criteria

1. WHEN project files, project-local config, project-local agents, or subagent outputs are read, THEN the system SHALL treat them as untrusted input.
2. WHEN downstream agents receive prior agent outputs, THEN the system SHALL pass them as delimited data and instruct agents not to follow embedded instructions.
3. WHEN project-local agents, prompts, skills, extensions, or security-sensitive config are requested, THEN the system SHALL require explicit user confirmation unless trusted by user-level config.
4. WHEN artifact paths are generated, THEN the system SHALL constrain writes to the intended `specs/<topic>/` tree.
5. WHEN refiner output is applied, THEN the orchestrator SHALL validate and write only expected design artifacts.
6. WHEN debug artifacts are written, THEN the system SHALL follow redaction/disable settings for sensitive context.

### Requirement 14: Spec-Plan Handoff

**User Story:** As a user, I want final approved designs to hand off cleanly to `spec-plan`, so that implementation planning starts with the right context and without accidental automation.

#### Acceptance Criteria

1. WHEN final approval succeeds, THEN the system SHALL leave the final approved design at `specs/<topic>/design.md`.
2. WHEN final approval succeeds, THEN the system SHALL print a clear next-step instruction for running `spec-plan` with the target directory and relevant artifacts.
3. WHEN unresolved risks, skipped phases, or unverified status exist, THEN the system SHALL include them in the handoff summary.
4. WHEN final approval succeeds, THEN the system SHALL not automatically invoke `spec-plan` by default.
5. IF automatic `spec-plan` invocation is added in the future, THEN it SHALL be explicit opt-in and SHALL verify that the relevant skill command is available before sending a follow-up message.

### Requirement 15: Testing and Quality Assurance

**User Story:** As a maintainer, I want comprehensive deterministic tests around the orchestrator and schemas, so that the workflow remains reliable despite LLM variability.

#### Acceptance Criteria

1. WHEN unit tests run, THEN they SHALL cover command parsing, config merge/validation, topic safety, schemas, artifact paths, thresholds, automation defaults, and termination conditions.
2. WHEN integration tests run, THEN they SHALL use mocked subagent outputs to exercise the full workflow deterministically.
3. WHEN security tests run, THEN they SHALL cover path traversal, project-local resource confirmation, permission expansion, prompt injection-as-data handling, and debug redaction.
4. WHEN subagent runner tests run, THEN they SHALL cover timeout, cancellation, repair pass, stdout/stderr capture, model fallback, output limits, and rate-limit backoff.
5. WHEN quality fixtures run, THEN they SHALL validate known good and bad design scenarios using deterministic mocked outputs.
6. WHEN live-model prompt evaluation is performed, THEN it SHALL be manual or non-blocking and SHALL not be required for deterministic CI success.
