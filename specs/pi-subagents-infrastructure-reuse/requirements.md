# Requirements Document: Pi Subagents Infrastructure Reuse

## Introduction

Pi Subagents Infrastructure Reuse defines how Brainstorming Pro may copy, adapt, and maintain selected business-agnostic infrastructure from `nicobailon/pi-subagents` without inheriting that extension's generic subagent product model. The capability covers reuse inventory, license attribution, derived-code placement, adaptation rules, validation, and regression tests for infrastructure such as rendering helpers, live progress snapshots, foreground Pi subprocess launching patterns, output handling, atomic JSON writes, and JSONL append helpers.

The system is scoped to the Brainstorming Pro Pi package under `extensions/clarification-orchestrator/` and its tests, package validation, and documentation. It does not implement a new agent execution runtime, workflow TUI, background async runner, generic `subagent` tool, intercom, or arbitrary chain orchestration; instead, it establishes enforceable constraints and scaffolding so future runtime and UI specs can reuse proven infrastructure safely while preserving workflow-first state, approval gates, topic/path safety, and configuration security policy.

## Glossary

- **Brainstorming Pro**: This repository's Pi package for durable requirement clarification, design review, planning, and execution workflows.
- **pi-subagents**: The upstream `nicobailon/pi-subagents` project used as a source of reusable infrastructure patterns and MIT-licensed derived code.
- **Derived code**: Code copied from, adapted from, or closely based on `pi-subagents` source files.
- **Vendored helper**: A small business-agnostic helper copied into this repository with source attribution and local tests.
- **Reuse inventory**: A manifest or document that classifies upstream modules as directly vendored, adapted, reference-only, or explicitly not reused.
- **Product semantics**: User-visible `pi-subagents` abstractions such as generic subagent tools, arbitrary chains, background async jobs, intercom, and builtin agent discovery.
- **Workflow-first semantics**: Brainstorming Pro runtime concepts such as `WorkflowProgress`, `AgentRun`, `ReviewerRun`, phase adapters, review decisions, and approval gates.
- **Live snapshot**: A versioned UI/progress snapshot derived from runtime state and progress events rather than serving as the source of truth.
- **Approval gate**: A code-enforced pause that requires user approval of exact versioned artifact references before workflow advancement.
- **PI_COMMAND**: Environment variable treated as a single executable path override for launching pi subprocesses.

## Requirements

### Requirement 1: Reuse Inventory and Classification

**User Story:** As a Brainstorming Pro maintainer, I want a durable inventory of reusable `pi-subagents` modules, so that implementation agents can copy only approved infrastructure and avoid product-model leakage.

#### Acceptance Criteria

1. WHEN the reuse spec is implemented, THEN the system SHALL add a repository-local inventory file that lists upstream `pi-subagents` source paths, intended Brainstorming Pro target paths, reuse classification, and adaptation notes.
2. WHEN a module is a small business-agnostic helper such as formatter, render helper, atomic JSON writer, JSONL writer, or file coalescer, THEN the inventory SHALL classify it as directly vendorable or lightly adaptable.
3. WHEN a module contains useful infrastructure coupled to upstream terminology, such as TUI rendering, live state, Pi args/spawn, output handling, or artifact helpers, THEN the inventory SHALL classify it as adapted infrastructure rather than direct product reuse.
4. WHEN a module is tied to extension lifecycle, slash bridge, prompt template bridge, background runner, builtin agents, or intercom, THEN the inventory SHALL classify it as reference-only or not reused.
5. IF a future derived file is not represented in the inventory, THEN package validation or unit tests SHALL fail with an actionable message.
6. WHEN the upstream source path is unknown for a derived file, THEN the inventory SHALL require the file to be marked as rewritten-from-reference rather than silently claiming direct vendoring.

### Requirement 2: License and Attribution Compliance

**User Story:** As a maintainer and security reviewer, I want copied or adapted upstream code to preserve MIT license attribution, so that the package remains legally auditable.

#### Acceptance Criteria

1. WHEN any derived code exists, THEN the repository SHALL include `extensions/clarification-orchestrator/vendor/pi-subagents/LICENSE` containing the upstream MIT license notice.
2. WHEN any derived code exists, THEN the repository SHALL include `extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md` identifying upstream project URL, license, imported commit or version, imported modules, and local modification summary.
3. WHEN a TypeScript file contains derived code, THEN the file header SHALL identify `nicobailon/pi-subagents`, the imported commit or version recorded in the notice, MIT license, and Brainstorming Pro adaptation purpose.
4. WHEN a file is heavily rewritten but based on upstream source, THEN the notice or inventory SHALL still record the upstream reference and local rewrite summary.
5. IF license, notice, or required derived-file headers are missing, THEN `npm run validate-package` SHALL fail.
6. WHEN no derived files are present yet, THEN validation SHALL allow the absence of copied helper files but SHALL still pass for the inventory and policy scaffolding.

### Requirement 3: Derived Code Placement and Import Boundaries

**User Story:** As an implementation agent, I want clear target directories and import rules for reused code, so that infrastructure can be integrated without coupling to `pi-subagents` package APIs.

#### Acceptance Criteria

1. WHEN vendored metadata is added, THEN it SHALL live under `extensions/clarification-orchestrator/vendor/pi-subagents/`.
2. WHEN small reusable helpers are copied, THEN they SHALL live in explicit Brainstorming Pro-owned modules such as `extensions/clarification-orchestrator/tui/`, `extensions/clarification-orchestrator/workflow/`, `extensions/clarification-orchestrator/runtime/agent-execution/`, or a clearly named derived helper directory.
3. WHEN adapted runtime modules are introduced, THEN their public types SHALL use Brainstorming Pro terms such as `AgentRun`, `ReviewerRun`, `WorkflowProgress`, `WorkflowSnapshot`, or `WorkflowLiveSnapshot` rather than upstream product type names.
4. WHEN code imports reusable infrastructure, THEN it SHALL import local files and SHALL NOT import `pi-subagents` as a runtime package dependency.
5. IF an import path reaches into `vendor/pi-subagents` for executable product logic rather than license/notice metadata or explicitly approved helper code, THEN validation or tests SHALL fail.
6. WHEN a target directory does not yet exist, THEN implementation tasks SHALL create only the minimal scaffolding needed for policy, inventory, and first reusable helpers.

### Requirement 4: Workflow-First Adaptation Rules

**User Story:** As a workflow runtime maintainer, I want adapted infrastructure to obey Brainstorming Pro workflow semantics, so that reuse cannot bypass runtime state or gates.

#### Acceptance Criteria

1. WHEN live snapshot code is adapted, THEN snapshots SHALL be derived from runtime state, workflow events, and in-memory progress rather than being the authoritative workflow state.
2. WHEN TUI code is adapted, THEN it SHALL render phase/reviewer progress and approval cards without mutating workflow state or approving gates.
3. WHEN agent execution code is adapted, THEN it SHALL preserve Brainstorming Pro safety defaults including single-executable `PI_COMMAND`, provider-qualified model validation, `--no-session`, `--no-skills`, child environment marker, depth guard, and child command registration prevention.
4. WHEN review concurrency is introduced, THEN it SHALL be triggered only by workflow-defined review panels and SHALL NOT expose arbitrary user-defined chain, parallel, or async orchestration.
5. IF adapted infrastructure attempts to transition workflow phases, approve artifacts, skip review, or modify topic/path validation outside the runtime gate APIs, THEN tests SHALL fail.
6. WHEN non-interactive execution is detected, THEN adapted UI infrastructure SHALL degrade to readable text or markdown status output.

### Requirement 5: Product Boundary Enforcement

**User Story:** As a security reviewer, I want tests that reject inherited `pi-subagents` product capabilities, so that Brainstorming Pro does not accidentally expose a broader delegation surface.

#### Acceptance Criteria

1. WHEN the extension registers commands, THEN it SHALL NOT register a public generic `subagent` command or tool as part of this reuse work.
2. WHEN public APIs are scanned, THEN they SHALL NOT expose arbitrary `single`, `parallel`, `chain`, or `async` orchestration modes copied from `pi-subagents`.
3. WHEN source files are scanned, THEN they SHALL NOT introduce intercom runtime modules or public intercom commands.
4. WHEN builtin agent definitions are scanned, THEN `pi-subagents` builtin role definitions SHALL NOT be copied into Brainstorming Pro as user-visible agents.
5. IF a future implementation needs background async runner, intercom, generic delegation, or builtin role discovery, THEN this spec SHALL require a separate design/spec before those capabilities are added.
6. WHEN product-boundary tests run against an empty or minimal derived-code implementation, THEN they SHALL pass by confirming forbidden capabilities are absent.

### Requirement 6: Validation and Test Coverage

**User Story:** As a maintainer, I want automated validation around derived infrastructure, so that attribution, rendering behavior, spawn safety, snapshot behavior, and product boundaries remain protected from regressions.

#### Acceptance Criteria

1. WHEN package validation runs, THEN it SHALL check vendor notice/license presence when derived files are declared and SHALL verify every inventory entry points to an existing local target when marked imported.
2. WHEN TUI helper tests are added, THEN they SHALL cover ANSI-safe truncation, Unicode/emoji width handling, narrow terminal rendering, compact/expanded line budgets, spinner lifecycle, stale context cleanup, and non-TUI fallback for any implemented helpers.
3. WHEN live snapshot tests are added, THEN they SHALL cover initial snapshot creation, phase progress updates, reviewer progress updates, version increments, final snapshot restore, and snapshot update failure isolation for any implemented snapshot store.
4. WHEN agent execution adaptation tests are added, THEN they SHALL cover prompt/system prompt file args, `--no-session`, `--no-skills`, child env metadata, depth guard, timeout/retry/output limit, output truncation artifact, and no shell parsing for `PI_COMMAND` for any implemented spawn/output modules.
5. WHEN product-boundary tests run, THEN they SHALL verify absence of generic subagent tool registration, arbitrary public orchestration APIs, intercom, child workflow command registration, and gate bypass paths.
6. IF an implemented helper lacks corresponding local tests or explicit reference-only classification, THEN the test or validation suite SHALL fail.

### Requirement 7: Upstream Sync and Documentation

**User Story:** As a future upstream sync maintainer, I want documented import and synchronization policy, so that updates from `pi-subagents` can be reviewed safely.

#### Acceptance Criteria

1. WHEN upstream code is imported, THEN `NOTICE.md` or a dedicated sync record SHALL include the imported upstream commit or version and the import date.
2. WHEN upstream code is synchronized later, THEN the sync record SHALL include the previous commit, new commit, changed modules, local conflict summary, and reviewer notes.
3. WHEN a sync changes behavior in derived modules, THEN maintainers SHALL run derived module tests, workflow safety tests, product-boundary tests, and package validation before accepting the change.
4. IF upstream changes introduce product semantics into previously infrastructure-only files, THEN the sync review SHALL reject or rewrite those changes before merge.
5. WHEN README or design documentation describes reuse, THEN it SHALL state that Brainstorming Pro does not directly depend on or expose the `pi-subagents` product model.
6. WHEN future specs for agent execution runtime or workflow TUI are written, THEN they SHALL reference the reuse inventory and adaptation rules rather than independently copying upstream code without attribution.
