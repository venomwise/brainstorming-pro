# Implementation Plan: Agent Execution Runtime

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md).

The work is split into eight phases. First, define the internal type surface and role policy so all later modules share the same safety model. Next, implement safe launch resolution, prompt/audit file layout, foreground spawn/output capture, structured validation, and the `runAgent()` orchestrator. After the runtime is functional, add child-mode command registration prevention and then comprehensive unit, integration, security, attribution, and documentation validation. The implementation uses TypeScript ES modules under `extensions/clarification-orchestrator/runtime/agent-execution/`, Node built-ins for filesystem and child process work, and existing project conventions for strict typing, path safety, provider-qualified model policy, and tests using `node --test`.

## Tasks

- [✅] 1. Phase 1: Define agent execution domain types and role policy
  - [✅] 1.1 Create shared agent execution types
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/types.ts` with `AgentRole`, `AgentWorkflowContext`, `AgentRunRequest<TOutput>`, `AgentRunResult<TOutput>`, `AgentRunStatus`, `AgentRunError`, `AgentRunErrorKind`, `AgentRunLimits`, `AgentRunPaths`, `AgentOutputCaptureSummary`, `AgentOutputSchema<TOutput>`, and `AgentProgressEvent`
    - Import `WorkflowPhase`, `ArtifactKind`, and `VersionedArtifactRef` from `extensions/clarification-orchestrator/workflow/types.ts` using explicit `.ts` imports
    - Keep types generic enough for adapters/review panels to supply business-specific output schemas
    - _Requirements: 1.1, 1.2, 7.6, 9.1_
  - [✅] 1.2 Implement internal role registry
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/roles.ts` with `AgentRoleDefinition`, `AGENT_ROLE_DEFINITIONS`, `getAgentRoleDefinition()`, and `validateRoleForPhase()`
    - Define first-version roles `design-author`, `design-reviser`, `plan-author`, `task-executor`, and `minimal-reviewer`
    - Set `allowSkills: false` and `allowSession: false` for every first-version role
    - Encode allowed phases and default timeout/retry/output limits from the approved design
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - [✅] 1.3 Implement typed failure helpers
    - Add helper constructors in `types.ts` or a small `errors.ts` module for policy, spawn, timeout, output, validation, recursion, and unexpected failure results
    - Ensure failure helpers produce `AgentRunResult<T>`-compatible error shapes without mutating workflow state
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.6_
  - [✅]* 1.4 Write unit tests for type-adjacent role policy behavior
    - Create `tests/unit/agent-execution-roles.test.ts`
    - Test every first-version role exists with `allowSkills: false` and `allowSession: false`
    - Test unknown roles and phase mismatches are rejected before any spawn dependency is needed
    - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3, 2.4_

- [✅] 2. Phase 2: Implement recursion guard, model policy, and safe launch spec builder
  - [✅] 2.1 Implement recursion guard
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/recursion-guard.ts`
    - Export constants for `BRAINSTORMING_PRO_CHILD`, `BRAINSTORMING_PRO_PARENT_RUN_ID`, `BRAINSTORMING_PRO_AGENT_RUN_ID`, `BRAINSTORMING_PRO_AGENT_ROLE`, and `BRAINSTORMING_PRO_DEPTH`
    - Implement `getCurrentAgentDepth(env?)`, `assertCanLaunchChild(env?)`, and child env metadata builder helpers with max depth `1`
    - _Requirements: 3.6, 8.1, 8.2, 8.3_
  - [✅] 2.2 Implement provider-qualified model policy wrapper
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/model-policy.ts`
    - Reuse or mirror the existing provider-qualified model validation policy used elsewhere in the project; if no reusable helper exists, add a narrow helper with tests rather than weakening validation
    - Return typed model-policy failure data before launch when invalid
    - _Requirements: 2.4, 3.1, 11.2, 11.3_
  - [✅] 2.3 Implement launch spec type and builder
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/launch-spec.ts`
    - Implement `AgentLaunchSpec` and `buildAgentLaunchSpec()` that accepts resolved Pi invocation, role policy, prompt paths, output directory, model, env metadata, and child args
    - Include `--no-session` and `--no-skills` as independent argv entries for every launch
    - Ensure the launch spec uses `shell: false`, explicit `stdio: "pipe"`, trusted project cwd, and topic-scoped output directory
    - _Requirements: 3.1, 3.4, 3.5, 4.5_
  - [✅] 2.4 Integrate deterministic Pi invocation resolver semantics
    - Create or reuse a resolver-facing helper so launch specs use the approved resolution order: explicit command, `PI_COMMAND`, current process derived command, sibling/package fallback, bare `pi`
    - Treat `PI_COMMAND` as one executable path only; do not split it and do not run it through a shell
    - If the existing resolver spec has not yet produced a reusable module, implement a minimal internal adapter in `launch-spec.ts` with the same behavior and tests
    - _Requirements: 3.2, 3.3, 3.5, 10.5_
  - [✅]* 2.5 Write launch, recursion, and model policy tests
    - Create `tests/unit/agent-execution-launch.test.ts`
    - Test `--no-session`, `--no-skills`, `shell: false`, env marker/depth fields, and trusted cwd/output directory
    - Test `PI_COMMAND="node /tmp/pi.js"` is treated as a single invalid/missing executable path rather than split into command and args
    - Test invalid model policy and recursion depth reject before spawn
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2, 8.3, 11.1, 11.2_

- [✅] 3. Phase 3: Implement topic-scoped prompt and audit file layout
  - [✅] 3.1 Implement prompt and audit path builder
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/prompt-files.ts`
    - Implement `createAgentRunDirectory()` and `writeAgentPromptFiles()` for `specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/`
    - Validate or construct identifiers so paths cannot escape the topic workflow directory
    - Use existing path guard helpers from `extensions/clarification-orchestrator/path-guard.ts` where applicable
    - _Requirements: 4.1, 4.2, 4.4, 4.5_
  - [✅] 3.2 Implement metadata and result file writers
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/audit-files.ts` or include focused helpers in `prompt-files.ts`
    - Write `metadata.json` and `result.json` with redacted command/env metadata, role, phase, timing, attempts, exit metadata, output paths, and validation diagnostics
    - Do not write full inherited environment values to metadata
    - _Requirements: 3.7, 4.3, 4.6, 6.6, 11.5_
  - [✅] 3.3 Implement atomic or safe UTF-8 file writing helper usage
    - Reuse `extensions/clarification-orchestrator/workflow/atomic-json.ts` for JSON where appropriate or add a narrow helper for agent runtime files
    - Ensure prompt/system prompt files are written with deterministic UTF-8 content and parent directories are created safely
    - _Requirements: 4.1, 4.2, 4.3, 4.6_
  - [✅]* 3.4 Write path and audit file tests
    - Create `tests/unit/agent-execution-files.test.ts`
    - Test prompt/system prompt/stdout/stderr/raw-output/result/metadata paths stay under the topic workflow directory
    - Test path traversal inputs are rejected or impossible by construction
    - Test metadata redacts inherited env and writes diagnostics for pre-spawn failures
    - _Requirements: 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [✅] 4. Phase 4: Implement foreground spawn and bounded output capture
  - [✅] 4.1 Implement foreground spawn wrapper
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/spawn.ts`
    - Implement `spawnAgentProcess()` around `child_process.spawn` with `shell: false`, explicit pipe stdio, no detached mode, cwd/env from launch spec, and typed spawn result
    - Capture exit code, signal, spawn errors, and process duration
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6, 11.3_
  - [✅] 4.2 Implement timeout handling
    - Add timeout support to `spawnAgentProcess()` using role/request limits
    - Kill the child on timeout, preserve partial output, and return typed timeout status metadata
    - Ensure timers/listeners are cleaned up after process completion
    - _Requirements: 5.2, 6.1, 11.3_
  - [✅] 4.3 Implement bounded output capture
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/output.ts`
    - Capture stdout and stderr into bounded buffers and files `stdout.txt` and `stderr.txt`
    - Produce `raw-output.txt` according to the selected raw output extraction policy and record truncation flags/byte counts in `AgentOutputCaptureSummary`
    - _Requirements: 4.3, 6.2, 6.3, 11.5_
  - [✅] 4.4 Implement retry attempt handling
    - Add attempt loop support either in `spawn.ts` or the later `run-agent.ts` orchestration layer using role/request max retry limits
    - Preserve each attempt's metadata distinctly when retry occurs
    - Restrict retries to configured retryable failure kinds only
    - _Requirements: 6.4, 6.5, 6.6_
  - [✅]* 4.5 Write spawn/output unit tests with injected fake spawn dependencies
    - Create `tests/unit/agent-execution-spawn.test.ts`
    - Test success, non-zero exit, signal, spawn error, timeout, stdout/stderr truncation, and cleanup of timers/listeners
    - Test no detached mode and no shell mode are used
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 6.1, 6.2, 6.3_

- [✅] 5. Phase 5: Implement structured output validation and progress events
  - [✅] 5.1 Implement structured output validation module
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/result-validation.ts`
    - Implement `validateAgentOutput<T>()` using caller-provided `AgentOutputSchema<T>` parse and validate operations
    - Return typed success or validation failure without throwing untyped schema errors to callers
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6, 11.3_
  - [✅] 5.2 Implement progress event helpers
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/progress.ts`
    - Add `emitAgentProgress()` helper that invokes optional callbacks and records callback failures as diagnostics without making UI state authoritative
    - Define event constructors for `agent.started`, `agent.output`, `agent.retrying`, `agent.completed`, and `agent.failed`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_
  - [✅] 5.3 Connect output capture to progress events
    - Emit output progress events from the output capture path with stream name, bytes, run id, and timestamp
    - Emit retry and terminal events from retry/spawn orchestration as appropriate
    - Ensure progress callback errors do not change `AgentRunResult.status`
    - _Requirements: 9.2, 9.3, 9.4, 9.5_
  - [✅]* 5.4 Write validation and progress tests
    - Create `tests/unit/agent-execution-validation.test.ts` and/or `tests/unit/agent-execution-progress.test.ts`
    - Test malformed JSON/raw output, schema mismatch, schema success, callback failure diagnostics, and event order for success/failure/retry
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 9.1, 9.2, 9.3, 9.4, 9.5_

- [✅] 6. Phase 6: Implement `runAgent()` orchestration and child command registration prevention
  - [✅] 6.1 Implement main `runAgent()` orchestration
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/run-agent.ts`
    - Wire role validation, model policy, recursion guard, limits merging, agent run directory creation, prompt file writing, launch spec building, progress events, spawn/output capture, retry handling, result validation, metadata/result writing, and final `AgentRunResult<T>` creation
    - Ensure every failure path returns a typed result and does not mutate workflow state
    - _Requirements: 1.1, 1.2, 1.5, 5.2, 7.1, 7.4, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_
  - [✅] 6.2 Export the internal runtime surface
    - Create or update `extensions/clarification-orchestrator/runtime/agent-execution/index.ts`
    - Export only internal types and `runAgent()` helpers needed by phase adapters; do not register commands/tools or expose generic orchestration helpers
    - _Requirements: 1.6, 10.3, 10.4_
  - [✅] 6.3 Prevent workflow command registration in child mode
    - Modify `extensions/clarification-orchestrator/index.ts` to check `BRAINSTORMING_PRO_CHILD=1` before registering `/brainstorm-pro`
    - Keep parent process registration behavior unchanged when the child marker is absent
    - Add no child-only command surface as part of this change
    - _Requirements: 8.1, 8.4, 8.5, 10.3_
  - [✅]* 6.4 Write `runAgent()` orchestration tests
    - Create `tests/unit/agent-execution-run-agent.test.ts`
    - Use injected fake spawn/resolver/schema dependencies where practical to test success, role rejection, model rejection, recursion rejection, validation failure, timeout, retry, and failure result stability
    - Assert workflow state/artifact/gate objects passed in context are not mutated
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.4, 8.2, 8.3, 11.1, 11.2, 11.3, 11.4, 11.6_
  - [✅]* 6.5 Write child-mode registration tests
    - Create `tests/unit/agent-execution-child-registration.test.ts` or extend an existing command registration test
    - Import the extension with `BRAINSTORMING_PRO_CHILD=1` and assert no `/brainstorm-pro` command or parent workflow handlers are registered
    - Import without child marker and assert existing `/brainstorm-pro` registration still occurs
    - _Requirements: 8.4, 8.5, 10.3_

- [✅] 7. Phase 7: Add integration, security, and product-boundary coverage
  - [✅] 7.1 Add fake child command fixtures
    - Create fixture scripts under `tests/fixtures/agent-execution/` for valid structured output, non-zero exit, timeout/sleep, huge output, malformed JSON, schema mismatch, and env/args echo
    - Ensure fixtures are deterministic and do not call real LLMs or external services
    - _Requirements: 5.3, 5.4, 5.6, 6.1, 6.2, 7.2, 7.3_
  - [✅]* 7.2 Write integration tests using fake child commands
    - Create `tests/integration/agent-execution-runtime.test.ts`
    - Run `runAgent()` end-to-end against fake child fixtures through the real prompt/audit/spawn/output/validation stack where possible
    - Assert valid output success, non-zero exit failure, timeout, huge output truncation, malformed output invalidation, schema mismatch invalidation, and expected child env/args
    - _Requirements: 3.4, 3.6, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 5.6, 6.1, 6.2, 7.1, 7.2, 7.3_
  - [✅]* 7.3 Write security tests for launch and product boundaries
    - Create `tests/security/agent-execution-runtime.test.ts`
    - Assert no public `subagent` tool/command, no `single`/`parallel`/`chain`/`async` public API, no shell parsing for `PI_COMMAND`, and no child workflow command registration
    - Assert `runAgent()` cannot write approval files, directly transition workflow state, or directly commit artifact versions
    - _Requirements: 1.5, 1.6, 3.3, 7.4, 8.4, 8.5, 10.3, 11.4_
  - [✅]* 7.4 Update reuse inventory and attribution validation if code is derived from `pi-subagents`
    - If any implementation file copies or derives code from `nicobailon/pi-subagents`, add the required attribution header to that file
    - Update `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json` with source module, target module, adaptation notes, and product boundary notes
    - Extend `scripts/validate-package.ts` tests/checks if new derived file patterns need validation
    - _Requirements: 10.1, 10.2, 10.4, 10.5_

- [✅] 8. Checkpoint - Verify Agent Execution Runtime against requirements
  - Run `npm run typecheck`
  - Run targeted tests for agent execution unit, integration, and security coverage
  - Run `npm test`
  - Run `npm run validate-package`
  - Inspect `extensions/clarification-orchestrator/runtime/agent-execution/` to confirm no public command/tool registration and no generic orchestration APIs were added
  - Inspect generated test artifacts to confirm agent run files stay under `specs/<topic>/.workflow/runs/<run-id>/agents/<agent-run-id>/`
  - Confirm requirements covered: 1.1-1.6, 2.1-2.5, 3.1-3.7, 4.1-4.6, 5.1-5.6, 6.1-6.6, 7.1-7.6, 8.1-8.5, 9.1-9.6, 10.1-10.5, 11.1-11.6
  - Stop only if validation fails, the implementation would require changing approved requirements, fake child fixtures are unavailable, or a security/product-boundary invariant cannot be satisfied

- [✅]* 9. Optional Phase: Documentation and follow-up integration notes
  - [✅] 9.1 Update scaffold documentation
    - Update `extensions/clarification-orchestrator/runtime/agent-execution/README.md` to summarize implemented files, safety defaults, fake child testing strategy, and how phase adapters should call `runAgent()`
    - Do not document any public user-facing subagent command because none exists
    - _Requirements: 1.6, 10.3, 10.4_
  - [✅] 9.2 Add follow-up notes for Spec 4 adapters
    - Add a short note in `specs/agent-execution-runtime/design.md` or a local implementation note describing how `BrainstormingPhaseAdapter`, `SpecPlanPhaseAdapter`, and `SpecExecPhaseAdapter` should supply prompts and schemas without loading child skills
    - Keep the note aligned with the approved `--no-skills` decision
    - _Requirements: 1.1, 7.6, 10.4_
  - [✅] 9.3 Add troubleshooting guidance for Pi invocation failures
    - If existing README troubleshooting is not sufficient, add a concise internal note or README section explaining `PI_COMMAND` as a single executable path and pointing to doctor/resolver guidance if available
    - Do not introduce support for shell command strings or arguments in `PI_COMMAND`
    - _Requirements: 3.2, 3.3, 5.6_

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP, but the final checkpoint should still run all tests that exist at that point.
- Agent runtime code must remain internal infrastructure. It should not register Pi commands/tools and should not expose generic orchestration as a product API.
- If implementation needs exact Pi CLI prompt/system prompt file flags, inspect the installed Pi documentation before coding and preserve `--no-session`, `--no-skills`, and `shell: false` invariants.
- If future specs require child skill loading, that must be designed as a separate explicit exception; this spec's first version always uses `--no-skills`.
