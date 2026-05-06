# Requirements Document: Clarify Design Gate Loop

## Introduction

Clarify Design Gate Loop changes Brainstorming Pro from a topic-first automated clarification command into a request-first, human-gated design workflow. The primary user provides a natural-language requirement to `/clarify`, confirms or edits a generated topic, reviews each design version, optionally requests cross-review, decides every review issue, and explicitly approves the design for `/spec-plan` handoff.

The implementation is a TypeScript pi extension update inside `extensions/clarification-orchestrator/`, with package-owned prompt and skill resources under `prompts/` and `skills/`. This spec fully scopes the `/clarify` workflow redesign and only defines the lifecycle boundary for `/spec-plan` and `/spec-exec`; detailed planning and execution workflows remain out of scope.

## Glossary

- **Brainstorming Pro**: The pi package that provides structured, durable clarification artifacts and lifecycle handoff commands.
- **Clarification Orchestrator**: The extension that parses slash commands, manages workflow state, runs subagents, writes artifacts, and presents user gates.
- **Topic**: A kebab-case slug used as the stable artifact key under `specs/<topic>/`.
- **Request**: The user's natural-language requirement text passed to `/clarify` before topic generation.
- **Design Review Gate**: The user decision point after each complete design version with approve, review, revise, and save actions.
- **Issue Decision Gate**: The user decision point for triaged cross-review issues.
- **Lifecycle Skills**: Package-owned skills named `brainstorming-pro`, `spec-plan-pro`, and `spec-exec-pro`.
- **Methodology Resource**: A markdown prompt resource that holds reusable lifecycle behavior outside TypeScript orchestration code.
- **Resume Status**: A user-facing persisted status that routes `/clarify --resume` to the correct pending gate or recovery flow.
- **Run Metadata**: Canonical JSON metadata for a clarification run, including topic, current phase, latest version, active round, pending decisions, progress, and methodology versions.

## Requirements

### Requirement 1: Request-First `/clarify` Parsing

**User Story:** As a product owner, I want `/clarify` to accept my natural-language requirement instead of forcing me to invent a topic first, so that the system can clarify the real problem before creating artifacts.

#### Acceptance Criteria

1. WHEN a user runs `/clarify <request>`, THEN the system SHALL store the full non-option text as `request` rather than `topic`.
2. WHEN a user runs `/clarify <request> --verbose` or `/clarify <request> --dry-run`, THEN the system SHALL preserve the natural-language request and parse only supported options.
3. WHEN a user runs `/clarify --resume`, THEN the system SHALL resume a pending clarification run without requiring request text.
4. IF a user runs `/clarify` without request text and without `--resume`, THEN the system SHALL return usage guidance for `/clarify <request> [--verbose] [--dry-run]` and `/clarify --resume`.
5. IF a user passes removed options such as `--mode`, `--threshold`, `--max-rounds`, or `--reviewers`, THEN the system SHALL reject the command with a clear unknown-option or removed-option error.
6. WHEN request text contains spaces, quotes, Chinese text, or punctuation, THEN the parser SHALL preserve the intended request content without requiring manual topic quoting beyond existing shell-style tokenization rules.

### Requirement 2: Topic Proposal and Confirmation

**User Story:** As a user, I want the system to propose safe, meaningful topic slugs from my request, so that artifacts are organized without requiring me to choose a topic before clarification.

#### Acceptance Criteria

1. WHEN `/clarify <request>` starts a new run, THEN the system SHALL generate 2-3 concise kebab-case topic candidates before creating `specs/<topic>/` artifacts.
2. WHEN generated candidates are shown, THEN each candidate SHALL include enough display metadata for the user to understand the source phrase and meaning.
3. WHEN the request language is Chinese or another non-English language and the candidate slug is English, THEN the system SHALL include translation or gloss metadata for user verification.
4. WHEN existing spec topics are present, THEN the system SHALL detect exact conflicts and semantic near-duplicates and present reuse/edit choices instead of silently creating a duplicate.
5. IF all generated candidates are weak, generic, unsafe, or duplicate existing topics, THEN the system SHALL ask the user to provide or edit a topic manually.
6. IF the user edits or provides a topic, THEN the system SHALL validate it with path safety rules before path resolution.
7. WHEN a topic is confirmed, THEN the system SHALL create or reuse the run context only after explicit user confirmation.

### Requirement 3: Safe Artifact Layout and Run Metadata

**User Story:** As a user resuming or auditing clarification work, I want durable artifacts and metadata organized by topic, run, design version, and review round, so that progress and decisions are recoverable.

#### Acceptance Criteria

1. WHEN a run starts after topic confirmation, THEN the system SHALL create artifacts under `specs/<topic>/clarification/<run-id>/` and keep the latest public design at `specs/<topic>/design.md`.
2. WHEN a complete design version is produced, THEN the system SHALL store an immutable snapshot under `versions/v<N>/design.md` and mirror it to top-level `design.md`.
3. WHEN review rounds run, THEN the system SHALL store review, triage, decisions, and refine artifacts under `reviews/round-<N>/` instead of mixing them with design version directories.
4. WHEN metadata is written, THEN it SHALL include run ID, topic or pending topic context, request summary, current phase, resume status, latest version, active round, pending decisions, last update time, and resume hint.
5. WHEN methodology resources are used, THEN metadata or approval artifacts SHALL record the relevant methodology versions, including `brainstorming-pro-v1`, `spec-plan-pro-v1`, and `spec-exec-pro-v1` recommendations.
6. IF artifact writes target paths outside the topic spec directory or current run directory, THEN the system SHALL reject the write.

### Requirement 4: Package-Owned Brainstorming Methodology

**User Story:** As a maintainer, I want `/clarify` and the bundled `brainstorming-pro` skill to share one canonical methodology resource, so that behavior does not drift between command and skill implementations.

#### Acceptance Criteria

1. WHEN V0 brainstorming runs, THEN it SHALL load or reference a package-owned markdown methodology resource rather than embedding the full methodology in TypeScript.
2. WHEN `clarify-v0.md` is built, THEN it SHALL include clarify-specific constraints to write `versions/v0/design.md`, stop at the design review gate, and not invoke `/spec-plan`.
3. WHEN the package declares lifecycle skills, THEN it SHALL include package-owned `brainstorming-pro`, `spec-plan-pro`, and `spec-exec-pro` skill resources or equivalent package-scoped resources.
4. IF an external global `brainstorming` skill is unavailable or divergent, THEN Brainstorming Pro SHALL continue using its package-owned canonical methodology.
5. WHEN methodology resources change, THEN tests or validation SHALL detect missing references and prevent divergent TypeScript prompt copies.

### Requirement 5: V0 Design Generation and Conversational Revision

**User Story:** As a clarifying agent, I want a structured process for producing and revising design versions, so that each user-reviewed version is complete and traceable.

#### Acceptance Criteria

1. WHEN V0 brainstorming begins, THEN the system SHALL inspect enough project context to describe purpose, stack, and structure before drafting the design.
2. WHEN the request is ambiguous, THEN the system SHALL ask focused questions one at a time or record explicit assumptions before producing the design.
3. WHEN a non-trivial change is requested, THEN the system SHALL surface at least one assumption and one potential blind spot in the design discovery context.
4. WHEN conversational revision occurs, THEN the system SHALL classify feedback as wording/detail, clarification, scope/approach, or review-worthy major revision.
5. WHEN a revision changes design content, THEN the system SHALL increment the integer version sequence and write the new complete design snapshot.
6. WHEN discussion produces no design change, THEN the system SHALL keep the current version and return to the design review gate.
7. IF a revision is scope-changing or review-worthy, THEN the system SHALL record the reason and recommend cross-review at the next design gate without launching subagents automatically.

### Requirement 6: Design Review Gate Loop

**User Story:** As a product owner, I want every design version to pause at the same clear gate, so that I decide whether to approve, review, revise, or save progress.

#### Acceptance Criteria

1. WHEN V0 or any later design version is complete, THEN the system SHALL present the design review gate with approve, review, revise, and save actions.
2. WHEN the gate is shown, THEN it SHALL display current version, design path, latest change summary, unresolved open questions, pending blockers, and allowed actions.
3. WHEN the user chooses approve, THEN the system SHALL write final approval and complete the run without automatically invoking `/spec-plan`.
4. WHEN the user chooses review, THEN the system SHALL run a cross-review round and return to the design review gate after refinement.
5. WHEN the user chooses revise, THEN the system SHALL perform conversational revision and return to the design review gate after any completed update.
6. WHEN the user chooses save, THEN the system SHALL persist the current gate decision, mark the run resumable, and not treat the design as approved.
7. IF unresolved discussed issues exist, THEN approve SHALL be blocked until each pending issue is accepted, rejected, or deferred.

### Requirement 7: Cross-Review, Triage, and Issue Decisions

**User Story:** As a product owner, I want optional independent review while keeping explicit control over all findings, so that refinement applies only changes I accept.

#### Acceptance Criteria

1. WHEN the user chooses cross-review, THEN the system SHALL run the bundled default reviewers for product, architecture, risk, and testing perspectives.
2. WHEN reviewer work starts or progresses, THEN the system SHALL persist progress snapshots and emit concise user-facing progress updates.
3. WHEN a reviewer fails transiently, THEN the system SHALL retry at most once automatically and record the failure details.
4. WHEN fewer than 3 of 4 default reviewers succeed, THEN the system SHALL pause before triage because reviewer quorum is not met.
5. WHEN triage completes, THEN every triaged P0, P1, P2, and P3 issue SHALL enter the issue decision gate by default.
6. WHEN the user decides issues, THEN only accepted issue IDs SHALL be passed to the refiner.
7. WHEN issues are rejected, deferred, or discussed, THEN the system SHALL record those decisions for traceability.
8. IF any active-round issue remains `discuss` or `needs-discussion`, THEN the system SHALL block `REFINE` and resume at the issue decision gate.
9. IF the refiner fails or produces invalid output, THEN the system SHALL not overwrite the latest design.

### Requirement 8: Resume and Recovery

**User Story:** As a user, I want `/clarify --resume` to return me to the exact pending decision or recovery point, so that interrupted clarification work is not lost.

#### Acceptance Criteria

1. WHEN `/clarify --resume` finds one resumable run, THEN the system SHALL route directly to the saved resume status.
2. WHEN multiple resumable runs exist, THEN the system SHALL prompt the user to choose using topic/request summary, status, latest version, active round, and last update time.
3. WHEN resume status is `awaiting-topic-confirmation`, THEN the system SHALL show saved request, topic candidates, similar-topic warnings, and topic choices.
4. WHEN resume status is `awaiting-design-gate-decision`, THEN the system SHALL show the latest design version and the normal design gate actions.
5. WHEN resume status is `awaiting-issue-decisions`, THEN the system SHALL show unresolved issue decisions, especially blocking discussed issues.
6. WHEN resume status is `in-cross-review`, THEN the system SHALL show latest progress, completed artifacts, failed/active agents, and recovery choices.
7. WHEN resume status is `completed`, THEN the system SHALL not resume by default and SHALL show final design and final approval paths.
8. IF a run failed recoverably, THEN the system SHALL show failure summary, last safe phase, and recovery choices without corrupting existing artifacts.

### Requirement 9: Lifecycle Command Boundary and Handoff

**User Story:** As a user moving from clarification to planning and execution, I want explicit commands and boundaries, so that design, planning, and implementation remain user-approved stages.

#### Acceptance Criteria

1. WHEN `/clarify` completes final approval, THEN it SHALL print `/spec-plan <topic>` as the next command and include approved design, clarification artifact, and final approval paths.
2. WHEN final approval is written, THEN it SHALL record recommended lifecycle methodology versions for `spec-plan-pro` and `spec-exec-pro`.
3. WHEN Brainstorming Pro registers lifecycle commands, THEN `/spec-plan` SHALL map to `spec-plan-pro` and `/spec-exec` SHALL map to `spec-exec-pro` at the boundary level.
4. WHEN `/spec-plan <topic>` is invoked without an approved `design.md` context, THEN it SHALL fail or pause with clear guidance instead of inventing scope.
5. WHEN `/spec-exec <topic>` is invoked without user-approved `requirements.md` and `tasks.md`, THEN it SHALL refuse to run and explain that planning must be completed first.
6. IF `/spec-plan` discovers missing design context or scope ambiguity, THEN it SHALL route the user back to `/clarify` or request design revision.
7. IF `/spec-exec` discovers scope changes, THEN it SHALL pause and route the user back to `/spec-plan` or `/clarify`.

### Requirement 10: Non-Interactive and Security Behavior

**User Story:** As a maintainer, I want unsafe or non-interactive scenarios to fail predictably, so that the workflow does not bypass user gates or write outside allowed paths.

#### Acceptance Criteria

1. WHEN non-dry-run `/clarify` runs without interactive UI, THEN the system SHALL fail fast because topic confirmation and gates require user input.
2. WHEN `/clarify <request> --dry-run` runs without interactive UI, THEN it MAY validate input and write or print planned workflow/debug artifacts without launching subagents.
3. WHEN project-local agents or security-sensitive project config are detected, THEN the system SHALL require explicit confirmation according to existing trust rules.
4. WHEN reviewer, triager, refiner, or prior artifact output is passed downstream, THEN prompts SHALL delimit it as untrusted data.
5. IF generated or user-edited topics include traversal, absolute paths, control characters, or unsafe characters, THEN the system SHALL reject them before artifact creation.
6. IF malicious subagent output attempts arbitrary file writes or instruction injection, THEN the orchestrator SHALL ignore those instructions and only write validated artifacts through controlled APIs.

### Requirement 11: Documentation and Compatibility

**User Story:** As a package user, I want README and package metadata to reflect the new command model, so that command usage matches implemented behavior.

#### Acceptance Criteria

1. WHEN documentation describes `/clarify`, THEN it SHALL show `/clarify <request>` rather than `/clarify <topic>`.
2. WHEN documentation lists public `/clarify` options, THEN it SHALL include only `--resume`, `--verbose`, and `--dry-run`.
3. WHEN documentation describes lifecycle progression, THEN it SHALL show `/clarify -> /spec-plan -> /spec-exec` with explicit user gates between stages.
4. WHEN README or skill docs mention removed options, THEN they SHALL either remove them or describe them as no longer supported for `/clarify`.
5. WHEN package validation checks commands and skills, THEN it SHALL include the new package-owned lifecycle skill resources and command registrations.
