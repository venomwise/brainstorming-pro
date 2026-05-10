# Design Reviewer Role Pack Design

## Summary

Implement the Spec 5.1 **Design Reviewer Role Pack** so `full` design review becomes executable instead of explicitly unavailable. This spec adds the five package-owned design reviewer roles—Product, Architecture, Risk/Security, Testing, and Scope/Simplicity—registers them with the controlled `agent-execution-runtime`, provides per-role prompts and structured output validation, runs the full reviewer set through the existing Spec 5 `DesignReviewPanel` foundation, and normalizes all reviewer findings into the existing `DesignReviewFinding` schema. It intentionally does not implement user-selectable reviewer subsets, partial-success recovery, failed reviewer retry, accept-incomplete review, advanced triage, or automatic design revision; those belong to later design review specs.

## Goals

- Make `full` design review executable by replacing the Spec 5 `full-review-unavailable` path when the full role pack is registered.
- Add five design reviewer roles:
  - Product Reviewer;
  - Architecture Reviewer;
  - Risk / Security Reviewer;
  - Testing Reviewer;
  - Scope / Simplicity Reviewer.
- Register the full reviewer roles in `agent-execution-runtime` with strict phase and capability policy.
- Provide package-owned prompt and system prompt builders for each reviewer role.
- Validate each reviewer output with a shared structured review output schema.
- Execute the default full reviewer set in deterministic order, using controlled parallel `runAgent()` calls.
- Normalize reviewer outputs into Spec 5 canonical `DesignReviewFinding` records without redefining the finding schema.
- Preserve Spec 5 review run lifecycle, ledger layout, artifact binding, aggregation, readiness, and approval gate semantics.
- Keep reviewer agents read-only: they may produce findings only and must not modify artifacts, workflow state, decisions, approvals, or gates.
- Provide stable internal extension points for Spec 5.2 `design-review-execution-control` to later supply a selected reviewer role set.

## Primary Users / Roles

- **Workflow user**: wants a stronger multi-perspective review before approving `design.md` for planning.
- **Brainstorming Pro maintainer**: needs a bounded implementation that activates full review without expanding into UX/retry/triage complexity.
- **Reviewer role implementer**: needs clear per-role responsibilities, prompt boundaries, output schema, and tests.
- **Security / reliability reviewer**: needs confidence that reviewer agents cannot bypass runtime gates or mutate artifacts/state.
- **Future execution-control designer**: needs a full reviewer registry that can later support user-selected reviewer subsets, failed reviewer retry, and accept-incomplete review.
- **Future triage/revision designer**: needs role-specific findings to remain compatible with the existing aggregation/readiness and later triage/revision inputs.

## Non-Goals

- Do not redesign Spec 5 review run lifecycle.
- Do not redesign review ledger layout.
- Do not redefine `DesignReviewFinding`, `DesignReviewAggregateResult`, or `DesignApprovalReadiness` except for minimal type additions required to connect full reviewer roles to existing contracts.
- Do not implement user-selectable reviewer subsets; Spec 5.2 handles reviewer selection.
- Do not implement partial-success aggregation or incomplete review acceptance; Spec 5.2 handles execution control and recovery semantics.
- Do not implement failed reviewer retry; Spec 5.2 handles retry and attempt modeling.
- Do not implement advanced triage, finding deduplication, conflict resolution, must-fix/should-fix/note refinement, or user-facing readiness summaries; Spec 5.3 handles those.
- Do not implement automatic design revision; Spec 5.4 handles revision loops.
- Do not implement plan review.
- Do not change public command surface.
- Do not expose a generic subagent command/tool.
- Do not let reviewers approve design, skip gates, or modify workflow state.

## Context

The repository already has Spec 5 `design-review-panel` implemented under:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/
```

Current foundation includes:

- `DesignReviewPanel` orchestration;
- `skip | minimal | full` review mode handling;
- exact design artifact binding;
- review run ledger under `.workflow/reviews/design/<review-run-id>/`;
- canonical `DesignReviewFinding` schema;
- finding normalization;
- basic aggregation/readiness;
- minimal reviewer execution;
- explicit `full-review-unavailable` behavior.

Current `DesignReviewerRole` already reserves the full reviewer role names:

```ts
type DesignReviewerRole =
  | "minimal-reviewer"
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";
```

However, `agent-execution-runtime` currently only registers these agent roles:

```ts
type AgentRole =
  | "design-author"
  | "design-reviser"
  | "plan-author"
  | "task-executor"
  | "minimal-reviewer";
```

The current full reviewer resolver is intentionally unavailable:

```ts
export function resolveFullDesignReviewerSet(): Exclude<DesignReviewerRole, "minimal-reviewer">[] | undefined {
  return undefined;
}
```

Spec 5.1 fills this gap by registering and executing the five full reviewer roles. The global roadmap now separates this from Spec 5.2 `design-review-execution-control`, which will later add reviewer subset selection, partial aggregation, failed reviewer retry, and accept-incomplete review.

## Discovery

### Key Discoveries

- Spec 5.1 should remain a **reviewer capability** spec, not a review execution-control spec.
- User-selectable reviewer subsets, failed reviewer retry, partial aggregation, and accept-incomplete review are valuable, but they cross runtime decisions, ledger attempt modeling, resume/status UX, and recovery semantics; they belong in Spec 5.2.
- Spec 5 already provides the durable foundation: version-bound review runs, finding schema, ledger, normalization, aggregation, readiness, and runtime adapter integration.
- The most important Spec 5.1 implementation gap is that full reviewer roles exist as design-review types but not as executable `AgentRole`s in `agent-execution-runtime`.
- Full reviewer prompts should be package-owned static prompts, not project-local untrusted prompts.
- Full reviewer execution should use the existing role-based `runAgent()` isolation: no session, no skills, phase-restricted, model-policy checked, output-limited, and schema-validated.
- Spec 5.1 should preserve an internal selected-role execution parameter as an extension point, but user-facing reviewer selection must not be exposed until Spec 5.2 defines the decision and recovery contract.

### Scope Decisions

Included:

- Five full reviewer role registrations.
- Five per-role prompt/system prompt builders.
- Shared full reviewer output schema.
- Full reviewer registry / role set resolver.
- Controlled parallel execution of the default full reviewer set.
- Per-reviewer result normalization and ledger writes through existing Spec 5 store helpers.
- Fail-closed handling for invalid output, timeout, non-zero exit, role policy violation, and incomplete role-pack registration.
- Tests for role registration, prompt boundaries, full execution, no fallback, and security constraints.

Excluded:

- User-selected reviewer subset UX and state model.
- Partial-success aggregation semantics.
- Retry attempts for failed reviewers.
- Accept-incomplete review gate.
- Triage/deduplication and revision loop.

## Proposed Solution

Add a package-owned full reviewer role pack and wire it into the existing `DesignReviewPanel` path. The reviewer coordinator will resolve the full reviewer set, run all five roles in parallel through `agent-execution-runtime`, convert each successful structured output into canonical findings, persist each reviewer result with the existing review ledger helpers, and return the complete result set to the existing Spec 5 aggregator/readiness path.

The default Spec 5.1 behavior is intentionally simple:

```text
full review selected
  → bind exact design artifact
  → resolve full role pack
  → run all five reviewers in parallel
  → normalize all successful reviewer findings
  → if any required reviewer fails, full review fails closed
  → otherwise existing aggregator determines passed vs blocked
```

This keeps Spec 5.1 safe and small. Spec 5.2 can later change execution-control semantics so a selected reviewer subset may run, successful partial results may aggregate, failed reviewers may be retried, and users may explicitly accept incomplete review.

### Architecture

```text
Workflow Runtime Orchestrator
  └─ designReviewAdapter
       └─ DesignReviewPanel             (Spec 5 foundation)
            ├─ DesignArtifactBinder     (existing)
            ├─ ReviewRunStore           (existing)
            ├─ ReviewerCoordinator      (extended in Spec 5.1)
            │    ├─ minimal reviewer    (existing)
            │    └─ full reviewer pack  (new)
            │         ├─ Product Reviewer
            │         ├─ Architecture Reviewer
            │         ├─ Risk / Security Reviewer
            │         ├─ Testing Reviewer
            │         └─ Scope / Simplicity Reviewer
            ├─ FindingNormalizer        (existing)
            ├─ BasicFindingAggregator   (existing)
            └─ ReadinessEvaluator       (existing)
                 ↓
          Agent Execution Runtime
            └─ runAgent(role = full reviewer role)
```

Principles:

```text
Runtime owns lifecycle.
Panel owns review execution and ledger.
Reviewer roles produce findings only.
Findings do not mutate artifacts.
Full role pack activates full mode; it does not change approval authority.
Spec 5.1 full review runs the complete role pack by default.
```

### Components

#### 1. Agent role registration

Update:

```text
extensions/clarification-orchestrator/runtime/agent-execution/types.ts
extensions/clarification-orchestrator/runtime/agent-execution/roles.ts
```

Extend `AgentRole`:

```ts
export type AgentRole =
  | "design-author"
  | "design-reviser"
  | "plan-author"
  | "task-executor"
  | "minimal-reviewer"
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";
```

Each new role must be registered with:

```ts
{
  allowedPhases: ["design-review"],
  expectedResultKind: "review-findings",
  allowSkills: false,
  allowSession: false,
  ...DEFAULT_LIMITS,
}
```

Role descriptions:

- `product-reviewer`: validates user goals, roles, product value, scope, and non-goals.
- `architecture-reviewer`: validates component boundaries, runtime ownership, interfaces, and data flow.
- `risk-security-reviewer`: validates trust boundaries, path/state/gate safety, untrusted output handling, and fail-closed behavior.
- `testing-reviewer`: validates test strategy, coverage, fixtures, negative paths, and evidence.
- `scope-simplicity-reviewer`: validates YAGNI, decomposition, simplicity, and spec boundary discipline.

#### 2. Full reviewer registry

Add:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts
```

Responsibilities:

- Declare the five full reviewer definitions.
- Preserve deterministic role order.
- Map role to display name, default finding category, prompt builders, and execution policy.
- Provide role-pack completeness validation.
- Provide an internal selected-role resolution function for future Spec 5.2.

Suggested types:

```ts
type FullDesignReviewerRole = Exclude<DesignReviewerRole, "minimal-reviewer">;

type FullDesignReviewerDefinition = {
  role: FullDesignReviewerRole;
  displayName: string;
  defaultCategory: DesignReviewFindingCategory;
  buildPrompt: (input: FullDesignReviewerPromptInput) => string;
  buildSystemPrompt: () => string;
};

type FullDesignReviewerPromptInput = {
  topic: string;
  designRef: VersionedArtifactRef;
  designContent: string;
};
```

Public/internal functions:

```ts
export function resolveFullDesignReviewerSet(selectedRoles?: FullDesignReviewerRole[]): FullDesignReviewerDefinition[];
export function getFullDesignReviewerDefinition(role: FullDesignReviewerRole): FullDesignReviewerDefinition;
export function assertFullDesignReviewerPackComplete(): void;
```

Spec 5.1 behavior:

- If `selectedRoles` is omitted, return all five roles.
- `selectedRoles` exists only as an internal extension point.
- No user-facing selected-role UX is implemented in this spec.
- If the role pack is incomplete, fail closed rather than silently falling back to minimal.

#### 3. Shared full reviewer output schema

Update or add:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/schemas.ts
```

Suggested role-neutral output type:

```ts
type DesignReviewerOutput = {
  summary: string;
  findings: DesignReviewFindingDraft[];
  confidence: "low" | "medium" | "high";
};
```

`MinimalDesignReviewOutput` can either remain as-is or become an alias of the shared output shape. Spec 5.1 should avoid duplicating validation logic when possible.

Validation constraints:

- Output must be parseable structured data.
- `summary` is required and non-empty.
- `confidence` must be `low | medium | high`.
- `findings` must be an array.
- Each finding must pass existing `DesignReviewFindingDraft` validation.
- Unauthorized fields such as approval, state mutation, artifact commit, phase transition, or gate decision must fail validation or normalization.
- Reviewer-provided `id`, `reviewRunId`, `designRef`, and `reviewerRole` must not be trusted; canonical fields are injected by `FindingNormalizer`.

#### 4. Per-role prompts

Add prompt modules under:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/prompts/
  full-product-review.ts
  full-architecture-review.ts
  full-risk-security-review.ts
  full-testing-review.ts
  full-scope-simplicity-review.ts
```

All prompts must instruct reviewers to:

- review only the supplied design content and artifact metadata;
- return structured review output only;
- produce findings, not edits;
- never approve the design;
- never modify workflow state;
- never request skipping lifecycle gates;
- classify severity as `blocking`, `non-blocking`, or `note`;
- include concrete evidence and recommendations when useful;
- avoid blocking on optional polish issues.

##### Product Reviewer

Focus:

- problem statement clarity;
- primary users / roles;
- goals and measurable success criteria;
- non-goals and scope boundaries;
- unresolved product decisions;
- whether the design is ready to be converted into requirements.

Default category:

```ts
"product"
```

##### Architecture Reviewer

Focus:

- component boundaries;
- runtime ownership and adapter authority;
- data flow completeness;
- interface clarity;
- persistence/event/artifact integration;
- coupling and maintainability risks.

Default category:

```ts
"architecture"
```

##### Risk / Security Reviewer

Focus:

- artifact path traversal and topic-scoping;
- stale artifact/version/checksum risk;
- approval gate bypass risk;
- untrusted reviewer/agent output handling;
- model/tool/session policy;
- fail-closed recovery;
- audit/event integrity.

Default category:

```ts
"risk-security"
```

##### Testing Reviewer

Focus:

- unit/integration/security/docs test coverage;
- negative paths and failure modes;
- fixture strategy;
- deterministic validation;
- how to verify runtime gates, artifact binding, and reviewer behavior.

Default category:

```ts
"testing"
```

##### Scope / Simplicity Reviewer

Focus:

- YAGNI risk;
- over-abstracted design;
- accidental inclusion of future specs;
- clear separation between Spec 5.1, 5.2, 5.3, and 5.4;
- implementation complexity and maintainability.

Default category:

```ts
"scope-simplicity"
```

#### 5. Reviewer coordinator full execution

Update:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-coordinator.ts
```

Current behavior:

```ts
if (input.mode === "full") throw new Error("Full design reviewer role pack is not registered.");
```

New behavior:

```ts
export async function runDesignReviewers(input: {
  mode: "minimal" | "full";
  reviewRunId: string;
  artifact: BoundDesignArtifact;
  state: WorkflowState;
  options: ReviewerCoordinatorOptions;
  selectedFullReviewerRoles?: FullDesignReviewerRole[]; // internal extension point for Spec 5.2
}): Promise<DesignReviewerResult[]> {
  if (input.mode === "minimal") return [await runMinimalDesignReviewer(input)];
  return await runFullDesignReviewers(input);
}
```

Full execution:

```ts
async function runFullDesignReviewers(input): Promise<DesignReviewerResult[]> {
  const reviewers = resolveFullDesignReviewerSet(input.selectedFullReviewerRoles);
  return await Promise.all(reviewers.map((reviewer) => runFullDesignReviewer({ ...input, reviewer })));
}
```

Spec 5.1 policy:

- Default full review runs all five reviewers.
- All five default reviewers are required.
- If any required reviewer fails, the full review result is failed in Spec 5.1.
- Successful reviewer findings are still written to ledger before final failure when feasible, but the aggregate must not be treated as approval-ready if any required reviewer failed.
- Spec 5.2 may later refine this to partial aggregation, retry, and accept-incomplete behavior.

#### 6. `runFullDesignReviewer()` helper

Add helper in `reviewer-coordinator.ts` or a dedicated module:

```text
extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-runner.ts
```

Responsibilities:

- Build role-specific prompt/system prompt.
- Call `runAgent()` with the reviewer role.
- Use shared full reviewer output schema.
- Convert agent failure/timeout/invalid output into `DesignReviewerResult.status = "failed"`.
- Normalize successful findings with existing `normalizeDesignReviewFindings()`.
- Inject `reviewRunId`, exact `designRef`, and `reviewerRole`.
- Preserve raw structured output for audit where existing ledger policy allows.

#### 7. Panel status mapping

Spec 5 already aggregates reviewer results. Spec 5.1 should ensure full mode maps correctly:

```text
all full reviewers succeed + no blocking findings → passed
all full reviewers succeed + any blocking finding → blocked
any required full reviewer fails → failed
role pack incomplete/unregistered → unavailable or failed closed, never fallback
```

Preferred distinction:

- If full role pack is intentionally absent before Spec 5.1: `unavailable` with `full-review-unavailable`.
- If Spec 5.1 role pack is present but internally incomplete or invalid: `failed` with diagnostics.
- If agent role policy rejects a reviewer: `failed` with `role-not-allowed` diagnostics.

#### 8. Ledger compatibility

Keep existing layout:

```text
specs/<topic>/
  .workflow/
    reviews/
      design/
        <review-run-id>/
          review-run.json
          reviewer-results/
            product-reviewer.json
            architecture-reviewer.json
            risk-security-reviewer.json
            testing-reviewer.json
            scope-simplicity-reviewer.json
          aggregated-findings.json
          readiness.json
```

Spec 5.1 does not introduce attempt directories. Attempt modeling belongs to Spec 5.2.

Each reviewer result file should record:

- `reviewRunId`;
- `reviewerRole`;
- `status`;
- `summary` when succeeded;
- normalized `findings` when succeeded;
- `error` when failed;
- `startedAt` / `completedAt`;
- safe raw structured output where available.

#### 9. Extension points for Spec 5.2

Spec 5.1 should provide these internal seams without implementing user-facing behavior:

```ts
type FullDesignReviewerRole = Exclude<DesignReviewerRole, "minimal-reviewer">;

function resolveFullDesignReviewerSet(selectedRoles?: FullDesignReviewerRole[]): FullDesignReviewerDefinition[];

async function runFullDesignReviewers(input: {
  selectedFullReviewerRoles?: FullDesignReviewerRole[];
  // ...existing inputs
}): Promise<DesignReviewerResult[]>;
```

Rules:

- If `selectedFullReviewerRoles` is omitted, run all five.
- If supplied internally, validate all roles are known and unique.
- Do not expose selection through `/brainstorm-pro` yet.
- Do not persist selected/unselected coverage yet except if existing reviewer result refs naturally show executed roles.
- Do not define retry or accept-incomplete state yet.

### Data Flow

#### Full review primary path

```text
User selects full design review for design vN
  ↓
Runtime records review decision bound to exact design artifact version/checksum
  ↓
Runtime enters design-review
  ↓
DesignReviewPanel validates design artifact binding
  ↓
ReviewRunStore creates .workflow/reviews/design/<review-run-id>/
  ↓
ReviewerCoordinator resolves full reviewer role pack
  ↓
ReviewerCoordinator runs all five reviewers in parallel through runAgent()
  ↓
Each reviewer returns structured DesignReviewerOutput
  ↓
FindingNormalizer injects reviewRunId, designRef, reviewerRole, deterministic finding ids
  ↓
ReviewRunStore writes one reviewer result file per role
  ↓
Existing aggregator aggregates all normalized findings
  ↓
Existing readiness evaluator determines passed or blocked
  ↓
ReviewRunStore writes aggregated-findings.json and readiness.json
  ↓
Panel returns result to adapter
  ↓
Runtime proceeds according to existing Spec 5 status mapping
```

#### Blocking path

```text
Any reviewer emits one or more blocking findings
  ↓
All reviewers succeeded
  ↓
Aggregation status = blocked
  ↓
Readiness status = blocked
  ↓
Runtime must not proceed to design approval as if passed
```

#### Required reviewer failure path in Spec 5.1

```text
One or more full reviewers fail, time out, or return invalid output
  ↓
Succeeded reviewer results are written when available
  ↓
Failed reviewer result files include diagnostics
  ↓
Full review status = failed
  ↓
No fallback to minimal
  ↓
Runtime does not proceed to awaiting-design-approval
```

Future Spec 5.2 changes this path to support partial aggregation, failed reviewer retry, and accept-incomplete review.

#### Role pack unavailable/incomplete path

```text
User selects full
  ↓
Role pack cannot resolve all required full reviewer definitions
  ↓
Panel returns unavailable or failed diagnostics
  ↓
No reviewer fallback occurs
  ↓
Runtime remains fail-closed
```

## Error Handling

### 1. Unknown or unregistered reviewer role

If a full reviewer role is missing from `AgentRole` or `AGENT_ROLE_DEFINITIONS`:

- fail closed;
- record `role-not-allowed` or role-pack validation diagnostics;
- do not fallback to minimal;
- do not proceed to approval.

### 2. Role not allowed in current phase

If a reviewer is invoked outside `design-review`:

- `agent-execution-runtime` rejects the run;
- reviewer result is failed;
- full review fails closed.

### 3. Prompt builder failure

If a per-role prompt builder throws or produces invalid prompt content:

- mark that reviewer failed;
- persist failure diagnostics when ledger is available;
- fail full review in Spec 5.1.

### 4. Reviewer timeout or non-zero exit

If any required reviewer times out or exits unsuccessfully:

- persist failed reviewer result;
- fail full review in Spec 5.1;
- do not treat partial successful findings as approval-ready.

### 5. Invalid reviewer output

If output cannot parse or fails schema validation:

- mark reviewer failed;
- do not use unvalidated partial findings;
- fail full review in Spec 5.1.

### 6. Unauthorized mutation directives

If reviewer output attempts to approve design, modify state, commit artifacts, change review decisions, or skip gates:

- reject during schema validation or finding normalization;
- mark reviewer failed;
- record diagnostics;
- keep runtime state unchanged except for runtime-owned failure handling.

### 7. Blocking findings

If all reviewers succeed but at least one normalized finding has `severity = "blocking"`:

- aggregate status = `blocked`;
- readiness status = `blocked`;
- do not proceed to approval;
- future Spec 5.4 may consume blocking findings for revision.

### 8. Ledger write failure

If reviewer result, aggregate, readiness, or review run metadata cannot be durably written:

- review status = failed;
- runtime must not proceed;
- avoid treating non-durable reviewer output as authoritative.

### 9. Stale artifact binding

Spec 5 artifact binding remains authoritative. If design version/checksum no longer matches the recorded review decision:

- do not run full reviewers;
- fail closed using existing stale decision handling;
- require a fresh review decision.

## Testing

### Unit tests

Suggested locations:

```text
tests/unit/workflow/design-review-full-role-registry.test.ts
tests/unit/workflow/design-review-full-prompts.test.ts
tests/unit/workflow/design-review-full-schema.test.ts
tests/unit/workflow/design-review-full-reviewers.test.ts
tests/unit/workflow/adapters/design-review.test.ts
```

Cases:

- Full reviewer registry returns exactly five roles in deterministic order.
- Each full reviewer role has a definition and prompt builders.
- Role pack completeness validation fails if any role definition is missing.
- `AgentRole` includes all five full reviewer roles.
- Each full reviewer role is allowed only in `design-review`.
- Each full reviewer role has `expectedResultKind = "review-findings"`.
- Each full reviewer role has `allowSkills = false` and `allowSession = false`.
- Shared full reviewer output schema accepts valid output.
- Shared full reviewer output schema rejects malformed output.
- Unauthorized approval/state/artifact mutation fields are rejected.
- `resolveFullDesignReviewerSet()` defaults to all five roles.
- Internal selected-role resolver validates uniqueness and known roles, but is not exposed through UX.
- Full review invokes all five reviewers by default.
- All reviewers succeed with no blocking findings → review passed.
- All reviewers succeed with blocking finding → review blocked.
- Any reviewer timeout/failure/invalid output → review failed in Spec 5.1.
- Full review does not fallback to minimal.
- Full review no longer returns `full-review-unavailable` when the role pack is complete.

### Integration tests

Suggested location:

```text
tests/integration/design-reviewer-role-pack.test.ts
```

Cases:

- Workflow reaches `awaiting-design-review-decision`, user selects `full`, five fake reviewers succeed, runtime reaches `awaiting-design-approval` only when no blocking findings exist.
- Full review with one blocking finding does not reach approval.
- Full review with one failed reviewer does not reach approval.
- Full review writes reviewer result files for all five roles.
- Aggregated findings include findings from multiple roles with correct `reviewerRole` and exact `designRef`.

### Security tests

Suggested location:

```text
tests/security/design-reviewer-role-pack.test.ts
```

Cases:

- Full reviewer roles cannot run outside `design-review`.
- Full reviewer roles launch through agent runtime with `--no-session` and `--no-skills` policy.
- Reviewer output cannot create external artifact refs or path escapes.
- Crafted reviewer output cannot mark review approved.
- Crafted reviewer output cannot modify workflow state or decision refs.
- Full review cannot be made to fallback to minimal by role-pack failure.

### Documentation alignment tests

Update docs tests if public README or workflow docs mention full review behavior:

- `full` review is executable after Spec 5.1 role pack implementation.
- Spec 5.1 full review runs the complete five-role reviewer pack by default.
- Reviewer selection / retry / accept incomplete review are deferred to Spec 5.2.
- Review readiness is still not approval.

## Open Questions

1. Should full reviewer prompts include the entire design content only, or also include selected workflow metadata such as request, current review decision, previous review summaries, and runtime phase? First implementation should prefer design content plus exact artifact metadata to reduce prompt surface.
2. Should failed full review preserve successful reviewer findings in `aggregated-findings.json`, or only in per-reviewer result files until Spec 5.2 defines partial aggregation? Recommended: preserve successful findings in reviewer result files, but do not mark aggregate approval-ready when any required reviewer fails.
3. Should full reviewer output schema be a renamed shared schema used by minimal reviewer too, or should minimal and full schemas remain separate wrappers over the same validators? Prefer shared validators with role-specific schema names for clearer audit diagnostics.
4. Should role-specific prompts enforce default categories, or allow reviewers to emit any existing category? Recommended: prompts should prefer default category but allow cross-category findings when clearly justified; normalization should still validate all categories.
5. Should each full reviewer have different timeout/output limits? First implementation can use default reviewer limits; role-specific limits can be added only if evidence shows a need.
6. Should Spec 5.1 write a markdown review summary? No; keep JSON ledger only and let Spec 7 / Spec 8 render summaries.
