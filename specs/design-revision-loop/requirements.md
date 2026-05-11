# Requirements Document: Design Revision Loop

## Introduction

Design Revision Loop adds a runtime-owned bridge from design review findings to revised `design.md` artifacts. It consumes version-bound design review and triage outputs, records a single-use user authorization, runs a controlled package-owned design reviser, commits a new design artifact version only through the runtime artifact store, and immediately performs one re-review of the revised design before returning control to the user.

The system serves workflow users, maintainers, reviser role implementers, security reviewers, and future UX/TUI renderers. It remains inside the existing `/brainstorm-pro` runtime, review ledger, artifact binding, approval gate, and agent execution model. It does not redesign reviewer roles, triage rules, plan review, planning, execution, or design approval automation.

## Glossary

- **Design revision transaction**: A single runtime-controlled operation authorized by the user that may perform one design revision attempt and one post-revision re-review.
- **DesignRevisionAuthorization**: A single-use durable user authorization bound to a source design artifact, source review run, source triage/readiness checksums, and post-revision review settings.
- **DesignRevisionRequest**: The structured request passed to the design reviser adapter after runtime eligibility and user-question checks succeed.
- **DesignRevisionOutput**: The structured reviser result containing complete revised design markdown, change summary, resolved item IDs, unresolved item IDs, assumptions, and risk notes.
- **DesignRevisionRecord**: The durable ledger record describing a revision transaction outcome, source/target design refs, source review refs, post-revision review refs, status, and summary metadata.
- **Post-revision re-review**: The one automatic design review run that runtime starts after a revised design artifact is committed.
- **Source review evidence**: The review run, aggregate, triage report, readiness report, coverage, and checksums that justify a revision transaction.
- **Stale review evidence**: Source review evidence that remains provenance after a new design artifact is committed but cannot be used to approve the revised design.
- **Unresolved user question**: A triage question that may require user input before a safe design revision can be drafted.
- **Cumulative round policy**: Workflow-level maximum counts for total revision transactions and post-revision reviews; it does not authorize automatic multi-round revision.

## Requirements

### Requirement 1: Single-Use Revision Authorization

**User Story:** As a workflow user, I want each design revision to require an explicit single-use authorization, so that one decision cannot trigger unlimited artifact mutation or review execution.

#### Acceptance Criteria

1. WHEN the user selects the revise-design recovery action, THEN the system SHALL create a `DesignRevisionAuthorization` bound to the current source design artifact, source review run, source triage ref, source readiness ref, and post-revision review settings.
2. WHEN an authorization is created, THEN it SHALL set `allowedAction` to `single-revision-and-rereview`.
3. WHEN a revision transaction starts, THEN the system SHALL mark or persist the authorization as consumed exactly once.
4. IF a consumed authorization is reused, THEN the system SHALL reject the transaction and SHALL NOT run the reviser or commit artifacts.
5. IF the source design, review, triage, readiness, or checksum differs from the authorization binding, THEN the system SHALL reject the authorization as stale.
6. WHEN a post-revision review completes, THEN the system SHALL require a new user authorization before any additional design revision can run.

### Requirement 2: Revision Eligibility and Source Binding

**User Story:** As a maintainer, I want revision to run only against fresh, actionable review evidence, so that stale or irrelevant review output cannot mutate the design.

#### Acceptance Criteria

1. WHEN evaluating revision eligibility, THEN the system SHALL verify that the source design ref matches the latest current design artifact ref.
2. WHEN evaluating source evidence, THEN the system SHALL verify that the source review run, triage report, readiness report, and any referenced coverage are bound to the same source design ref.
3. WHEN triage indicates blocking readiness, must-fix clusters, requires-revision findings, unresolved questions with answers, or explicit user revision instructions, THEN the system SHALL treat the evidence as actionable if all other checks pass.
4. IF there are no actionable findings, unresolved questions, or user instructions, THEN the system SHALL reject revision before running the reviser.
5. IF source review failed without usable aggregate or triage output, THEN the system SHALL reject revision and expose review retry or inspection recovery actions.
6. IF any source ref path escapes the topic workflow directory, THEN the system SHALL fail closed.

### Requirement 3: Unresolved User Question Gate

**User Story:** As a workflow user, I want the system to ask me for decisions that affect the design, so that the reviser does not invent product, scope, risk, or trade-off answers.

#### Acceptance Criteria

1. WHEN triage contains unresolved questions, THEN the system SHALL classify each question as requiring user input before revision, reviser-addressable, or carry-forward.
2. IF any blocking question requires user input and lacks a bound user answer, THEN the system SHALL return `needs-user-input` and SHALL NOT launch the reviser.
3. WHEN user answers are supplied, THEN the system SHALL bind those answers to the revision authorization and request.
4. WHEN questions are classified as carry-forward, THEN the system SHALL include them as assumptions or risks in the revision request rather than blocking execution.
5. IF a user answer references an unknown question ID, THEN the system SHALL reject the answer and SHALL NOT launch the reviser.

### Requirement 4: Cumulative Revision and Review Round Policy

**User Story:** As a security reviewer, I want bounded revision and post-revision review counts, so that workflow automation cannot loop indefinitely.

#### Acceptance Criteria

1. WHEN a revision is requested, THEN the system SHALL compare current revision counts against `maxTotalRevisionRounds`.
2. WHEN a post-revision review is requested, THEN the system SHALL compare current post-revision review counts against `maxTotalPostRevisionReviewRounds`.
3. IF either cumulative limit is exhausted, THEN the system SHALL return `revision-exhausted` and SHALL NOT run the reviser or schedule another post-revision review.
4. WHEN a revision commits successfully, THEN the system SHALL increment the total revision count.
5. WHEN a post-revision review starts or completes, THEN the system SHALL update the post-revision review count consistently with the chosen counting policy.
6. WHEN a post-revision review is blocked, THEN the system SHALL pause for user decision and SHALL NOT automatically consume another round.

### Requirement 5: Design Reviser Adapter and Prompt Boundary

**User Story:** As a design reviser role implementer, I want a controlled adapter and prompt contract, so that the reviser can draft improvements without obtaining runtime authority.

#### Acceptance Criteria

1. WHEN revision eligibility succeeds, THEN the system SHALL build a `DesignRevisionRequest` containing source design ref, source review run, source triage ref, must-fix cluster IDs, should-fix cluster IDs, conflict IDs, unresolved question IDs, user answers, user instructions, round policy, and post-revision review settings.
2. WHEN invoking the reviser, THEN the system SHALL use package-owned prompt and system prompt templates through `agent-execution-runtime`.
3. WHEN invoking the reviser, THEN the child process SHALL run with the existing controlled execution boundaries, including `--no-session`, `--no-skills`, role policy, bounded output capture, and structured output validation.
4. WHEN building the prompt, THEN the system SHALL instruct the reviser to return a complete revised design markdown document plus structured metadata and to avoid generating requirements, tasks, approvals, review decisions, or planning instructions.
5. IF the child process times out, exits unsuccessfully, violates role policy, or returns malformed output, THEN the transaction SHALL fail without modifying `design.md`.

### Requirement 6: Revised Design Output Validation

**User Story:** As a maintainer, I want revised design output validated before commit, so that invalid or overreaching agent output cannot replace the current design.

#### Acceptance Criteria

1. WHEN reviser output is received, THEN the system SHALL validate the `DesignRevisionOutput` schema before using any content.
2. WHEN validating revised markdown, THEN the system SHALL require non-empty complete design content with the required design template headings.
3. WHEN validating resolved and unresolved IDs, THEN the system SHALL verify that each referenced cluster, conflict, or question ID exists in the source triage report.
4. IF the output claims approval, planning, state transitions, artifact commits, or review decisions, THEN the system SHALL reject or sanitize the output according to the validation policy before commit.
5. IF output embeds requirements/tasks as a substitute for design, exceeds configured output limits, or omits required design sections, THEN the system SHALL reject the output.
6. IF output validation fails, THEN the previous `design.md` SHALL remain authoritative and no new design artifact version SHALL be created.

### Requirement 7: Artifact Commit and Stale Review Invalidation

**User Story:** As a security reviewer, I want revised designs committed only by runtime and old review evidence invalidated, so that approval cannot reuse evidence for a different artifact.

#### Acceptance Criteria

1. WHEN revised design output passes validation, THEN the system SHALL request a runtime-owned design artifact commit rather than allowing the reviser to write files directly.
2. WHEN commit succeeds, THEN the system SHALL create a new versioned `design` artifact and mirror it to `specs/<topic>/design.md`.
3. WHEN a new design artifact version is committed, THEN source review, triage, readiness, and coverage records SHALL remain immutable provenance but SHALL NOT satisfy approval for the new design ref.
4. WHEN design approval is attempted for the revised design, THEN approval checks SHALL require review evidence bound to the revised design ref.
5. IF artifact commit fails, THEN the previous design artifact and mirror SHALL remain authoritative.

### Requirement 8: Automatic One-Shot Post-Revision Re-Review

**User Story:** As a workflow user, I want a revised design to be reviewed immediately once, so that I see whether the revision resolved issues without having to manually restart review.

#### Acceptance Criteria

1. WHEN a revised design artifact commits successfully, THEN runtime SHALL immediately schedule exactly one post-revision design review for the new design artifact.
2. WHEN scheduling post-revision review, THEN the system SHALL bind the review decision to the new design artifact version and checksum.
3. WHEN selecting review settings, THEN the system SHALL use the review mode and selected reviewer roles authorized for this revision transaction.
4. WHEN post-revision review completes, THEN the system SHALL write new review, aggregate, readiness, and triage outputs for the revised design where applicable.
5. WHEN post-revision review is passed, THEN the system SHALL move only to the design approval gate and SHALL NOT approve the design automatically.
6. WHEN post-revision review is blocked, partial, failed, or unavailable, THEN the system SHALL pause for user decision and SHALL NOT launch another revision automatically.

### Requirement 9: Revision Ledger and Event Integration

**User Story:** As a maintainer and auditor, I want revision transactions persisted in a durable ledger and event stream, so that status, resume, debugging, and future TUI can explain what happened.

#### Acceptance Criteria

1. WHEN a revision transaction is authorized, THEN the system SHALL write `authorization.json` under `.workflow/revisions/design/<revision-id>/`.
2. WHEN a revision request is built, THEN the system SHALL write `request.json` and the prompt/system prompt artifacts used for the child run.
3. WHEN child execution completes, THEN the system SHALL write child result, output, validation, and final `record.json` files as applicable.
4. WHEN transaction status changes, THEN the system SHALL append workflow events for authorization, revision start, revision blocked/failed/committed, stale invalidation, and post-revision review scheduling/completion where supported.
5. IF ledger writing fails before artifact commit, THEN the system SHALL fail the transaction without modifying `design.md`.
6. IF ledger corruption is detected on resume/status, THEN the system SHALL fail closed and expose diagnostics rather than inventing revision state.

### Requirement 10: Runtime Recovery Actions and User Handoff

**User Story:** As a workflow user, I want clear next actions after blocked review or post-revision review, so that I decide whether to revise again, answer questions, retry review, approve, or stop.

#### Acceptance Criteria

1. WHEN review/triage recommends revision, THEN status/resume SHALL expose a `revise-design-once` recovery action when eligibility prerequisites are satisfiable.
2. WHEN unresolved user questions block revision, THEN status/resume SHALL expose the blocking question IDs and answer action instead of running the reviser.
3. WHEN post-revision review completes, THEN status/resume SHALL display the revised design ref, new review run, triage/readiness summary, and available next actions.
4. WHEN a user wants another revision after post-revision handoff, THEN the system SHALL require a new single-use authorization bound to the latest design and latest review/triage evidence.
5. WHEN review retry, accept-incomplete, or reviewer selection replacement is more appropriate, THEN status/resume SHALL preserve the recovery actions defined by Spec 5.2 and Spec 5.3.
6. WHEN the user approves a revised design, THEN approval SHALL remain a separate explicit design approval gate bound to the revised design ref.

### Requirement 11: Security and Trust Boundary Enforcement

**User Story:** As a security reviewer, I want revision to preserve existing trust boundaries, so that untrusted agent output or crafted ledger content cannot bypass lifecycle gates.

#### Acceptance Criteria

1. WHEN parsing authorization, request, output, or record files, THEN the system SHALL reject unauthorized directives that attempt to approve, plan, mutate workflow state, retry reviewers, accept incomplete, or commit artifacts outside the runtime path.
2. WHEN resolving revision ledger paths, THEN the system SHALL constrain all reads and writes under `specs/<topic>/.workflow/revisions/design/<revision-id>/`.
3. WHEN the reviser returns changed file paths or direct mutation instructions, THEN the system SHALL ignore or reject them and use only validated revised design markdown.
4. WHEN stale artifact refs or crafted checksums are detected, THEN the system SHALL fail closed.
5. WHEN debug or diagnostics are written, THEN sensitive child execution details SHALL follow existing redaction policy.
6. WHEN reviser output introduces assumptions or risk notes, THEN the system SHALL preserve them in structured metadata and/or design content without treating them as user approval.
