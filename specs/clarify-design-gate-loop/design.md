# Clarify Design Gate Loop Design

## Summary

Change `/clarify` from a topic-first automated clarification command into a request-first, human-gated design workflow. Users will invoke `/clarify <用户需求>` with a natural-language requirement; the system will propose a kebab-case topic, ask the user to confirm or edit it, produce a v0 design using brainstorming-style clarification, and then repeatedly present a design review gate. At each gate, the user chooses whether to approve the current design for `spec-plan` handoff, run a subagent cross-review round, or continue conversational revision.

## Goals

- Treat the main `/clarify` argument as the user's natural-language requirement, not as the spec topic.
- Automatically generate a concise kebab-case topic from the request and confirm or edit it with the user before creating artifacts.
- Produce a v0 design before launching any cross-review subagents.
- Present the same design-level gate after every design version:
  - approve for `spec-plan` handoff;
  - run cross-review;
  - revise conversationally;
  - save and exit for later resume.
- Preserve the old cross-review issue decision behavior: after triage, every triaged issue is shown to the user for explicit decision.
- Ensure P0/P1/P2/P3 issues all enter the issue decision gate by default, with no threshold-based filtering.
- Apply only user-accepted issues during refinement.
- Keep durable artifacts for request capture, topic proposal, design versions, review findings, triage, decisions, refinements, final approval, and recovery.
- Keep `/clarify` simple by exposing only `--resume`, `--verbose`, and `--dry-run`.
- End with a clear `spec-plan` handoff instruction, not implementation.

## Primary Users / Roles

- **Primary user / product owner**: provides the original requirement, confirms the topic, reviews each design version, decides which review issues to accept/reject/defer/discuss, and approves handoff to `spec-plan`.
- **Main clarifying agent**: performs the initial brainstorming-style clarification, asks focused questions when needed, drafts v0 design, and supports conversational revisions.
- **Reviewer agents**: independently inspect a design from product, architecture, risk, and testing perspectives.
- **Triager agent**: deduplicates reviewer findings, assigns severity and category, explains risk/cost/scope impact, and prepares issues for user decision.
- **Refiner agent**: updates the design according only to accepted issues and records what changed.
- **Clarification orchestrator extension**: owns command parsing, topic confirmation, workflow state, artifact writes, subagent execution, user gates, resume, logging, and safety boundaries.

## Non-Goals

- Do not automatically invoke `spec-plan`; the workflow only produces a handoff instruction.
- Do not implement code or call `spec-exec` from `/clarify`.
- Do not remove topic/spec directory concepts; topic remains the stable artifact key.
- Do not expose `--mode`, `--threshold`, `--max-rounds`, or `--reviewers` as `/clarify` parameters.
- Do not silently auto-accept, auto-reject, or auto-defer review issues.
- Do not create an unrestricted or automatic agent debate loop; every cross-review round is explicitly user-triggered.
- Do not treat save-and-exit as approval, rejection, or abandonment; it only persists progress and leaves the run resumable.
- Do not make `/clarify-status`, `/clarify-diff`, or `/clarify-clean` topicless as part of this change.

## Context

Brainstorming Pro currently documents and implements `/clarify <topic>` as the main command. The topic is passed directly into path resolution and artifact creation under `specs/<topic>/`. The current README also exposes automation controls such as `--mode`, `--max-rounds`, `--threshold`, and `--reviewers`.

The desired behavior is closer to the existing `brainstorming` skill: the user provides a requirement, the assistant clarifies the need, produces a v0 design, and asks for review before proceeding. Brainstorming Pro should add structured durability and optional independent cross-review on top of that flow, rather than immediately treating the command argument as a topic and running a mostly predetermined multi-agent workflow.

The existing artifact structure and management commands remain useful. The redesign therefore keeps `specs/<topic>/` as the durable location, but generates and confirms the topic from the user's natural-language request before creating a run.

## Discovery

### Key Discoveries

- The current `/clarify <topic>` interface forces the user to name an artifact topic before the system has clarified the actual requirement.
- The desired user experience is request-first: describe the need, clarify it into v0 design, then decide whether extra review is worthwhile.
- Topic is still necessary as a stable path key for `specs/<topic>/`, status, diff, clean, and handoff workflows.
- A design-level gate and an issue-level gate serve different purposes and both are needed:
  - the design gate decides the next workflow action for a whole design version;
  - the issue gate decides which cross-review findings should be applied.
- Threshold-based decision filtering can hide useful lower-severity findings. To avoid omissions and triage mistakes, all P0/P1/P2/P3 issues should be shown to the user by default.
- `--mode`, `--threshold`, `--max-rounds`, and `--reviewers` complicate the new product model and make it easier to bypass human decisions.
- Because every cross-review round is explicitly user-triggered, public `--max-rounds` is no longer necessary for loop control.

### Scope Decisions

- `/clarify` will accept a natural-language request as its main argument.
- Topic will be generated from the request and confirmed/edited by the user before artifact creation.
- The public `/clarify` options will be limited to:
  - `--resume`
  - `--verbose`
  - `--dry-run`
- All bundled default reviewers will be used when the user chooses cross-review.
- All triaged issues, regardless of severity, will enter the issue decision gate.
- Refinement will apply only issues explicitly accepted by the user.
- Each design version will return to the same design review gate.
- Design review gates include a save-and-exit action so uncertain users can pause without choosing revise/review/approve.
- `spec-plan` handoff remains explicit and manual.

## Proposed Solution

Refactor the `/clarify` workflow into a design gate loop. The command starts by capturing the user's request, proposing a topic, confirming the topic, and producing a v0 design. After v0 and after every later revision/refinement, the workflow pauses at a design review gate with four choices: approve for `spec-plan`, run cross-review, revise conversationally, or save and exit for later resume.

When the user chooses cross-review, the orchestrator runs reviewers, triage, an issue decision gate for all findings, refinement of accepted issues only, and then returns to the design review gate. This preserves durable, multi-agent review while ensuring the user remains the authority on scope and trade-offs.

The artifact layout separates stable handoff files, run metadata, immutable design versions, and review rounds:

```text
specs/<topic>/
  design.md                          # always mirrors latest complete design version
  clarification/
    <run-id>/
      metadata.json                  # run metadata, resume status, current phase, latest version, active round
      request.md
      topic-proposal.json
      versions/
        v0/
          design.md
          discovery.md
          design-gate.json
        v1/
          design.md
          revision.md                # present for conversational revisions
          revision.json
          design-gate.json
      reviews/
        round-1/
          review.json
          review.md
          triage.json
          triage.md
          decisions.json
          decisions.md
          refine.json
          refine.md
        round-2/
          ...
      final-approval.md
```

`metadata.json` is the canonical run index for resume/status within a run. It records both the detailed workflow phase and a user-facing resume status such as `awaiting-topic-confirmation`, `awaiting-design-gate-decision`, `awaiting-issue-decisions`, `in-cross-review`, `completed`, or `failed`. `specs/<topic>/design.md` remains the stable public design path for handoff to `spec-plan`.

### Architecture

```text
User
  |
  | /clarify <request>
  v
Clarification Orchestrator Extension
  |
  |-- Argument Parser
  |-- Topic Proposal / Confirmation
  |-- Artifact Store
  |-- Workflow State Machine
  |-- V0 Brainstorming / Conversational Revision Interface
  |-- Design Review Gate
  |-- Subagent Runner
  |-- Issue Decision Gate
  |-- Progress Reporter / Execution Logger
  |
  +--> Reviewer Agents
  +--> Triager Agent
  +--> Refiner Agent
  |
  v
specs/<topic>/design.md
specs/<topic>/clarification/<run-id>/*
```

The new high-level state machine is:

```text
REQUEST_CAPTURE
  -> TOPIC_PROPOSAL
  -> TOPIC_CONFIRMATION
  -> V0_BRAINSTORMING
  -> DESIGN_REVIEW_GATE
      ├─ approve-for-spec-plan
      │     -> FINAL_APPROVAL
      │     -> COMPLETE
      │
      ├─ revise-conversationally
      │     -> CONVERSATIONAL_REVISION
      │     -> DESIGN_REVIEW_GATE
      │
      ├─ save-and-exit
      │     -> INTERRUPTED
      │
      └─ run-cross-review
            -> CROSS_REVIEW
            -> TRIAGE
            -> ISSUE_DECISION_GATE
            -> REFINE
            -> DESIGN_REVIEW_GATE
```

Subsequent review rounds repeat:

```text
DESIGN_REVIEW_GATE
  -> CROSS_REVIEW
  -> TRIAGE
  -> ISSUE_DECISION_GATE
  -> REFINE
  -> DESIGN_REVIEW_GATE
```

### Components

#### Argument Parser

The parser should treat non-option text as `request`, not `topic`.

Public command forms:

```text
/clarify <request>
/clarify <request> --verbose
/clarify <request> --dry-run
/clarify --resume
```

Public options retained:

- `--resume`: resume the latest resumable clarification run based on metadata resume status; if multiple resumable runs exist, prompt the user to choose.
- `--verbose`: emit detailed phase/activity logging.
- `--dry-run`: validate input and produce a planned workflow/debug artifact without launching the full workflow or subagents.

Public options removed from `/clarify`:

- `--mode manual|hybrid|auto`
- `--max-rounds N`
- `--threshold P0|P1|P2|P3`
- `--reviewers product,architecture,risk,testing`

The options type should move from topic-first to request-first, conceptually:

```ts
type ClarifyOptions = {
  request: string;
  resume: boolean;
  verbose: boolean;
  dryRun: boolean;
  proposedTopic?: string;
  confirmedTopic?: string;
};
```

#### Topic Proposal / Confirmation

The topic generator derives multiple concise topic candidates from the natural-language request, checks them against existing specs, and asks the user to choose or edit one.

Rules:

- Generate 2-3 candidate topics, not a single slug.
- Use kebab-case for all candidate slugs.
- Prefer a feature, command, or behavior name from the request.
- Keep each slug concise, ideally 3-6 meaningful words.
- Avoid generic slugs like `feature`, `update`, or `change`.
- Sanitize path-sensitive characters and reject traversal attempts.
- Check exact conflicts with existing `specs/<topic>` directories.
- Check semantic similarity with existing topic slugs to avoid near-duplicates such as `user-auth` and `user-authentication`.
- If a candidate is similar to an existing topic, show the existing topic as a reuse option and explain the similarity.
- If the request is Chinese or another non-English language but the generated slug is English, show a translation/gloss for each candidate so the user can verify meaning.
- If all candidates are weak, generic, unsafe, or semantically duplicate existing specs, ask the user to provide or edit a topic manually.

Candidate metadata should include:

```ts
type TopicCandidate = {
  slug: string;
  displayName: string;
  sourcePhrase?: string;
  translation?: {
    fromLanguage: string;
    originalPhrase: string;
    englishGloss: string;
  };
  similarExistingTopics: Array<{
    slug: string;
    reason: string;
    confidence: "high" | "medium" | "low";
  }>;
};
```

Example:

```text
Request: 现在的 /clarify 命令后面不应该是 topic，而应该是用户需求...

Choose a topic:
1. clarify-design-gate-loop
   Translation: “/clarify 设计评审门控循环” -> clarify design gate loop
2. clarify-request-workflow
   Translation: “/clarify 用户需求流程” -> clarify request workflow
3. request-first-clarify
   Translation: “需求优先的 clarify” -> request-first clarify

Similar existing topics:
- brainstorming-pro: related package-level spec, but broader than this change
```

The system asks the user to choose a candidate, reuse a similar existing topic, or edit/provide a topic before calling path resolution and run creation.

#### V0 Brainstorming

The `V0_BRAINSTORMING` phase should share methodology with the existing `brainstorming` skill, but it must not copy/paste the skill text into unrelated extension code or attempt to invoke the skill as a nested command. The implementation should extract the reusable methodology into a package-owned prompt/methodology resource that both `/clarify` and the bundled skill can reference.

Recommended structure:

```text
brainstorming-pro/
  prompts/
    brainstorming-methodology.md      # shared methodology: context exploration, fuzziness, questions, convergence, design headings
    clarify-v0.md                     # clarify-specific wrapper around the shared methodology
  skills/
    brainstorming-pro/SKILL.md        # references the shared methodology conceptually
  extensions/clarification-orchestrator/
    phases/v0-brainstorming.ts        # orchestrates state/artifacts/UI, does not embed long methodology text
```

Implementation rules:

- Do not duplicate the full brainstorming methodology in TypeScript. TypeScript owns orchestration, state, artifact writes, and user gates.
- Put reusable methodology in markdown prompt resources so behavior can be reviewed and updated without code changes.
- `clarify-v0.md` should include the shared methodology plus clarify-specific constraints: generate `versions/v0/design.md`, stop at `DESIGN_REVIEW_GATE`, do not launch cross-review, do not invoke `spec-plan`.
- If the existing standalone `brainstorming` skill remains outside this package, record the dependency explicitly: Brainstorming Pro mirrors the public methodology and should be updated when that skill changes materially.
- If this package later owns both workflows, move the shared methodology into one canonical resource and have both commands/skills load it.

Consistency strategy:

- Add a methodology version string in the shared prompt resource, for example `methodologyVersion: brainstorming-v1`.
- Store the methodology version used for v0 in `metadata.json` and `versions/v0/discovery.md`.
- Add tests that assert `clarify-v0.md` includes or references the shared methodology resource instead of embedding a divergent copy.
- Add a documentation checklist item: when the brainstorming skill methodology changes, update the shared methodology resource or consciously record a divergence.

The phase should:

- inspect enough project context to understand purpose, stack, and structure;
- diagnose fuzziness level;
- ask focused questions one at a time when the request is ambiguous;
- surface assumptions and blind spots for non-trivial changes;
- converge on problem statement, non-goals, constraints, and success criteria;
- produce a design document using the standard design headings.

Artifacts use a clear separation between the latest public design, run-level metadata, versioned design snapshots, and review rounds:

```text
specs/<topic>/
  design.md                          # always mirrors the latest complete design version
  clarification/
    <run-id>/
      metadata.json                  # run metadata, resume status, current phase, latest version, active round
      request.md
      topic-proposal.json
      versions/
        v0/
          design.md
          discovery.md
          design-gate.json
```

`specs/<topic>/design.md` is the stable handoff path. Version directories are immutable snapshots except for filling gate metadata for that version.

#### Design Review Gate

Every design version enters the same gate.

Actions:

```ts
type DesignGateAction =
  | "approve-for-spec-plan"
  | "run-cross-review"
  | "revise-conversationally"
  | "save-and-exit";
```

The gate should show:

- current design version;
- `design.md` path;
- latest change summary;
- unresolved open questions, if any;
- whether pending issue discussions block approval;
- the four allowed actions.

Example prompt:

```text
Current design version: v1
Path: specs/<topic>/design.md

Choose next action:
1. approve - approve this design for spec-plan handoff
2. review  - run cross-review with subagents
3. revise  - continue conversational clarification/revision
4. save    - save current progress and exit; resume later with /clarify --resume
```

Gate decisions are persisted:

```ts
type DesignGateDecision = {
  version: string;
  action: "approve-for-spec-plan" | "run-cross-review" | "revise-conversationally" | "save-and-exit";
  reason?: string;
  decidedAt: string;
};
```

`save-and-exit` behavior:

- Persist the current state, latest design version, and a gate decision artifact.
- Set the run to a resumable interrupted/waiting state that points back to `DESIGN_REVIEW_GATE`.
- Do not create a new design version.
- Do not treat the design as approved.
- Do not run cross-review, issue decision, refine, or final approval.
- On `/clarify --resume`, return directly to the same design gate with the same design version and a note that the previous action was save-and-exit.

Artifacts:

```text
specs/<topic>/clarification/<run-id>/versions/v<N>/design-gate.json
```

The gate artifact belongs to the version being reviewed. If the user chooses `save-and-exit`, the same version directory records that decision and resume returns to that version's gate.

#### Cross-Review Round

When the user chooses `run-cross-review`, the orchestrator runs:

```text
CROSS_REVIEW -> TRIAGE -> ISSUE_DECISION_GATE -> REFINE -> DESIGN_REVIEW_GATE
```

All default reviewers are enabled. Since `--reviewers` is removed, reviewer customization is not part of the command-level UX. Future customization can be handled through configuration if needed.

Progress feedback is required because cross-review can be long-running:

- Set `resumeStatus: "in-cross-review"` as soon as the round starts.
- Show an initial progress summary with reviewer names, queued/running/completed/failed status, and the active round number.
- Emit progress updates when each reviewer starts, completes, fails, or retries.
- Emit heartbeat updates for long-running reviewers at a bounded interval, recommended every 30 seconds, showing elapsed time and current known status.
- After reviewer quorum is reached, notify the user that triage is starting.
- Show progress for triage and refine phases separately, including start, completion, retry, and failure.
- In `--verbose` mode, include attempt numbers, model names when available, elapsed time per agent, and artifact paths as they are written.
- In normal mode, keep messages concise: `Review round 1: 2/4 reviewers complete, 1 running, 1 queued`.
- Persist progress snapshots to `metadata.json` and append detailed events to the execution log so `/clarify --resume` and `/clarify-status` can report the latest known state after interruption.

Progress metadata should include:

```ts
type CrossReviewProgress = {
  round: number;
  phase: "review" | "triage" | "refine";
  startedAt: string;
  lastHeartbeatAt: string;
  reviewers: Array<{
    name: string;
    status: "queued" | "running" | "succeeded" | "failed" | "retrying";
    attempt: number;
    startedAt?: string;
    endedAt?: string;
    elapsedMs?: number;
    lastMessage?: string;
  }>;
};
```

Artifacts per round:

```text
specs/<topic>/clarification/<run-id>/reviews/
  round-1/
    review.json
    review.md
    triage.json
    triage.md
    decisions.json
    decisions.md
    refine.json
    refine.md
```

The refined design produced by a review round is stored as the next version under `versions/v<N>/design.md`, while `specs/<topic>/design.md` is updated to mirror it. Review artifacts stay under `reviews/round-<N>/` so review rounds and design versions do not get mixed.

#### Issue Decision Gate

The issue gate is retained from the old workflow, but threshold filtering is removed from the public/default behavior.

Rules:

- Every triaged issue enters the gate, including P0, P1, P2, and P3.
- The user decides each issue as:
  - `accept`
  - `reject`
  - `defer`
  - `discuss` / `needs-discussion`
- Only accepted issues are passed to the refiner as required changes.
- Rejected and deferred issues are recorded for traceability and final handoff.
- Discussed issues remain pending until resolved or explicitly deferred/rejected/accepted.
- `discuss` / `needs-discussion` is a blocking state for the current cross-review round. The workflow must not enter `REFINE` while any issue from the active round remains in this state.
- When issues are marked `discuss`, the state should record their IDs in `pendingDecisions`, write them to the decisions artifact, and resume directly at `ISSUE_DECISION_GATE` with a clear pending-discussion summary.
- On `/clarify --resume`, if pending discussion issues exist, the user should see the issue IDs, titles, severity, previous discussion notes/reason, and the required resolution choices: `accept`, `reject`, or `defer`. `discuss` may be chosen again only if the user adds new discussion notes or asks a concrete follow-up question.
- The design-level `approve-for-spec-plan` action must be unavailable while `pendingDecisions` contains unresolved discussion issues. If the user attempts to approve, the system should refuse approval, list the unresolved issues, and route the user back to `ISSUE_DECISION_GATE` to resolve or defer them.
- If the user wants to proceed without applying a discussed issue, they must explicitly choose `defer`; silent approval with unresolved discussion items is not allowed.

This avoids both automatic scope expansion and accidental omission of lower-severity but meaningful findings.

#### Conversational Revision

When the user chooses `revise-conversationally`, no cross-review subagents run by default. The main agent continues with brainstorming-style clarification or direct edits to the design based on user feedback. The main agent is responsible for classifying the revision type, explaining the classification when it affects flow, and asking the user for confirmation before applying changes that alter scope or approach.

Revision classification:

- **Minor wording/detail revision**: copy edits, terminology changes, clarification of already-agreed text, formatting, examples that do not alter behavior, or adding detail that is already implied by the approved scope. These can update the design directly.
- **Clarification revision**: feedback that reveals missing context, ambiguous success criteria, unclear non-goals, or an unresolved user preference. These should return to focused brainstorming questions before updating the design.
- **Scope or approach revision**: feedback that adds/removes a capability, changes the workflow state machine, changes user decision authority, changes artifact compatibility, changes public command semantics, or alters a major component boundary. These should return to convergence before updating the design.
- **Review-worthy major revision**: a scope or approach revision with high uncertainty, cross-component impact, safety/security implications, migration/backward-compatibility impact, or disagreement between alternatives. The agent should explicitly recommend running cross-review after drafting the revised design, but the user still decides at the next `DESIGN_REVIEW_GATE`; the workflow should not automatically launch subagents.

Rules:

- Minor wording/detail feedback can update the design directly.
- Clarification revisions should ask one focused question at a time until the missing context is resolved or recorded as an assumption.
- Scope or approach changes should return to convergence before updating the design.
- If the agent classifies a revision as review-worthy, it should record the reason in the revision artifact and recommend `run-cross-review` at the next design gate.
- Missing context should return to clarification questions.
- Every completed conversational revision increments the integer design version: `v0 -> v1 -> v2`. Cross-review refinements use the same sequence. Do not use patch-style versions such as `v0.1` because each gate reviews a complete latest design.
- If a user gives several small edits in one conversational revision turn, they are batched into one new version.
- If discussion does not produce a design change, no new design version is written; the workflow remains at or returns to `DESIGN_REVIEW_GATE` with the same version.
- The workflow returns to `DESIGN_REVIEW_GATE` after any completed design update.

Artifacts:

```text
specs/<topic>/clarification/<run-id>/versions/v<N>/
  design.md
  revision.md
  revision.json
  design-gate.json
```

A conversational revision writes the next integer design version under `versions/v<N>/`. The top-level `specs/<topic>/design.md` is updated to mirror that version.

The revision artifact should include:

- revision classification;
- user feedback summary;
- whether cross-review is recommended and why;
- changed design sections;
- previous and new design version IDs.

#### Final Approval / Spec-Plan Handoff

When the user chooses `approve-for-spec-plan`, the workflow writes `final-approval.md`, marks the run complete, and prints an explicit handoff instruction.

The final approval artifact should include:

- approved design path;
- latest design version;
- run directory;
- number of cross-review rounds;
- accepted/rejected/deferred issues;
- unresolved open questions or risks;
- `spec-plan` target directory and context.

Example handoff:

```text
Run spec-plan with:
- project name: <topic>
- target directory: specs/<topic>/
- design: specs/<topic>/design.md
- clarification artifacts: specs/<topic>/clarification/<run-id>/
```

### Data Flow

#### Initial Request Flow

1. User runs `/clarify <request>`.
2. Parser stores the full non-option text as `request`.
3. Topic proposal derives 2-3 kebab-case candidate slugs from the request, with translation/gloss metadata when applicable.
4. The system checks exact and semantic similarity against existing topics.
5. User chooses a candidate, reuses a similar existing topic, or edits/provides the topic.
6. Orchestrator creates `specs/<topic>/` and a new clarification run.
7. Request and topic proposal artifacts are written.
8. V0 brainstorming clarifies the request and writes v0 design.
9. `versions/v0/design.md` and latest `design.md` are written.
10. User enters `DESIGN_REVIEW_GATE`.

#### Cross-Review Flow

1. User chooses `run-cross-review` from the design gate.
2. Current `design.md` is passed to reviewer agents.
3. Reviewers independently return findings.
4. Triager deduplicates and prioritizes findings into issues.
5. All issues enter `ISSUE_DECISION_GATE`.
6. User decides each issue.
7. Refiner updates the design using accepted issues only.
8. New versioned design and latest `design.md` are written.
9. User returns to `DESIGN_REVIEW_GATE`.

#### Conversational Revision Flow

1. User chooses `revise-conversationally`.
2. Main agent asks follow-up questions or applies direct feedback.
3. Updated design is written as a new version.
4. Latest `design.md` is updated.
5. User returns to `DESIGN_REVIEW_GATE`.

#### Resume Flow

Resume is driven by fine-grained status in each run's `metadata.json`, not only by a broad pending/current flag.

```ts
type ResumeStatus =
  | "awaiting-topic-confirmation"
  | "awaiting-design-gate-decision"
  | "awaiting-issue-decisions"
  | "in-cross-review"
  | "completed"
  | "failed";
```

Recommended metadata shape:

```ts
type RunMetadata = {
  runId: string;
  topic?: string;
  requestSummary: string;
  resumeStatus: ResumeStatus;
  currentPhase: WorkflowPhase;
  latestVersion?: string;
  activeRound?: number;
  pendingDecisionIds: string[];
  lastUpdatedAt: string;
  resumeHint: string;
};
```

Status behavior:

- `awaiting-topic-confirmation`: resume shows the saved request, topic candidates, similar-topic warnings, and asks the user to choose/edit a topic.
- `awaiting-design-gate-decision`: resume shows the latest design version and the four design gate actions.
- `awaiting-issue-decisions`: resume shows the active review round, all unresolved issue decisions, and especially any blocking `discuss` issues.
- `in-cross-review`: resume reports that subagent work was interrupted or still in progress, using the latest persisted progress snapshot with reviewer statuses, elapsed time, active phase, retry counts, and completed artifact paths. If subprocesses are no longer running, the user can retry the round or discard partial round artifacts and return to the design gate.
- `completed`: not resumable by default; show final design and final approval paths.
- `failed`: show the failure summary, last safe phase, and recovery choices if available.

Flow:

1. User runs `/clarify --resume`.
2. Orchestrator scans run metadata and finds runs with resumable statuses: `awaiting-topic-confirmation`, `awaiting-design-gate-decision`, `awaiting-issue-decisions`, `in-cross-review`, or recoverable `failed`.
3. If one run exists, resume it.
4. If multiple runs exist, prompt user to select one, showing topic/request summary, resume status, latest version, active round, and last update time.
5. Route to the status-specific gate or recovery action.
6. If the run was paused by `save-and-exit`, its status is `awaiting-design-gate-decision`; show the same design version and normal design gate actions again.

## Error Handling

### Non-Interactive Context

If `hasUI === false`, the new workflow cannot safely confirm topics or collect design/issue gate decisions.

- `--dry-run` may still validate input and write a planned prompt/debug artifact.
- Non-dry-run execution should fail fast with a clear message that interactive confirmation is required.
- Future non-interactive support can add explicit topic/auto-confirm controls, but those are out of scope for this design.

### Missing Request

If the command is not `--resume` and has no request text, return usage guidance:

```text
Usage: /clarify <request> [--verbose] [--dry-run]
       /clarify --resume
```

### Topic Proposal Failure

If no meaningful candidate slug can be generated, ask the user to provide one. If generated candidates are semantically too close to existing topics, show the similar existing topics and ask whether to reuse one or provide a more specific topic. The confirmed topic must still pass path safety checks before artifact creation.

### Topic Conflict

If `specs/<topic>` already exists, ask whether to reuse the topic for a new run or edit the topic. Never silently overwrite `design.md` without an explicit confirmed run context.

### Subagent Failure

Subagent failures must be visible, bounded, and recoverable. Every failed subagent run should record enough information for the user to decide whether to retry, continue with partial results, or return to the design gate.

Retry limits:

- Each reviewer may be retried automatically at most 1 time for transient failures such as timeout, rate limit, model unavailable, or invalid structured output after repair fails.
- Triager and refiner may each be retried automatically at most 1 time for transient failures.
- After the automatic retry limit is exhausted, the workflow pauses with `resumeStatus: "failed"` or `"in-cross-review"` and asks the user whether to retry manually, continue when allowed, or abandon the current round.
- Manual retries should create a new attempt record and must not overwrite earlier failure records.

Reviewer quorum / enough-signal rule:

- The default reviewer set is product, architecture, risk, and testing.
- Cross-review may continue to triage only if at least 3 of 4 default reviewers succeed.
- If fewer than 3 reviewers succeed, the round is considered insufficient signal and should pause before triage.
- If exactly 3 reviewers succeed, the workflow may continue, but the missing reviewer and its failure reason must be shown to the user and recorded in the review round summary.
- If a custom configured reviewer set is used in the future, quorum should be `max(2, ceil(0.75 * reviewerCount))` successful reviewers.
- A failed risk or architecture reviewer should be highlighted as higher impact because those perspectives often catch safety, scope, and design-structure problems. The user may still choose to retry or continue if quorum is met.

Failure recording:

- Record failures in `reviews/round-<N>/review.json` or the relevant triage/refine artifact, plus execution logs and `metadata.json` summary fields.
- Include reviewer/agent name, role, attempt number, requested model, actual model if known, start/end timestamps, failure type, message, recoverability, stderr/stdout excerpts if safe, and whether redaction was applied.
- The user-facing summary should include concise failure reasons, not only "agent failed".
- Partial successful reviewer outputs remain available as untrusted inputs for triage only when quorum is met.

Triager/refiner behavior:

- Triager failure blocks issue decision and should keep the current design unchanged.
- Refiner failure must not overwrite `design.md`; the previous latest design remains authoritative.
- If refiner fails after issue decisions were collected, keep `decisions.json` and allow retrying refine without asking the user to re-enter decisions unless the triage artifact changes.
- All failures should be recorded in state and execution logs for resume/status.

### Invalid Refiner Output

If refiner output fails schema or safety validation:

- attempt structured repair if existing validation supports it;
- if repair fails, record an error artifact;
- do not update `design.md`;
- return to the design gate or allow resume/retry.

### Pending Discuss Decisions

If the user marks issues as `discuss`, those issues remain pending and block the current cross-review round.

- The workflow must stay in or resume to `ISSUE_DECISION_GATE` until every discussed issue is resolved to `accept`, `reject`, or `defer`.
- `REFINE` must not run while active-round discussed issues remain unresolved.
- `approve-for-spec-plan` must be blocked while `pendingDecisions` contains unresolved discussed issues.
- On resume, the system should summarize pending discussion issues before asking for decisions so the user cannot forget them.
- If the user no longer wants to handle a discussed issue, the explicit resolution is `defer`; unresolved discussion cannot be silently treated as approval.

### Path Safety

Generated or edited topics must be sanitized and validated by existing path guard logic. Topic strings must not allow path traversal, absolute paths, hidden control characters, or writes outside `specs/<topic>/` and the run directory.

## Testing

### Unit Tests

- `parseClarifyArgs` parses natural-language request text.
- `parseClarifyArgs` accepts only `--resume`, `--verbose`, and `--dry-run`.
- V0 brainstorming prompt loads or references the shared methodology resource instead of duplicating the full methodology in TypeScript.
- V0 artifacts record the methodology version used.
- Unknown options such as `--mode`, `--threshold`, `--max-rounds`, and `--reviewers` are rejected.
- Missing request without `--resume` returns the new usage error.
- Topic proposal generates 2-3 concise kebab-case candidates for English and Chinese requests.
- Chinese requests include translation/gloss metadata for English topic candidates.
- Topic proposal detects exact conflicts and semantic near-duplicates with existing topic slugs.
- Topic validation rejects traversal and unsafe characters.
- Design gate decision parsing accepts only approve/review/revise/save actions.
- Issue decision planning includes all P0/P1/P2/P3 issues.
- Discuss decisions populate `pendingDecisions` and block `REFINE`.
- Design approval is blocked while unresolved discuss decisions exist.
- Resume from pending discuss decisions returns to `ISSUE_DECISION_GATE` with a summary.
- Resume status mapping routes `awaiting-topic-confirmation`, `awaiting-design-gate-decision`, `awaiting-issue-decisions`, `in-cross-review`, `completed`, and `failed` correctly.
- Reviewer quorum requires at least 3 of 4 default reviewers before triage.
- Reviewer, triager, and refiner transient failures are retried at most once automatically.
- Cross-review progress emits start/completion/failure/retry events and bounded heartbeat updates for long-running reviewers.
- `metadata.json` stores the latest cross-review progress snapshot for resume/status.
- Failure artifacts include agent name, role, attempt, model, failure type/message, timestamps, recoverability, and redaction status.
- Refiner input includes only accepted issue IDs.
- Workflow transitions support:
  - v0 -> approve -> complete;
  - v0 -> revise -> gate;
  - v0 -> save-and-exit -> resume -> same gate;
  - v0 -> review -> triage -> issue decision -> refine -> gate;
  - repeated cross-review rounds.

### Integration Tests

- `/clarify <request> --dry-run` creates/prints a planned workflow without launching subagents.
- Interactive run: confirm topic -> produce v0 -> approve -> complete.
- Interactive run: confirm topic -> produce v0 -> cross-review -> decide all issues -> refine -> approve.
- Interactive run: confirm topic -> produce v0 -> revise conversationally -> approve.
- `/clarify --resume` resumes a single pending run.
- `/clarify --resume` prompts selection when multiple pending runs exist.
- Failed refiner output does not overwrite latest `design.md`.

### Security Tests

- Generated topics cannot escape `specs/`.
- User-edited topics are validated before path resolution.
- Malicious reviewer/triager/refiner output cannot trigger arbitrary file writes.
- Project-local config and agents remain subject to existing trust confirmation rules.
- Debug artifacts respect redaction settings.

## Open Questions

1. Should reviewer customization remain available through configuration even though `--reviewers` is removed from the command UX?
   - Current recommendation: yes, but not as a public `/clarify` argument.
2. Should an internal safety cap limit the number of cross-review rounds to prevent accidental runaway sessions?
   - Current recommendation: yes as a defensive internal limit, but do not expose `--max-rounds`.
3. Should `/clarify-status`, `/clarify-diff`, and `/clarify-clean` later support a latest/current-run mode without topic?
   - Current recommendation: defer; keep their existing topic-oriented UX for this change.
4. How should conversational revision be implemented in the extension boundary?
   - Current recommendation: the orchestrator records the gate decision and exposes the current design artifact; the main agent performs clarification/editing and writes the next version through controlled artifact APIs.
