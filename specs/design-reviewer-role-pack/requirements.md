# Requirements Document: Design Reviewer Role Pack

## Introduction

The Design Reviewer Role Pack makes Brainstorming Pro `full` design review executable by adding five controlled reviewer roles to the existing Spec 5 design review panel foundation. It serves workflow users who need stronger multi-perspective feedback before approving `design.md`, and maintainers who need the feature to remain bounded by runtime-owned lifecycle gates, exact artifact binding, and existing review ledger semantics.

This spec registers Product, Architecture, Risk/Security, Testing, and Scope/Simplicity reviewers with the controlled `agent-execution-runtime`, provides package-owned prompts and structured output validation, runs the default full reviewer set through the existing `DesignReviewPanel`, and normalizes findings into the canonical Spec 5 `DesignReviewFinding` schema. It does not implement reviewer subset selection, partial-success recovery, failed reviewer retry, accept-incomplete review, advanced triage, automatic revision, plan review, or public command changes.

## Glossary

- **DesignReviewPanel**: The Spec 5 workflow-owned design review foundation that binds the exact design artifact, creates review runs, coordinates reviewers, writes review ledger files, aggregates findings, and returns status to the runtime adapter.
- **Full design review**: The `full` design review mode selected by the user at the design review decision gate. In this spec it executes the complete five-role reviewer pack by default.
- **Full reviewer role**: One of `product-reviewer`, `architecture-reviewer`, `risk-security-reviewer`, `testing-reviewer`, or `scope-simplicity-reviewer`.
- **Agent execution runtime**: The controlled child Pi execution layer under `extensions/clarification-orchestrator/runtime/agent-execution/` that enforces role policy, phase restrictions, no-session/no-skills launch behavior, output limits, and schema validation.
- **DesignReviewFinding**: The canonical Spec 5 normalized finding record that includes injected `reviewRunId`, exact `designRef`, `reviewerRole`, severity, category, and recommendation fields.
- **Review ledger**: Durable review run data under `specs/<topic>/.workflow/reviews/design/<review-run-id>/`.
- **Selected-role extension point**: An internal parameter that allows future Spec 5.2 to supply a reviewer subset. In this spec it is not exposed through user UX and default full review runs all five roles.

## Requirements

### Requirement 1: Full Reviewer Agent Role Registration

**User Story:** As a Brainstorming Pro maintainer, I want all full design reviewer roles registered in the agent execution runtime, so that `full` review can run through the same controlled isolation and role policy as existing agent-backed phases.

#### Acceptance Criteria

1. WHEN the agent runtime type system is compiled, THEN `AgentRole` SHALL include `product-reviewer`, `architecture-reviewer`, `risk-security-reviewer`, `testing-reviewer`, and `scope-simplicity-reviewer`.
2. WHEN `AGENT_ROLE_DEFINITIONS` is inspected, THEN each full reviewer role SHALL be registered with `allowedPhases: ["design-review"]`.
3. WHEN each full reviewer role definition is inspected, THEN it SHALL use `expectedResultKind: "review-findings"`.
4. WHEN each full reviewer role definition is inspected, THEN it SHALL set `allowSkills: false` and `allowSession: false`.
5. IF a full reviewer role is invoked outside `design-review`, THEN `validateRoleForPhase()` SHALL reject the run with a role policy error.
6. IF any full reviewer role is missing from the runtime role definitions, THEN role-pack completeness validation SHALL fail before a full review is treated as executable.

### Requirement 2: Full Reviewer Registry and Deterministic Role Set

**User Story:** As a reviewer role implementer, I want a single registry for the full reviewer role pack, so that full review resolution is deterministic, complete, and reusable by future execution-control work.

#### Acceptance Criteria

1. WHEN full reviewer definitions are resolved without a selected-role argument, THEN the registry SHALL return exactly five reviewer definitions in deterministic order: product, architecture, risk/security, testing, scope/simplicity.
2. WHEN a reviewer definition is requested by role, THEN the registry SHALL return its display name, default finding category, prompt builder, and system prompt builder.
3. WHEN role-pack completeness validation runs, THEN it SHALL verify that all five full reviewer roles have definitions.
4. IF an unknown role is requested, THEN the registry SHALL reject it with a descriptive error.
5. IF a selected-role list is supplied through the internal extension point, THEN the registry SHALL validate that roles are known and unique.
6. WHEN this spec is implemented, THEN no public command, resume UX, or user decision path SHALL expose selected reviewer subset behavior.

### Requirement 3: Per-Role Prompt and System Prompt Boundaries

**User Story:** As a workflow user, I want each full reviewer to examine the design from a clear perspective, so that full review findings are focused and useful without allowing reviewers to change lifecycle state.

#### Acceptance Criteria

1. WHEN the Product Reviewer prompt is built, THEN it SHALL focus on problem statement, users, goals, success criteria, non-goals, scope, unresolved product decisions, and planning readiness.
2. WHEN the Architecture Reviewer prompt is built, THEN it SHALL focus on component boundaries, runtime ownership, interfaces, data flow, persistence/event/artifact integration, coupling, and maintainability.
3. WHEN the Risk/Security Reviewer prompt is built, THEN it SHALL focus on path traversal, topic scoping, stale artifact/version/checksum risk, approval gate bypass risk, untrusted output handling, model/tool/session policy, fail-closed behavior, and audit integrity.
4. WHEN the Testing Reviewer prompt is built, THEN it SHALL focus on unit, integration, security, and documentation test coverage; negative paths; fixtures; deterministic validation; and evidence strategy.
5. WHEN the Scope/Simplicity Reviewer prompt is built, THEN it SHALL focus on YAGNI, over-abstraction, accidental inclusion of future specs, spec boundary discipline, complexity, and maintainability.
6. WHEN any full reviewer prompt or system prompt is built, THEN it SHALL instruct the reviewer to return structured findings only, never edit artifacts, never approve design, never mutate workflow state, and never request gate skipping.
7. WHEN prompts include artifact context, THEN they SHALL include exact design artifact metadata and supplied design content without loading project-local untrusted reviewer prompts.

### Requirement 4: Shared Structured Reviewer Output Validation

**User Story:** As a security and reliability reviewer, I want full reviewer outputs to be schema validated before use, so that malformed or malicious child output cannot corrupt review state or bypass gates.

#### Acceptance Criteria

1. WHEN a full reviewer returns valid structured output, THEN the schema SHALL accept a non-empty `summary`, a `confidence` value of `low`, `medium`, or `high`, and a `findings` array of valid `DesignReviewFindingDraft` entries.
2. WHEN a full reviewer returns malformed JSON or non-parseable output, THEN the corresponding reviewer result SHALL be marked failed.
3. WHEN a full reviewer returns an unknown confidence value, missing summary, or non-array findings field, THEN the corresponding reviewer result SHALL be marked failed.
4. WHEN an individual finding is malformed, THEN the corresponding reviewer result SHALL be marked failed and unvalidated findings SHALL NOT be used for aggregation.
5. WHEN reviewer output includes unauthorized approval, artifact commit, workflow state mutation, phase transition, or gate decision fields, THEN validation or normalization SHALL reject the output.
6. WHEN reviewer output includes `id`, `reviewRunId`, `designRef`, or `reviewerRole`, THEN those fields SHALL NOT be trusted as canonical values; the panel SHALL inject canonical values during normalization.

### Requirement 5: Full Reviewer Execution Through DesignReviewPanel

**User Story:** As a workflow user, I want selecting `full` review to run the complete design reviewer pack, so that the design receives multi-perspective review before approval.

#### Acceptance Criteria

1. WHEN `runDesignReviewers()` receives `mode: "minimal"`, THEN it SHALL preserve the existing minimal reviewer behavior.
2. WHEN `runDesignReviewers()` receives `mode: "full"` and no selected-role extension argument, THEN it SHALL resolve and execute all five full reviewer roles.
3. WHEN full reviewers execute, THEN they SHALL run through `runAgent()` with their own role, role-specific prompt, role-specific system prompt, shared output schema, design-review workflow context, and configured model.
4. WHEN full reviewers execute, THEN the implementation SHALL start the five default reviewer runs in parallel using controlled agent runtime calls rather than sequential prompt chaining or a generic public subagent tool.
5. WHEN all full reviewers succeed and no blocking findings are produced, THEN existing aggregation/readiness behavior SHALL allow the design review result to be `passed`.
6. WHEN all full reviewers succeed and at least one blocking finding is produced, THEN existing aggregation/readiness behavior SHALL make the design review result `blocked`.
7. WHEN the full role pack is registered, THEN `full` review SHALL NOT return `full-review-unavailable` for the normal complete role-pack path.

### Requirement 6: Finding Normalization and Ledger Compatibility

**User Story:** As a maintainer and auditor, I want full reviewer results persisted using the existing Spec 5 finding and ledger contracts, so that full review remains traceable without redesigning persistence.

#### Acceptance Criteria

1. WHEN a full reviewer succeeds, THEN its finding drafts SHALL be normalized into canonical `DesignReviewFinding` records using the existing normalizer.
2. WHEN findings are normalized, THEN each finding SHALL include the current `reviewRunId`, exact `designRef`, deterministic finding id, and the full reviewer role that produced it.
3. WHEN full review runs, THEN reviewer result files SHALL be written under the existing review ledger directory `specs/<topic>/.workflow/reviews/design/<review-run-id>/reviewer-results/`.
4. WHEN full review runs, THEN the ledger SHALL preserve one result file per full reviewer role using the existing result file convention.
5. WHEN full review aggregation completes, THEN existing `aggregated-findings.json` and `readiness.json` outputs SHALL remain compatible with Spec 5 readers.
6. WHEN this spec is implemented, THEN it SHALL NOT introduce retry attempt directories, selected/unselected coverage files, or alternate ledger layouts reserved for Spec 5.2.

### Requirement 7: Full Review Failure and No-Fallback Semantics

**User Story:** As a security/reliability reviewer, I want full review failures to fail closed, so that unavailable or failed reviewer roles cannot silently become a weaker review.

#### Acceptance Criteria

1. IF any required full reviewer times out, exits unsuccessfully, violates role policy, or returns invalid output, THEN the Spec 5.1 full review result SHALL be failed and SHALL NOT be approval-ready.
2. WHEN a required reviewer fails after other reviewers succeeded, THEN successful reviewer result files MAY be persisted for audit, but the review SHALL NOT be treated as passed or approval-ready.
3. IF the full role pack is incomplete or invalid after Spec 5.1 implementation, THEN full review SHALL fail closed with diagnostics rather than falling back to minimal.
4. IF `full` review cannot execute, THEN the implementation SHALL NOT silently downgrade to `minimal` or `skip`.
5. WHEN blocking findings exist and all reviewers succeeded, THEN the review SHALL be blocked rather than failed.
6. WHEN a stale or mismatched design artifact binding is detected, THEN full reviewers SHALL NOT run and existing Spec 5 stale-decision handling SHALL remain authoritative.

### Requirement 8: Scope Boundaries and Future Extension Preservation

**User Story:** As a future design-review execution-control designer, I want Spec 5.1 to expose safe internal seams without implementing later UX/recovery behavior, so that Spec 5.2 can add reviewer selection and retry without undoing this work.

#### Acceptance Criteria

1. WHEN the full reviewer runner is implemented, THEN it SHALL accept or be structured to accept an internal selected-role extension point for future Spec 5.2.
2. WHEN selected-role extension support exists internally, THEN omitting selected roles SHALL run all five default reviewer roles.
3. WHEN this spec is complete, THEN no `/brainstorm-pro` public option, resume decision, or status command SHALL expose reviewer subset selection.
4. WHEN this spec is complete, THEN it SHALL NOT implement partial-success aggregation, failed reviewer retry, accept-incomplete review, or incomplete-review readiness.
5. WHEN this spec is complete, THEN it SHALL NOT implement advanced triage, finding deduplication, automatic design revision, plan review, or design approval automation.
6. WHEN public docs or roadmap references are updated, THEN they SHALL state that reviewer selection/retry/accept-incomplete behavior is deferred to Spec 5.2.
