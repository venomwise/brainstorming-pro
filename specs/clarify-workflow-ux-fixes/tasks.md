# Implementation Plan: Clarify Workflow UX Fixes

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md). The work is organized into eight phases that first tighten the user-facing setup and topic safety foundation, then add LLM-backed Chinese/mixed-language topic proposal, then connect `/clarify` to real V0 discovery/design and design-gate lifecycle routing. Tests and validation are included throughout to prevent regressions in first-run UX, topic security, artifact creation, and handoff behavior.

The implementation stays within the existing TypeScript ES module architecture under `extensions/clarification-orchestrator/`. It reuses existing Pi model configuration, subagent runner, phase modules, artifact store, and user-gate helpers, while adding a small topic proposal helper and a strict clarification-topic validator rather than changing the public command surface.

## Tasks

- [✅] 1. Phase 1: Improve first-run numeric model selection UX
  - [✅] 1.1 Update first-run setup prompt copy
    - Modify `extensions/clarification-orchestrator/first-run-config.ts` in `ensureFirstRunConfig()` so the setup notification explicitly says to enter the number shown in the model list, not the model name.
    - Update the default model `ui.input()` title/placeholder to use numeric wording such as `Choose default Brainstorming Pro model by number` and `1`.
    - Update the fallback model `ui.input()` title/placeholder to describe comma-separated numbers and blank-for-none behavior.
    - Preserve `writeFirstRunConfig()` output shape with `version`, `models.default`, and `models.fallback`.
    - _Requirements: 1.1, 1.2, 1.3, 1.6_
  - [✅] 1.2 Improve model choice validation errors
    - Modify `selectOneModel()` in `extensions/clarification-orchestrator/first-run-config.ts` so non-numeric answers produce a message like `Enter the number from the list, for example '1', not the model name.`
    - Ensure invalid numeric indexes still identify the invalid choice without changing successful selection behavior.
    - Preserve existing no-model-discovery errors in `ensureFirstRunConfig()` and `listPiModels()`.
    - _Requirements: 1.4, 1.5_
  - [✅]* 1.3 Add first-run setup unit tests
    - Update `tests/unit/first-run-config.test.ts` to assert setup notification/input copy includes number-entry semantics.
    - Add a non-numeric model-name answer case that expects the clearer numeric-choice error.
    - Add a regression assertion that the written config still contains `version`, `models.default`, and `models.fallback`.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.6, 9.1_

- [✅] 2. Phase 2: Add strict clarification topic validation
  - [✅] 2.1 Implement topic-specific English kebab-case validator
    - Add `validateClarificationTopicSlug(topic: string): void` and `isClarificationTopicSlug(topic: string): boolean` to `extensions/clarification-orchestrator/topic-proposal.ts` or a new `extensions/clarification-orchestrator/topic-validation.ts` module.
    - Enforce lowercase ASCII letters/numbers with single hyphens only, no empty value, no uppercase, no spaces, no underscores, no Unicode non-ASCII letters, no leading/trailing hyphen, and no repeated hyphens.
    - Call the existing `validateTopicSafety()` inside the strict validator so traversal, absolute paths, control characters, dot prefixes, and path separators remain rejected.
    - Export a reusable error message that explicitly says topics must be English kebab-case, for example `task-dispatch-status`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [✅] 2.2 Apply strict validation at topic confirmation boundaries
    - Modify `validateConfirmedTopic()` in `extensions/clarification-orchestrator/user-gate.ts` to call `validateClarificationTopicSlug()` instead of only `validateTopicSafety()`.
    - Modify `handleClarifyCommand()` in `extensions/clarification-orchestrator/commands/clarify.ts` to validate `confirmedTopic` before `resolveSpecPaths(cwd, confirmedTopic)` and before `createRun()`.
    - Ensure invalid manual topic errors stop run creation and surface through `ctx.ui.notify(..., "error")`.
    - _Requirements: 2.5, 2.6, 5.4, 5.6, 6.4, 6.6_
  - [✅] 2.3 Filter candidates through strict validation
    - Modify `generateTopicCandidates()` and `toCandidate()` in `extensions/clarification-orchestrator/topic-proposal.ts` so only strict English kebab-case slugs become presentable candidates.
    - Keep exact conflict and similar-topic metadata by running `findSimilarExistingTopics()` only after strict validation succeeds.
    - Remove `unsafe` candidates from user-facing choices instead of presenting them as selectable options.
    - _Requirements: 2.1, 2.2, 3.3, 3.4, 5.1_
  - [✅]* 2.4 Add topic validation unit and security tests
    - Update `tests/unit/topic-proposal.test.ts` or add `tests/unit/topic-validation.test.ts` for accepted examples `task-dispatch-status`, `payment-integration`, and `user-auth-v2`.
    - Add rejection cases for Chinese text, Unicode non-ASCII letters, spaces, underscores, uppercase, path separators, leading/trailing hyphens, repeated hyphens, dot prefixes, and empty values.
    - Update `tests/security/path-traversal.test.ts` with strict clarification-topic cases for `../x`, `/tmp/x`, `foo/bar`, `.hidden`, and `foo\\bar`.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 9.2, 9.6_

- [✅] 3. Phase 3: Replace unreadable Chinese fallback with safe proposal behavior
  - [✅] 3.1 Remove static Chinese glossary and codepoint fallback generation
    - Delete `chineseGloss`, `chineseCandidatePhrases()`, and `translateChinesePhrase()` fallback behavior from `extensions/clarification-orchestrator/topic-proposal.ts`.
    - Ensure `generateTopicCandidates()` does not generate `topic-${codepoint...}` slugs for Chinese requests.
    - Keep `detectLanguage()` or an equivalent exported language/content detector for deciding deterministic versus LLM-backed proposal mode.
    - _Requirements: 4.7, 6.1_
  - [✅] 3.2 Preserve deterministic English candidate generation
    - Refactor `englishCandidatePhrases()` and `generateTopicCandidates()` in `extensions/clarification-orchestrator/topic-proposal.ts` to generate up to three strict candidates for English/Latin requests.
    - Continue using `genericWords` filtering and `isWeakSlug()` to mark generic candidates as weak while excluding invalid slugs.
    - Ensure exact existing-topic conflicts and similar topic choices are still represented safely.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_
  - [✅] 3.3 Add manual fallback signal for empty candidate sets
    - Update `renderTopicChoices()` in `extensions/clarification-orchestrator/topic-proposal.ts` to clearly explain that no safe topic candidates were generated and manual English kebab-case input is required.
    - Ensure `buildTopicChoices([])` still provides a manual choice and cannot select an undefined generated candidate.
    - _Requirements: 3.5, 5.2, 5.3_
  - [✅]* 3.4 Add deterministic proposal regression tests
    - Update `tests/unit/topic-proposal.test.ts` to verify English requests return valid deterministic candidates without LLM involvement.
    - Add Chinese request regression cases that assert no returned candidate matches codepoint-style `topic-...` fallback patterns.
    - Add empty/invalid deterministic proposal cases that lead to manual-only topic choices.
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 4.7, 9.3_

- [✅] 4. Phase 4: Add LLM-backed topic proposal for Chinese and mixed requests
  - [✅] 4.1 Create topic proposal agent helper
    - Add `extensions/clarification-orchestrator/topic-proposal-agent.ts` with `proposeTopicsWithModel()` or equivalent.
    - Build a compact prompt that asks the configured model for JSON containing two to three semantic English kebab-case topic candidates derived from the request meaning.
    - Use the existing `runSubagent()` infrastructure or a minimal configured-model runner path with no artifact/directory creation side effects.
    - Parse model output with `parseJsonOutput()`/schema validation from `extensions/clarification-orchestrator/validation.ts` or a new small schema in `schemas.ts`.
    - _Requirements: 4.1, 4.2, 4.3, 4.6_
  - [✅] 4.2 Validate, deduplicate, and annotate LLM candidates
    - In `topic-proposal-agent.ts`, filter all returned candidates through `validateClarificationTopicSlug()` before returning them.
    - Deduplicate by slug and limit valid results to three candidates.
    - Reuse `findSimilarExistingTopics()` and exact-conflict checks to create `TopicCandidate` objects with warnings, `exactConflict`, and `similarTopics` metadata.
    - Treat invalid JSON, invalid candidate arrays, duplicate-only output, and all-invalid output as proposal failure/empty result.
    - _Requirements: 4.3, 4.4, 4.5, 9.3_
  - [✅] 4.3 Integrate proposal mode selection in `/clarify`
    - Modify `handleClarifyCommand()` in `extensions/clarification-orchestrator/commands/clarify.ts` to run first-run config before deciding LLM topic proposal.
    - Use the language/content detector from `topic-proposal.ts` to choose deterministic English generation for English requests and `proposeTopicsWithModel()` for Chinese/mixed requests.
    - On LLM failure or no valid candidates, notify the user and continue to `confirmTopicCandidate()` with an empty/manual-only candidate list.
    - Ensure `options.proposedTopic` is set only when at least one valid candidate exists.
    - _Requirements: 4.1, 4.5, 5.2, 6.1, 6.6_
  - [✅] 4.4 Preserve dry-run behavior with topic proposal
    - Modify the `--dry-run` path in `handleClarifyCommand()` so English requests use deterministic valid candidates and Chinese/mixed requests either use the LLM helper when configured or report that manual topic input would be required.
    - Ensure dry-run writes the existing debug plan via `writeDebugInput()` and never runs designer execution or design gates.
    - _Requirements: 5.2, 6.5_
  - [✅]* 4.5 Add LLM topic proposal unit tests
    - Add tests for valid JSON returning two to three English kebab-case candidates.
    - Add tests that invalid JSON, invalid slugs, malicious paths, Unicode homoglyphs, duplicates, and empty arrays are filtered or trigger manual fallback.
    - Add a Chinese request test verifying valid English candidates are presented and no artifacts are created by the helper.
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6, 9.3, 9.6_

- [✅] 5. Phase 5: Improve topic confirmation and manual fallback UX
  - [✅] 5.1 Update topic confirmation prompt text
    - Modify `confirmTopicCandidate()` in `extensions/clarification-orchestrator/user-gate.ts` so prompts explicitly say candidates and manual entries must be English kebab-case.
    - Ensure `renderTopicChoices()` output does not include unsafe or non-English candidate slugs.
    - Show existing-topic reuse/edit choices only for validated slugs.
    - _Requirements: 5.1, 5.2, 5.3_
  - [✅] 5.2 Add bounded retry for invalid manual topics
    - Modify `requestManualTopic()` or `confirmTopicCandidate()` in `extensions/clarification-orchestrator/user-gate.ts` to retry invalid manual entries up to a small fixed number such as three attempts when `ctx.input` remains available.
    - Notify the user with the strict English kebab-case error after each invalid manual entry.
    - Preserve cancellation behavior when the user submits an empty value or cancels input.
    - _Requirements: 5.4, 5.5, 5.6, 2.6_
  - [✅]* 5.3 Add topic gate tests
    - Update `tests/integration/decision-gate.test.ts` or add a focused `tests/unit/user-gate.test.ts` for candidate number selection, `manual` selection, invalid manual retry, cancellation, and empty-candidate manual-only behavior.
    - Verify invalid manual topics do not call path resolution or create run artifacts in command-level tests.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.6_

- [✅] 6. Phase 6: Connect workflow orchestration to V0 discovery/design execution
  - [✅] 6.1 Resolve designer agent and call discovery phase from workflow
    - Modify `extensions/clarification-orchestrator/workflow.ts` in `ClarificationWorkflow.runWorkflow()` or add a dedicated orchestrator method so `V0_BRAINSTORMING` calls `runDiscoveryPhase()` instead of only persisting phase metadata.
    - Use `discoverAgents()` from `extensions/clarification-orchestrator/agents.ts` to find the `designer` role/name and pass it to `runDiscoveryPhase()`.
    - Pass `paths`, loaded `WorkflowState`, `BrainstormingProConfig`, `cwd`, package root, and model context consistently with existing phase function signatures.
    - Invoke `onPhase` callbacks for both phase progress and concrete phase entry without double-counting terminal states.
    - _Requirements: 7.1, 7.3, 7.6_
  - [✅] 6.2 Enforce design artifact existence before design gate
    - Add a helper such as `assertDesignArtifactReady(paths, state)` in `workflow.ts` that checks `paths.designPath` and the latest `versions/v0/design.md` or `state.designVersions` entry exist before calling the gate.
    - If artifacts are missing, record an orchestration `WorkflowError`, mark the run `ABORTED` or recoverable according to existing policy, and do not notify that a reviewable gate was reached.
    - _Requirements: 7.2, 7.5_
  - [✅] 6.3 Handle designer failures with recoverable state messaging
    - Update workflow error handling around `runDiscoveryPhase()` so failed/invalid designer output preserves the phase error, increments failed run metadata already managed by discovery, and returns the failed state.
    - Modify `handleClarifyCommand()` in `commands/clarify.ts` to notify a status/resume hint when `runWorkflow()` returns `ABORTED` or `recoverable-failure` rather than a generic reached-phase message.
    - _Requirements: 7.4, 6.6_
  - [✅]* 6.4 Add workflow execution integration tests
    - Update `tests/integration/workflow.test.ts` to use a mocked designer runner or injected workflow services and assert `execution.agentRuns > 0` after topic confirmation.
    - Assert `specs/<topic>/design.md` and `specs/<topic>/clarification/run-*/versions/v0/design.md` exist before the design gate is entered.
    - Add a missing-design-artifact test that expects an orchestration error instead of a successful gate notification.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.5_

- [✅] 7. Phase 7: Route design review gate actions and lifecycle handoff
  - [✅] 7.1 Call design review gate with latest design metadata
    - Modify `workflow.ts` so `DESIGN_REVIEW_GATE` calls `presentDesignReviewGate()` from `extensions/clarification-orchestrator/user-gate.ts` with `version`, `designPath`, `changeSummary`, open questions, pending blockers, and an interactive `ask` wrapper around `ctx.ui.input` or equivalent command context service.
    - Adjust `WorkflowContext`/`WorkflowServices` types if needed so workflow can ask interactive gate questions without importing command-specific UI types.
    - Preserve the existing error when no interactive UI is available for design gates.
    - _Requirements: 8.1, 6.3_
  - [✅] 7.2 Implement `save` and `approve` gate routing
    - In `workflow.ts`, when `DesignGateDecision.action` is `save`, leave state at `DESIGN_REVIEW_GATE`, persist `resumeStatus: awaiting-design-gate-decision`, and return without marking complete.
    - When action is `approve`, call `runFinalApprovalPhase({ approved: true })` from `extensions/clarification-orchestrator/phases/final-approval.ts`.
    - Modify `handleClarifyCommand()` to notify `Run /spec-plan <topic>` after a complete approved workflow and never invoke `/spec-plan` automatically.
    - _Requirements: 8.2, 8.3, 8.4_
  - [✅] 7.3 Route `review` and `revise` gate actions
    - In `workflow.ts`, when action is `review`, route into existing `runReviewPhase()`, `runTriagePhase()`, decision gate, `runRefinePhase()`, and `runVerifyPhase()` lifecycle modules according to current lifecycle rules.
    - When action is `revise`, call `runConversationalRevisionPhase()` from `extensions/clarification-orchestrator/phases/conversational-revision.ts` and return to `DESIGN_REVIEW_GATE` with the updated latest design version.
    - Preserve blocking issue behavior by letting `presentDesignReviewGate()` call `assertNoBlockingDiscussedIssues()` for approval.
    - _Requirements: 8.5, 8.6, 8.7_
  - [✅] 7.4 Support resume from awaiting design gate
    - Update `resumeWorkflow()` in `workflow.ts` so `resumeStatus: awaiting-design-gate-decision` revalidates design artifact existence and presents the design gate rather than only changing phase metadata.
    - Ensure `chooseResumableRun()` in `commands/clarify.ts` continues to display run topic, status, latest version, round, and updated timestamp.
    - _Requirements: 8.1, 8.2_
  - [✅]* 7.5 Add gate routing integration tests
    - Update `tests/integration/decision-gate.test.ts` and `tests/integration/resume.test.ts` for gate `save` leaving `resumeStatus: awaiting-design-gate-decision`.
    - Add an approve-path test that writes final approval artifacts, marks execution complete, and emits `/spec-plan <topic>`.
    - Add review/revise routing smoke tests using mocked phase functions where practical.
    - Add a blocking-decision approval test that verifies unresolved issue IDs are reported.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 9.5_

- [✅] 8. Checkpoint - Full regression validation
  - [✅]* 8.1 Run typecheck and full tests
    - Run `npm run typecheck` and fix any strict TypeScript issues introduced in `topic-proposal.ts`, `topic-proposal-agent.ts`, `user-gate.ts`, `commands/clarify.ts`, and `workflow.ts`.
    - Run `npm test` and ensure unit, integration, and security tests pass.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [✅]* 8.2 Run package validation and command-surface regression checks
    - Run `npm run validate-package`.
    - Confirm README command-surface tests still pass and no public command names/options changed.
    - _Requirements: 9.7_
  - [✅]* 8.3 Document validation outcome for handoff
    - Update PR notes or implementation summary with validation commands run and any intentional artifact/layout changes.
    - Include transcript snippets for user-visible prompt or handoff message changes if opening a PR.
    - _Requirements: 8.4, 9.7_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP, but test and validation tasks should be completed before merging.
- Keep topic validation specific to clarification topics so general path traversal protections remain reusable for other repository functions.
- Do not auto-run `/spec-plan`; final approval should only print the handoff command.
- Keep public command names and options aligned with the README.
