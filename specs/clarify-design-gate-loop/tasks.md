# Implementation Plan: Clarify Design Gate Loop

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md). The work is organized into nine phases: command parsing and topic confirmation first, artifact/state migration next, then V0 methodology resources, the design gate loop, cross-review decision changes, lifecycle command boundaries, documentation, and verification.

The implementation targets the existing TypeScript pi extension under `extensions/clarification-orchestrator/`. The plan preserves existing safety primitives where possible (`path-guard.ts`, `artifact-store.ts`, `runner.ts`, `debug-artifacts.ts`) while replacing the old topic-first workflow and automation controls with explicit user-gated state transitions.

## Tasks

- [ ] 1. Phase 1: Request-first parsing and option model
  - [ ] 1.1 Update `ClarifyOptions` and workflow-related types
    - Modify `extensions/clarification-orchestrator/types.ts` to replace topic-first `ClarifyOptions.topic` with `request`, `proposedTopic?`, and `confirmedTopic?` for new `/clarify` runs.
    - Remove public `/clarify` option fields `mode`, `maxRounds`, `threshold`, and command-level `reviewers` from `ClarifyOptions`; keep default reviewer configuration in config-level types.
    - Add `ResumeStatus`, `DesignGateAction`, `DesignGateDecision`, `TopicCandidate`, `CrossReviewProgress`, and version metadata types needed by the design.
    - _Requirements: 1.1, 1.2, 1.3, 3.4, 6.1, 7.2, 8.1_
  - [ ] 1.2 Rewrite `/clarify` argument parsing
    - Modify `extensions/clarification-orchestrator/options.ts` `parseClarifyArgs` to treat all non-option text as `request`.
    - Allow only `--resume`, `--verbose`, and `--dry-run` for `/clarify`.
    - Return the new usage error for missing request without `--resume`.
    - Reject removed options `--mode`, `--threshold`, `--max-rounds`, and `--reviewers` with clear messages.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_
  - [ ] 1.3 Update config defaults usage for removed command options
    - Modify `extensions/clarification-orchestrator/config.ts` and call sites that currently expect `options.mode`, `options.maxRounds`, `options.threshold`, or `options.reviewers`.
    - Keep reviewer defaults in package/user/project config for cross-review but remove command-line override behavior.
    - Ensure backward-incompatible option removal is covered by validation errors rather than silent fallback.
    - _Requirements: 1.5, 7.1, 11.2_
  - [ ]* 1.4 Add parser unit tests
    - Update `tests/unit/options.test.ts` for natural-language requests, quoted text, Chinese text, `--resume`, supported options, missing request, and removed-option rejection.
    - Test that request text is preserved and not slugified by the parser.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

- [ ] 2. Phase 2: Topic proposal and confirmation
  - [ ] 2.1 Create topic proposal module
    - Add `extensions/clarification-orchestrator/topic-proposal.ts` with `generateTopicCandidates(request, existingTopics)` and `renderTopicChoices(candidates)`.
    - Implement deterministic candidate normalization for English requests and heuristic translation/gloss metadata fields for non-English requests.
    - Include weak/generic slug detection and candidate metadata matching the design.
    - _Requirements: 2.1, 2.2, 2.3, 2.5_
  - [ ] 2.2 Add existing-topic conflict and near-duplicate detection
    - Implement `listExistingSpecTopics(cwd)` and `findSimilarExistingTopics(candidate, existingTopics)` in `topic-proposal.ts` or a focused helper.
    - Detect exact directory conflicts under `specs/` and conservative semantic near-duplicates such as stemming/synonym-like normalized matches.
    - Surface reuse/edit/manual choices without creating artifacts first.
    - _Requirements: 2.4, 2.5, 7.1_
  - [ ] 2.3 Implement interactive topic confirmation boundary
    - Modify `extensions/clarification-orchestrator/commands/clarify.ts` to propose topics before `resolveSpecPaths` and `createRun`.
    - Add a small UI helper in `extensions/clarification-orchestrator/user-gate.ts` such as `confirmTopicCandidate(...)` that prompts for choose/reuse/edit/manual.
    - Validate confirmed topics through `resolveSpecPaths` and existing path guards before run creation.
    - _Requirements: 2.6, 2.7, 10.1, 10.5_
  - [ ] 2.4 Persist request and topic proposal artifacts
    - Modify `extensions/clarification-orchestrator/artifact-store.ts` to support request capture and topic proposal artifacts before or immediately after run creation.
    - Write `request.md` and `topic-proposal.json` into the run directory once the topic is confirmed.
    - Ensure `metadata.json` or the new state metadata records the original request and confirmed topic.
    - _Requirements: 2.7, 3.1, 3.4_
  - [ ]* 2.5 Add topic proposal and path safety tests
    - Add `tests/unit/topic-proposal.test.ts` for English and Chinese candidate generation, gloss metadata, weak candidate handling, exact conflicts, and near-duplicate warnings.
    - Update `tests/security/path-traversal.test.ts` for generated and user-edited topic rejection.
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 10.5_

- [ ] 3. Checkpoint - Verify request parsing and topic confirmation
  - Run `npm run typecheck` and `npm run test:unit -- tests/unit/options.test.ts tests/unit/topic-proposal.test.ts` if supported by the test runner.
  - Manually dry-run `/clarify <request> --dry-run` in an interactive-capable harness and confirm no `specs/<request>` directory is created before topic confirmation.
  - _Requirements: 1.1, 1.5, 2.7, 10.2_

- [ ] 4. Phase 3: Artifact layout, metadata, and resume statuses
  - [ ] 4.1 Introduce versioned artifact paths
    - Modify `extensions/clarification-orchestrator/artifact-store.ts` `RunPaths` and write helpers to support `metadata.json`, `versions/v<N>/`, `reviews/round-<N>/`, and latest `design.md` mirroring.
    - Add helper functions such as `writeVersionedDesign(paths, version, content)`, `writeDesignGateDecision(paths, version, decision)`, and `writeReviewRoundArtifact(paths, round, name, value)`.
    - Keep path validation centralized through `assertArtifactPathAllowed` and `assertSafeRelativeArtifactPath`.
    - _Requirements: 3.1, 3.2, 3.3, 3.6_
  - [ ] 4.2 Replace broad phase-only state with resume-aware metadata
    - Modify `extensions/clarification-orchestrator/types.ts` and `artifact-store.ts` to add canonical run metadata fields: request summary, `resumeStatus`, `currentPhase`, latest version, active round, pending decision IDs, last updated time, and resume hint.
    - Preserve compatibility or provide migration for existing `state.json` where practical.
    - Record methodology version fields in metadata and final approval data structures.
    - _Requirements: 3.4, 3.5, 8.1, 8.2_
  - [ ] 4.3 Implement status-specific resume routing
    - Modify `extensions/clarification-orchestrator/workflow.ts` `resumeWorkflow` to route by `resumeStatus` instead of only stepping to the next phase.
    - Update `extensions/clarification-orchestrator/commands/clarify.ts` to support `/clarify --resume` without topic and scan resumable runs.
    - Add helper functions in `artifact-store.ts` to discover resumable runs across `specs/*/clarification/*/metadata.json`.
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - [ ] 4.4 Update status and diff commands for new layout compatibility
    - Modify `extensions/clarification-orchestrator/commands/status.ts`, `run-diff.ts`, and related tests to read metadata and version/review directories.
    - Keep `/clarify-status`, `/clarify-diff`, and `/clarify-clean` topic-oriented for this change.
    - _Requirements: 3.1, 3.3, 8.2_
  - [ ]* 4.5 Add artifact and resume tests
    - Update `tests/unit/artifact-store.test.ts` for versioned design snapshots, metadata fields, review round artifact paths, and path rejection.
    - Update `tests/integration/resume.test.ts` for every resume status and multiple pending runs.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.6, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [ ] 5. Phase 4: Package-owned lifecycle methodology resources and skills
  - [ ] 5.1 Add lifecycle methodology prompt resources
    - Create `prompts/brainstorming-methodology.md` with `methodologyVersion: brainstorming-pro-v1` and the canonical V0 clarification methodology.
    - Create `prompts/spec-plan-methodology.md` with `methodologyVersion: spec-plan-pro-v1` and lifecycle handoff contract only.
    - Create `prompts/spec-exec-methodology.md` with `methodologyVersion: spec-exec-pro-v1` and execution boundary contract only.
    - Create or update `prompts/clarify-v0.md` to reference/include `brainstorming-methodology.md` plus clarify-specific constraints.
    - _Requirements: 4.1, 4.2, 4.5, 9.2_
  - [ ] 5.2 Add package-owned lifecycle skills
    - Create `skills/brainstorming-pro/SKILL.md` or update the existing file to reference the canonical prompt resource and `/clarify` boundary.
    - Create `skills/spec-plan-pro/SKILL.md` describing consumption of approved `design.md` and final approval artifacts to produce user-approved `requirements.md` and `tasks.md`.
    - Create `skills/spec-exec-pro/SKILL.md` describing refusal to execute without approved planning artifacts and pause-on-scope-change behavior.
    - Ensure `package.json` `pi.skills` continues to include the skills directory.
    - _Requirements: 4.3, 4.4, 9.3, 9.5, 9.7, 11.5_
  - [ ] 5.3 Update prompt loading code
    - Modify `extensions/clarification-orchestrator/prompts.ts` to load methodology markdown resources instead of embedding long methodology text in TypeScript.
    - Update `extensions/clarification-orchestrator/phases/discovery.ts` or the new V0 phase module to use `clarify-v0.md` and record `brainstorming-pro-v1` in metadata/discovery artifacts.
    - _Requirements: 4.1, 4.2, 4.5, 5.1, 5.2, 5.3_
  - [ ]* 5.4 Add prompt and package validation tests
    - Update `tests/unit/prompts.test.ts` to assert `clarify-v0.md` references the shared methodology resource and does not duplicate divergent methodology text in TypeScript.
    - Update `scripts/validate-package.ts` tests or validation logic to check lifecycle skill files and methodology resources exist.
    - _Requirements: 4.1, 4.3, 4.5, 11.5_

- [ ] 6. Phase 5: V0 design generation and design review gate loop
  - [ ] 6.1 Replace old linear workflow phases with the design gate state machine
    - Modify `extensions/clarification-orchestrator/workflow.ts` to implement `REQUEST_CAPTURE -> TOPIC_PROPOSAL -> TOPIC_CONFIRMATION -> V0_BRAINSTORMING -> DESIGN_REVIEW_GATE` and gate-selected transitions.
    - Remove or bypass old automatic `DISCOVERY -> REVIEW -> TRIAGE -> USER_DECISION -> REFINE -> VERIFY -> FINAL_APPROVAL` progression for the new `/clarify` command.
    - Keep termination states `COMPLETE`, `ABORTED`, and `INTERRUPTED` compatible with existing status reporting.
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.3, 6.4, 6.5, 6.6_
  - [ ] 6.2 Implement V0 design artifact writing
    - Modify `extensions/clarification-orchestrator/phases/discovery.ts` or create `extensions/clarification-orchestrator/phases/v0-brainstorming.ts` to write `versions/v0/design.md`, `versions/v0/discovery.md`, and top-level `design.md`.
    - Record assumptions, blind spots, request summary, and methodology version in discovery metadata.
    - _Requirements: 3.2, 4.2, 5.1, 5.2, 5.3_
  - [ ] 6.3 Implement design review gate collection and persistence
    - Add `presentDesignReviewGate(...)` and `parseDesignGateAction(...)` to `extensions/clarification-orchestrator/user-gate.ts`.
    - Persist decisions to `versions/v<N>/design-gate.json` with version, action, reason, and timestamp.
    - Show version, design path, latest change summary, open questions, pending blockers, and four allowed actions.
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ] 6.4 Implement conversational revision flow
    - Add `extensions/clarification-orchestrator/phases/conversational-revision.ts` or equivalent orchestration for revision classification and version increments.
    - Write `versions/v<N>/revision.md`, `revision.json`, and updated design snapshots only when design content changes.
    - Record cross-review recommendation reason for review-worthy revisions without auto-launching subagents.
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 6.5_
  - [ ]* 6.5 Add design gate and revision tests
    - Add or update `tests/integration/workflow.test.ts` and `tests/integration/decision-gate.test.ts` for v0 approve, v0 revise, save-and-exit resume, and gate artifact persistence.
    - Add unit tests for `parseDesignGateAction` accepting only approve/review/revise/save.
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 6.1, 6.2, 6.3, 6.5, 6.6_

- [ ] 7. Checkpoint - Verify design gate loop MVP
  - Run `npm run typecheck`, `npm run test:unit`, and targeted integration tests for v0 approve/revise/save flows.
  - Confirm top-level `specs/<topic>/design.md` always mirrors the latest complete version.
  - Confirm `/clarify` final approval does not call `/spec-plan`.
  - _Requirements: 3.2, 6.1, 6.3, 6.5, 6.6, 9.1_

- [ ] 8. Phase 6: Cross-review issue decision changes and progress recovery
  - [ ] 8.1 Remove threshold filtering from issue decision planning
    - Modify `extensions/clarification-orchestrator/user-gate.ts` `planDecisions` or replace it for the new workflow so every P0/P1/P2/P3 issue enters the user decision gate by default.
    - Remove public mode/threshold behavior from decision planning while keeping internal config hooks only if needed later.
    - Ensure accepted, rejected, deferred, and discussed decisions are all persisted.
    - _Requirements: 7.5, 7.6, 7.7, 1.5_
  - [ ] 8.2 Block refinement and approval on discussed issues
    - Update `resolveNeedsDiscussion`, workflow transitions, and design gate approval checks so active-round `discuss`/`needs-discussion` issues populate pending decisions and block `REFINE` and approve.
    - Route `/clarify --resume` with pending issues directly to `ISSUE_DECISION_GATE`.
    - _Requirements: 6.7, 7.8, 8.5_
  - [ ] 8.3 Update cross-review progress and quorum behavior
    - Modify `extensions/clarification-orchestrator/phases/review.ts`, `progress.ts`, and `process-lifecycle.ts` to persist `CrossReviewProgress` snapshots with reviewer queued/running/succeeded/failed/retrying status.
    - Enforce 3-of-4 default reviewer quorum before triage and highlight failed risk or architecture reviewer failures.
    - Emit bounded heartbeat updates for long-running reviewers.
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.6_
  - [ ] 8.4 Ensure refiner safety with accepted issues only
    - Modify `extensions/clarification-orchestrator/phases/refine.ts` to pass only accepted issue IDs and to write the refined design as the next integer version.
    - Validate refiner output before updating top-level `design.md`.
    - Preserve previous latest design if validation or refiner execution fails.
    - _Requirements: 7.6, 7.9, 3.2_
  - [ ]* 8.5 Add cross-review, decision, and failure tests
    - Update `tests/integration/quality-gates.test.ts`, `tests/integration/observability.test.ts`, and `tests/integration/decision-gate.test.ts` for all-severity decisions, pending discussion blocking, quorum, retry limit, heartbeat/progress snapshots, and refiner failure safety.
    - Update `tests/unit/issues.test.ts` or add focused tests for accepted-only refiner input.
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.5, 8.6_

- [ ] 9. Phase 7: Lifecycle command boundaries and final approval handoff
  - [ ] 9.1 Update final approval rendering
    - Modify `extensions/clarification-orchestrator/phases/final-approval.ts` `renderFinalApprovalSummary` to print `Next step: run /spec-plan <topic>`.
    - Include approved design path, clarification artifact path, final approval path, accepted/rejected/deferred issues, unresolved risks, and methodology version recommendations.
    - Remove old wording that says `Run spec-plan` without the slash command or package-owned boundary.
    - _Requirements: 9.1, 9.2, 6.3_
  - [ ] 9.2 Register lifecycle command boundary handlers
    - Modify `extensions/clarification-orchestrator/index.ts` to register `/spec-plan` and `/spec-exec` commands in addition to `/clarify`.
    - Add `extensions/clarification-orchestrator/commands/spec-plan.ts` with a boundary handler that validates an approved `design.md`/final approval context and reports that full planning workflow is separate or delegates to `spec-plan-pro` once implemented.
    - Add `extensions/clarification-orchestrator/commands/spec-exec.ts` with a boundary handler that refuses execution unless approved `requirements.md` and `tasks.md` exist.
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ] 9.3 Add planning/execution approval detection helpers
    - Add helper functions in `artifact-store.ts` or a new `lifecycle-handoff.ts` to locate approved `design.md`, `final-approval.md`, `requirements.md`, and `tasks.md` for a topic.
    - Implement conservative approval detection fields or markers for future `/spec-plan` and `/spec-exec` specs without inventing full workflows here.
    - _Requirements: 9.4, 9.5, 9.6, 9.7_
  - [ ]* 9.4 Add lifecycle command tests
    - Add unit or integration tests ensuring final approval prints `/spec-plan <topic>` and does not invoke it automatically.
    - Test `/spec-plan <topic>` fails clearly without approved design context.
    - Test `/spec-exec <topic>` refuses to run without approved `requirements.md` and `tasks.md`.
    - _Requirements: 9.1, 9.3, 9.4, 9.5_

- [ ] 10. Phase 8: Non-interactive behavior and security hardening
  - [ ] 10.1 Enforce interactive gates
    - Modify `commands/clarify.ts`, topic confirmation, design gate, and issue gate code paths to fail fast in non-interactive non-dry-run contexts.
    - Ensure `--dry-run` can still validate input and produce planned debug artifacts without subagents.
    - _Requirements: 10.1, 10.2_
  - [ ] 10.2 Preserve project-local trust and untrusted-data boundaries
    - Review `extensions/clarification-orchestrator/config.ts`, `agents.ts`, `prompts.ts`, and `runner.ts` to ensure project-local agents/config require existing confirmations.
    - Ensure downstream prompts delimit prior artifacts and subagent output as untrusted data.
    - _Requirements: 10.3, 10.4, 10.6_
  - [ ] 10.3 Harden topic and artifact path validation
    - Extend `path-guard.ts` and topic confirmation tests to reject traversal, absolute paths, hidden control characters, unsafe separators, and writes outside `specs/<topic>/`.
    - Ensure new version/review artifact helpers call existing path guards.
    - _Requirements: 3.6, 10.5, 10.6_
  - [ ]* 10.4 Add security regression tests
    - Update `tests/security/project-local.test.ts`, `tests/security/prompt-injection.test.ts`, and `tests/security/path-traversal.test.ts` for the new request-first and topic-confirmation flows.
    - Test malicious reviewer/triager/refiner output cannot write arbitrary files or override workflow instructions.
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

- [ ] 11. Phase 9: Documentation, README, and package validation
  - [ ] 11.1 Update README command documentation
    - Modify `README.md` to describe `/clarify <request>`, `/clarify --resume`, `/spec-plan <topic>`, and `/spec-exec <topic>`.
    - Remove public `/clarify` docs for `--mode`, `--threshold`, `--max-rounds`, and `--reviewers`.
    - Document explicit lifecycle gates and that `/clarify` does not auto-run `/spec-plan`.
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 9.1_
  - [ ] 11.2 Update package and skill validation
    - Modify `scripts/validate-package.ts` to validate new lifecycle prompts and skill files.
    - Ensure `package.json` command/skill/prompt resource declarations remain correct for the package layout.
    - _Requirements: 4.3, 11.5_
  - [ ] 11.3 Update existing package skill docs
    - Modify `skills/brainstorming-pro/SKILL.md` to reflect `/clarify` request-first design gate workflow and `/spec-plan` handoff.
    - Ensure `spec-plan-pro` and `spec-exec-pro` skill docs clearly state their boundaries and refusal behavior.
    - _Requirements: 4.3, 9.3, 9.5, 11.3_
  - [ ]* 11.4 Run full validation suite
    - Run `npm run typecheck`, `npm test`, and `npm run validate-package`.
    - Fix any regressions caused by changed command parsing, artifact layout, workflow state, or tests.
    - _Requirements: 1.1, 2.7, 3.6, 4.5, 6.1, 7.5, 8.1, 9.1, 10.6, 11.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP, but they should be completed before shipping the package change.
- This plan intentionally keeps full `/spec-plan` and `/spec-exec` workflows out of scope. Phase 7 only adds command boundary behavior and handoff validation required by the approved design.
- The old implementation uses `state.json`, `01-discovery.md`, `02-design-v1.md`, threshold-based decisions, and a linear verification loop. The new implementation should migrate or replace these carefully so existing tests are updated intentionally rather than accidentally broken.
- Keep all prior artifacts and subagent outputs treated as untrusted data. Only orchestrator-owned validated artifact APIs should write files.
