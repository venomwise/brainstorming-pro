# Implementation Plan: Pi Subagents Infrastructure Reuse

## Overview

This implementation plan is driven by the requirements in [requirements.md](requirements.md). The work is organized into seven phases: establish the reuse inventory and attribution scaffold, enforce package validation for derived-code metadata, add product-boundary tests, create minimal derived-helper placement conventions, add optional helper/test migrations, update documentation, and run final validation. The policy and validation layers come first so later agent execution runtime and TUI specs can safely import infrastructure without re-litigating license, placement, or product-boundary rules.

The implementation is TypeScript and markdown inside the existing Pi package. It intentionally avoids adding `pi-subagents` as a runtime dependency and does not implement the full agent execution runtime, workflow TUI, background async runner, intercom, or generic subagent delegation.

## Tasks

- [✅] 1. Phase 1: Establish reuse inventory and attribution scaffold
  - [✅] 1.1 Create the upstream reuse inventory
    - Create `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json`
    - Define entries with `upstreamPath`, `targetPath`, `classification`, `status`, `adaptationNotes`, and `productBoundaryNotes` fields
    - Add entries for `src/tui/render-helpers.ts`, `src/shared/formatters.ts`, `src/shared/atomic-json.ts`, `src/shared/jsonl-writer.ts`, `src/shared/file-coalescer.ts`, `src/tui/render.ts`, `src/slash/slash-live-state.ts`, `src/shared/status-format.ts`, `src/runs/shared/pi-args.ts`, `src/runs/shared/pi-spawn.ts`, `src/runs/shared/single-output.ts`, `src/shared/artifacts.ts`, `src/extension/index.ts`, `src/runs/background/*`, `src/intercom/*`, and `src/agents/*`
    - Classify entries as `direct-vendor`, `adapted-infrastructure`, `reference-only`, or `not-reused`
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [✅] 1.2 Add MIT license and notice files
    - Create `extensions/clarification-orchestrator/vendor/pi-subagents/LICENSE` with the upstream MIT license notice from `nicobailon/pi-subagents`
    - Create `extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md` with source URL, license, imported commit/version placeholder, imported modules summary, local modifications summary, and sync record section
    - Ensure the notice explains that copied code is adapted for Brainstorming Pro workflow runtime semantics
    - _Requirements: 2.1, 2.2, 2.4, 7.1_
  - [✅] 1.3 Document derived file header policy
    - Create `extensions/clarification-orchestrator/vendor/pi-subagents/README.md`
    - Include the required TypeScript header format for derived files and examples for direct vendoring, adapted infrastructure, and rewritten-from-reference files
    - Document approved target directories: `extensions/clarification-orchestrator/tui/`, `extensions/clarification-orchestrator/workflow/`, `extensions/clarification-orchestrator/runtime/agent-execution/`, and any derived helper directory chosen by implementation
    - _Requirements: 2.3, 3.1, 3.2, 3.3_
  - [✅]* 1.4 Add inventory shape tests
    - Create `tests/unit/pi-subagents-reuse-inventory.test.ts`
    - Test that every inventory entry has required fields, valid classification/status values, and a non-empty boundary note
    - Test that reference-only and not-reused entries have no imported local target requirement
    - _Requirements: 1.1, 1.5, 1.6, 6.1_

- [✅] 2. Phase 2: Enforce attribution and inventory validation
  - [✅] 2.1 Extend package validation for reuse metadata
    - Modify `scripts/validate-package.ts` to read `extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json`
    - Verify `LICENSE`, `NOTICE.md`, and `README.md` exist when the inventory exists
    - For entries with imported status, verify the declared `targetPath` exists under `extensions/clarification-orchestrator/`
    - Reject imported entries that target paths outside the repository or outside approved Brainstorming Pro directories
    - _Requirements: 1.5, 2.1, 2.2, 3.1, 3.2, 6.1_
  - [✅] 2.2 Add derived TypeScript header validation
    - In `scripts/validate-package.ts`, scan imported TypeScript target files declared by `reuse-inventory.json`
    - Require a header containing `Derived from nicobailon/pi-subagents`, the notice commit/version token, `MIT License`, and `Brainstorming Pro`
    - Allow inventory entries marked `rewritten-from-reference` to use a `Inspired by nicobailon/pi-subagents` header recorded in `NOTICE.md`
    - _Requirements: 2.3, 2.4, 2.5, 6.1_
  - [✅] 2.3 Reject disallowed runtime dependency and unsafe vendor imports
    - Modify `scripts/validate-package.ts` to ensure `package.json` does not add `pi-subagents` as a dependency or dev dependency
    - Scan TypeScript imports under `extensions/clarification-orchestrator/` and reject imports from external `pi-subagents` packages
    - Reject imports from `extensions/clarification-orchestrator/vendor/pi-subagents/` except approved metadata or explicitly imported helper targets declared by the inventory
    - _Requirements: 3.4, 3.5, 5.1, 6.1_
  - [✅]* 2.4 Add validation unit tests or fixtures
    - Create or extend package validation tests to exercise missing notice/license, missing derived header, invalid target path, forbidden dependency, and forbidden import cases
    - Keep tests isolated with temporary fixture directories or injectable validation helpers if `scripts/validate-package.ts` is refactored
    - _Requirements: 2.5, 3.5, 6.1_

- [✅] 3. Phase 3: Add product-boundary enforcement tests
  - [✅] 3.1 Add forbidden command and tool registration tests
    - Create `tests/security/pi-subagents-product-boundary.test.ts`
    - Inspect `extensions/clarification-orchestrator/index.ts` and command modules to confirm no public `subagent` command or generic subagent tool is registered
    - Confirm existing public command surface remains workflow-owned, currently centered on `/brainstorm-pro`
    - _Requirements: 5.1, 5.6, 6.5_
  - [✅] 3.2 Add forbidden orchestration API scans
    - In `tests/security/pi-subagents-product-boundary.test.ts`, scan source files for public exported types or command parameters named `SubagentParams`, `SubagentResult`, `ChainStep`, `AsyncJobState`, `single`, `parallel`, `chain`, or `async` where they represent copied product semantics
    - Allow ordinary language occurrences only through a small explicit allowlist for documentation, tests, or negative assertions
    - _Requirements: 3.3, 4.4, 5.2, 6.5_
  - [✅] 3.3 Add intercom and builtin-agent absence scans
    - In `tests/security/pi-subagents-product-boundary.test.ts`, fail if `extensions/clarification-orchestrator/intercom/`, `extensions/clarification-orchestrator/agents/` copied from `pi-subagents`, or user-visible builtin role files are introduced by this reuse work
    - Fail if source imports or registers intercom modules or background async runner commands
    - _Requirements: 5.3, 5.4, 5.5, 6.5_
  - [✅]* 3.4 Add gate-bypass negative tests
    - Extend workflow security tests to verify adapted infrastructure modules, if present, do not call `approveGate`, `transition`, or review decision mutation helpers except through approved workflow runtime/adapters
    - Use an allowlist for existing `extensions/clarification-orchestrator/workflow/runtime.ts`, `workflow/gates.ts`, and workflow adapter files
    - _Requirements: 4.1, 4.2, 4.5, 6.5_

- [✅] 4. Phase 4: Create local module conventions for future adapted infrastructure
  - [✅] 4.1 Add agent execution runtime scaffold
    - Create `extensions/clarification-orchestrator/runtime/agent-execution/README.md`
    - Document future files `launch-spec.ts`, `spawn.ts`, `output.ts`, and `progress.ts`, including safety defaults for `PI_COMMAND`, provider-qualified model validation, `--no-session`, `--no-skills`, child env marker, depth guard, and child command registration prevention
    - State explicitly that this scaffold does not yet implement foreground child execution
    - _Requirements: 3.2, 3.3, 4.3, 6.4_
  - [✅] 4.2 Add TUI and live snapshot scaffold
    - Create `extensions/clarification-orchestrator/tui/README.md`
    - Document future files `workflow-widget.ts`, `workflow-result.ts`, `render-helpers.ts`, and `formatters.ts`
    - Document that TUI snapshots are derived from `state.json`, `events.jsonl`, and in-memory progress and cannot approve gates or advance workflow phases
    - Include non-TUI fallback requirements for markdown/plain text status
    - _Requirements: 3.2, 3.3, 4.1, 4.2, 4.6_
  - [✅] 4.3 Add workflow live snapshot policy note
    - Create `extensions/clarification-orchestrator/workflow/live-snapshot-policy.md` or update an existing workflow runtime document with live snapshot derivation rules
    - Define allowed data flow from runtime events to `WorkflowLiveSnapshot` to TUI rendering
    - State that snapshot corruption must not corrupt workflow state and should degrade to status text
    - _Requirements: 4.1, 4.2, 4.6, 6.3_
  - [✅]* 4.4 Add docs alignment tests for scaffolds
    - Extend `tests/unit/docs/workflow-runtime.test.ts` or create `tests/unit/docs/pi-subagents-reuse.test.ts`
    - Verify scaffold docs mention workflow-first terminology, non-TUI fallback, no gate mutation from UI, and no generic orchestration inheritance
    - _Requirements: 3.3, 4.1, 4.2, 4.4, 4.6, 7.6_

- [✅] 5. Checkpoint - Verify policy scaffold and product boundary
  - Run `npm run validate-package`
  - Run `node --test tests/unit/pi-subagents-reuse-inventory.test.ts`
  - Run `node --test tests/security/pi-subagents-product-boundary.test.ts`
  - Inspect `extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md` to confirm commit/version placeholders are resolved or clearly marked before any derived code is imported

- [✅]* 6. Optional Phase: Migrate first small helpers from upstream
  - [✅] 6.1 Import formatting helpers
    - Create `extensions/clarification-orchestrator/tui/formatters.ts` or `extensions/clarification-orchestrator/shared/formatters.ts` from the approved `src/shared/formatters.ts` inventory entry
    - Add the required derived-code header and adapt exported names to Brainstorming Pro terminology
    - Update `reuse-inventory.json` status and `NOTICE.md` imported modules/local modifications summary
    - _Requirements: 1.2, 2.3, 3.2, 3.3, 7.1_
  - [✅] 6.2 Import render helpers
    - Create `extensions/clarification-orchestrator/tui/render-helpers.ts` from the approved `src/tui/render-helpers.ts` inventory entry
    - Preserve or adapt ANSI-safe and width-aware truncation behavior without introducing upstream product types
    - Update `reuse-inventory.json` status and `NOTICE.md`
    - _Requirements: 1.2, 2.3, 3.2, 3.3, 4.6_
  - [✅] 6.3 Import atomic JSON or JSONL helper
    - Create `extensions/clarification-orchestrator/workflow/atomic-json.ts` or a narrower helper path from approved `src/shared/atomic-json.ts` and/or `src/shared/jsonl-writer.ts`
    - Integrate only where it simplifies existing workflow artifact/event code without changing artifact layout or gate semantics
    - Update `reuse-inventory.json` status and `NOTICE.md`
    - _Requirements: 1.2, 2.3, 3.2, 4.5, 7.1_
  - [✅] 6.4 Add helper-specific tests
    - Add tests for duration/token/path formatting boundaries if formatter helpers are imported
    - Add tests for ANSI-safe truncation, Unicode/emoji width handling, narrow terminal rendering, and compact/expanded line budgets if render helpers are imported
    - Add tests for atomic write failure, JSON parse failure, append ordering, and invalid path handling if atomic JSON or JSONL helpers are imported
    - _Requirements: 6.2, 6.3, 6.6_

- [✅] 7. Phase 5: Update README and cross-spec guidance
  - [✅] 7.1 Update repository README with reuse policy
    - Modify `README.md` to add a maintainer-facing section describing infrastructure-only reuse from `nicobailon/pi-subagents`
    - State that Brainstorming Pro does not directly depend on, register, or expose the generic `pi-subagents` product model
    - Link to `specs/pi-subagents-infrastructure-reuse/design.md`, `requirements.md`, and the vendor notice directory
    - _Requirements: 5.5, 7.5, 7.6_
  - [✅] 7.2 Add sync process documentation
    - Extend `extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md` or `README.md` with steps for future upstream syncs
    - Require previous/new commit recording, changed modules list, local conflict notes, test commands, and reviewer notes
    - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - [✅]* 7.3 Add README/docs validation tests
    - Extend `tests/unit/readme-command-surface.test.ts` or add `tests/unit/docs/pi-subagents-reuse.test.ts`
    - Assert README documents infrastructure-only reuse and does not list generic `subagent`, intercom, chain, or async runner as public Brainstorming Pro features
    - _Requirements: 5.1, 5.2, 5.3, 7.5_

- [✅] 8. Checkpoint - Final validation
  - Run `npm run typecheck`
  - Run `npm run test:unit`
  - Run `npm run test:security`
  - Run `npm test`
  - Run `npm run validate-package`
  - If optional helper migration is skipped, confirm inventory statuses remain `planned`, `reference-only`, or `not-reused` rather than incorrectly declaring imported files

## Notes

- Tasks marked with `*` are optional and can be skipped for an MVP; sub-tasks under optional phases inherit optionality.
- This plan intentionally creates policy, validation, and scaffolding before importing substantial code.
- Do not add `pi-subagents` as a dependency. Import only local Brainstorming Pro-owned files with attribution.
- Do not expose generic `subagent`, intercom, background async runner, arbitrary `chain` orchestration, or upstream builtin agents as part of this spec.
- Future `agent-execution-runtime` and `workflow-tui-live-progress` specs should consume the inventory and adaptation rules rather than copying upstream code independently.
