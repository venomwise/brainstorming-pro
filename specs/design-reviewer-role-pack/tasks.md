# Implementation Plan: Design Reviewer Role Pack

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

Implement the full design reviewer role pack in four phases. First register the five reviewer roles in the controlled agent execution runtime and add a deterministic full reviewer registry. Next add role-specific prompt builders and shared structured output validation so every reviewer produces canonical finding drafts only. Then wire full reviewer execution into the existing Spec 5 reviewer coordinator and panel flow, preserving the existing ledger, aggregation, readiness, and approval gate contracts. Finally add targeted tests and documentation alignment to prove full review is executable, fail-closed, and still scoped away from Spec 5.2 execution-control behavior.

## Tasks

- [✅] 1. Phase 1: Register full reviewer roles and role-pack registry
  - [✅] 1.1 Extend agent execution role types
    - Modify `extensions/clarification-orchestrator/runtime/agent-execution/types.ts` to add `product-reviewer`, `architecture-reviewer`, `risk-security-reviewer`, `testing-reviewer`, and `scope-simplicity-reviewer` to `AgentRole`
    - Preserve existing `AgentResultKind = "review-findings"` behavior without adding new result kinds
    - _Requirements: 1.1, 1.3_
  - [✅] 1.2 Register full reviewer role definitions
    - Modify `extensions/clarification-orchestrator/runtime/agent-execution/roles.ts` to add role definitions for all five full reviewers
    - Set each full reviewer role to `allowedPhases: ["design-review"]`, `expectedResultKind: "review-findings"`, `allowSkills: false`, and `allowSession: false`
    - Add role descriptions matching Product, Architecture, Risk/Security, Testing, and Scope/Simplicity responsibilities
    - _Requirements: 1.2, 1.3, 1.4, 1.5_
  - [✅] 1.3 Add the full reviewer registry
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts`
    - Define `FullDesignReviewerRole`, `FullDesignReviewerDefinition`, and `FullDesignReviewerPromptInput`
    - Implement deterministic full role order, `resolveFullDesignReviewerSet()`, `getFullDesignReviewerDefinition()`, and `assertFullDesignReviewerPackComplete()`
    - Validate unknown roles, duplicate selected roles, and incomplete role definitions
    - Keep selected-role resolution internal and do not expose user-facing reviewer selection
    - _Requirements: 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.1, 8.2, 8.3_
  - [✅]* 1.4 Add unit tests for role registration and registry completeness
    - Add `tests/unit/workflow/design-review-full-role-registry.test.ts`
    - Test all five roles exist in `AgentRole`/`AGENT_ROLE_DEFINITIONS`, are allowed only in `design-review`, use `review-findings`, and disallow skills/session
    - Test registry default order, lookup behavior, unknown role rejection, duplicate selected-role rejection, and completeness validation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5_

- [✅] 2. Checkpoint - Verify full reviewer role foundation
  - Run `npm run typecheck` and the role registry unit tests if implemented
  - Inspect `extensions/clarification-orchestrator/runtime/agent-execution/roles.ts` to confirm every full reviewer role is phase-restricted to `design-review` with no session and no skills
  - Inspect `extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts` to confirm default full review resolves exactly five deterministic roles and no public UX selection is introduced
  - Stop only if role policy, registry completeness, or selected-role boundary validation fails
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1, 2.3, 2.6, 8.1, 8.2, 8.3_

- [✅] 3. Phase 2: Add full reviewer prompts and shared output validation
  - [✅] 3.1 Add shared full reviewer output schema
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts` to add a role-neutral `DesignReviewerOutput` type or an equivalent shared type alias compatible with `MinimalDesignReviewOutput`
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/schemas.ts` to add `designReviewerOutputSchema` or shared validators used by full reviewer roles
    - Ensure summary, confidence, findings array, and finding draft validation match the existing finding normalizer contract
    - Reject malformed output and unauthorized approval/state/artifact/gate mutation fields
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  - [✅] 3.2 Add Product Reviewer prompts
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/full-product-review.ts`
    - Implement `buildProductDesignReviewPrompt()` and `buildProductDesignReviewSystemPrompt()` focused on product problem, users, goals, success criteria, non-goals, scope, unresolved decisions, and planning readiness
    - Ensure the prompt requires structured findings only and forbids artifact edits, approval, state mutation, and gate skipping
    - _Requirements: 3.1, 3.6, 3.7_
  - [✅] 3.3 Add Architecture Reviewer prompts
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/full-architecture-review.ts`
    - Implement `buildArchitectureDesignReviewPrompt()` and `buildArchitectureDesignReviewSystemPrompt()` focused on component boundaries, runtime ownership, interfaces, data flow, persistence/event/artifact integration, coupling, and maintainability
    - Ensure the prompt requires structured findings only and forbids artifact edits, approval, state mutation, and gate skipping
    - _Requirements: 3.2, 3.6, 3.7_
  - [✅] 3.4 Add Risk/Security Reviewer prompts
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/full-risk-security-review.ts`
    - Implement `buildRiskSecurityDesignReviewPrompt()` and `buildRiskSecurityDesignReviewSystemPrompt()` focused on path traversal, topic scoping, stale artifact/version/checksum risk, approval gate bypass, untrusted output handling, model/tool/session policy, fail-closed behavior, and audit integrity
    - Ensure the prompt requires structured findings only and forbids artifact edits, approval, state mutation, and gate skipping
    - _Requirements: 3.3, 3.6, 3.7_
  - [✅] 3.5 Add Testing Reviewer prompts
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/full-testing-review.ts`
    - Implement `buildTestingDesignReviewPrompt()` and `buildTestingDesignReviewSystemPrompt()` focused on unit, integration, security, docs tests, negative paths, fixtures, deterministic validation, and evidence strategy
    - Ensure the prompt requires structured findings only and forbids artifact edits, approval, state mutation, and gate skipping
    - _Requirements: 3.4, 3.6, 3.7_
  - [✅] 3.6 Add Scope/Simplicity Reviewer prompts
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/full-scope-simplicity-review.ts`
    - Implement `buildScopeSimplicityDesignReviewPrompt()` and `buildScopeSimplicityDesignReviewSystemPrompt()` focused on YAGNI, over-abstraction, accidental inclusion of future specs, spec boundary discipline, complexity, and maintainability
    - Ensure the prompt requires structured findings only and forbids artifact edits, approval, state mutation, and gate skipping
    - _Requirements: 3.5, 3.6, 3.7_
  - [✅] 3.7 Wire prompt builders into the full reviewer registry
    - Update `extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts` so each reviewer definition references its role-specific prompt and system prompt builders
    - Assign default finding categories for product, architecture, risk-security, testing, and scope-simplicity reviewers
    - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_
  - [✅]* 3.8 Add unit tests for prompts and schema validation
    - Add `tests/unit/workflow/design-review-full-prompts.test.ts` and `tests/unit/workflow/design-review-full-schema.test.ts`
    - Test each prompt includes role focus, exact design artifact metadata, structured-output instructions, and no mutation/approval/gate-skipping permissions
    - Test valid reviewer output is accepted and malformed, unauthorized, or untrusted canonical fields are rejected or ignored according to the schema/normalizer contract
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [✅] 4. Checkpoint - Verify prompt and schema safety
  - Run `npm run typecheck` and the full prompt/schema unit tests if implemented
  - Inspect every `full-*-review.ts` prompt module to confirm it is package-owned, design-artifact-bound, role-specific, and read-only
  - Confirm schema validation rejects malformed or unauthorized reviewer output before normalization or aggregation
  - Stop only if prompt boundaries permit artifact edits, approval, workflow state mutation, or gate skipping
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5_

- [✅] 5. Phase 3: Execute full reviewer pack through the existing panel
  - [✅] 5.1 Implement full reviewer runner
    - Create `extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-runner.ts` or add equivalent helpers to `reviewer-coordinator.ts`
    - Implement `runFullDesignReviewer()` to build the role-specific prompt/system prompt, call `runAgent()` with the full reviewer role, use the shared reviewer output schema, and convert agent failure/timeout/invalid output into a failed `DesignReviewerResult`
    - Normalize successful findings with `normalizeDesignReviewFindings()` using the exact `reviewRunId`, `designRef`, and reviewer role
    - Preserve raw structured output for audit consistently with existing reviewer result behavior
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.3, 6.1, 6.2_
  - [✅] 5.2 Extend reviewer coordinator for full mode
    - Modify `extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-coordinator.ts`
    - Preserve existing minimal reviewer path for `mode: "minimal"`
    - Replace the current full-mode unavailable/throw behavior with `runFullDesignReviewers()` that resolves the full reviewer set and starts all five default reviewers in parallel
    - Add an internal `selectedFullReviewerRoles` parameter or equivalent seam for future Spec 5.2 while keeping default behavior as all five roles
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 7.4, 8.1, 8.2, 8.3_
  - [✅] 5.3 Preserve full review panel status mapping
    - Update `extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts` and related aggregation/readiness integration only as needed so full review no longer returns `full-review-unavailable` when the role pack is complete
    - Ensure all reviewers succeeded plus no blocking findings maps to `passed`, all reviewers succeeded plus blocking findings maps to `blocked`, and any required reviewer failure maps to `failed` in Spec 5.1
    - Ensure stale artifact binding continues to prevent reviewer execution through existing Spec 5 binding checks
    - _Requirements: 5.5, 5.6, 5.7, 7.1, 7.2, 7.3, 7.5, 7.6_
  - [✅] 5.4 Preserve existing review ledger compatibility
    - Use existing `writeReviewerResult()`, `writeAggregatedFindings()`, `writeReadiness()`, and `writeDesignReviewRun()` helpers for full review outputs
    - Confirm full review writes one reviewer result file for each full reviewer role under `reviewer-results/`
    - Do not add retry attempt directories, selected/unselected coverage files, or alternate ledger layouts
    - _Requirements: 6.3, 6.4, 6.5, 6.6_
  - [✅]* 5.5 Add unit and integration tests for full review execution
    - Add `tests/unit/workflow/design-review-full-reviewers.test.ts` and update `tests/unit/workflow/design-review-panel.test.ts` or `tests/unit/workflow/adapters/design-review.test.ts`
    - Add `tests/integration/design-reviewer-role-pack.test.ts` if integration coverage is needed for runtime phase behavior
    - Test full mode invokes all five reviewers, writes all five reviewer result files, passes with no blocking findings, blocks with blocking findings, fails when any required reviewer fails, and never falls back to minimal
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4_

- [✅] 6. Checkpoint - Verify full review execution and fail-closed behavior
  - Run `npm run typecheck` and targeted design-review full reviewer tests if implemented
  - Inspect a test ledger or fixture output to confirm full review writes `product-reviewer.json`, `architecture-reviewer.json`, `risk-security-reviewer.json`, `testing-reviewer.json`, and `scope-simplicity-reviewer.json`
  - Confirm full mode no longer returns `full-review-unavailable` when the full role pack is complete
  - Confirm failed full reviewer roles do not produce passed or approval-ready review results and do not fallback to minimal or skip
  - Stop only if full review changes Spec 5 lifecycle, ledger layout, approval gate semantics, or stale artifact binding behavior
  - _Requirements: 5.2, 5.4, 5.5, 5.6, 5.7, 6.3, 6.4, 6.5, 6.6, 7.1, 7.2, 7.3, 7.4, 7.6_

- [✅]* 7. Phase 4: Security, documentation, and package validation
  - [✅] 7.1 Add security tests for full reviewer boundaries
    - Add `tests/security/design-reviewer-role-pack.test.ts`
    - Test full reviewer roles cannot run outside `design-review`, are launched through no-session/no-skills runtime policy, cannot inject approval/state/artifact mutation, cannot create path escapes through finding content, and cannot force fallback to minimal
    - _Requirements: 1.5, 3.6, 4.5, 5.3, 7.1, 7.3, 7.4, 7.6_
  - [✅] 7.2 Update docs alignment only where public behavior changes
    - Update `README.md` or workflow docs only if public status/resume output now documents full review executability
    - Ensure docs state that Spec 5.1 full review runs the complete five-role pack by default and that reviewer selection, retry, and accept-incomplete behavior are deferred to Spec 5.2
    - Update `tests/unit/docs/workflow-runtime.test.ts` or related docs tests only when documented behavior changes
    - _Requirements: 2.6, 8.3, 8.4, 8.5, 8.6_
  - [✅] 7.3 Run full validation suite
    - Run `npm run typecheck && npm test && npm run validate-package`
    - Confirm package validation still passes after adding role/prompt modules and no forbidden generic subagent surface is introduced
    - _Requirements: 1.1, 1.2, 1.4, 2.6, 5.7, 7.4, 8.3, 8.4, 8.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP.
- Spec 5.1 intentionally keeps full review execution strict: the default five reviewers are required, and any required reviewer failure fails the full review.
- Spec 5.2 `design-review-execution-control` will later add user-selectable reviewer subsets, partial-success aggregation, failed reviewer retry, and accept-incomplete review.
- Do not change Spec 5 review run lifecycle, ledger layout, artifact binding, aggregation/readiness contract, or approval gate semantics while implementing this spec.
