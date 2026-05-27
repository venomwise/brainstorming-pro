# Agent Execution Runtime

This directory implements Brainstorming Pro's internal foreground child Pi execution runtime. It is workflow-owned infrastructure for phase adapters and future review panels, not a public subagent product API.

## Implemented files

- `types.ts` — shared `AgentRole`, `AgentRunRequest`, `AgentRunResult`, limits, paths, errors, output schemas, and progress event types.
- `roles.ts` — fixed Brainstorming Pro role registry and phase policy for `design-author`, `design-reviser`, `plan-author`, `task-executor`, and `minimal-reviewer`.
- `recursion-guard.ts` — child env marker and max-depth guard for foreground child execution.
- `model-policy.ts` — provider-qualified model validation before launch.
- `launch-spec.ts` — deterministic Pi invocation resolution and safe `AgentLaunchSpec` construction.
- `prompt-files.ts` — topic-scoped prompt/system prompt and per-agent-run audit path creation.
- `audit-files.ts` — redacted metadata and structured result JSON writers.
- `output.ts` — bounded stdout/stderr/raw output capture helpers.
- `spawn.ts` — foreground `child_process.spawn` wrapper with timeout and typed failure handling.
- `result-validation.ts` — caller-supplied structured output schema parse/validate helper.
- `progress.ts` — observational agent progress events for future TUI/snapshot integration.
- `retry.ts` — bounded retry policy helpers for retryable execution failures.
- `run-agent.ts` — internal `runAgent()` orchestration.
- `index.ts` — internal exports for phase adapters.

## Safety defaults

All first-version child invocations preserve these invariants:

- `PI_COMMAND` is a single executable path override; it is not shell-parsed or split into command fragments. If Pi cannot be found through automatic resolution, set `PI_COMMAND` to the absolute path printed by `which pi`, not to a shell command such as `npx pi` or `node path/to/pi.js`.
- Child launches use `shell: false` and explicit command/args/env/stdio.
- Child Pi invocations include `--no-session`.
- Child Pi invocations include `--no-skills`.
- Child environment includes `BRAINSTORMING_PRO_CHILD=1`, parent run id, agent run id, role, and depth.
- Max child depth is `1`; child processes cannot launch nested child agents.
- `index.ts` skips `/brainstorm-pro` command registration in child mode.
- Provider-qualified model validation runs before spawn.
- Phase adapters pass the workflow state's persisted `agentModel`; the execution runtime does not choose hidden environment or hardcoded model defaults.
- Output is bounded and untrusted until caller-supplied schema validation succeeds.

## Product boundary

This runtime must not expose generic `single`, `parallel`, `chain`, or `async` orchestration modes, a public `subagent` command/tool, intercom, background async runners, or upstream builtin agents. Review concurrency, if introduced later, must be driven by workflow-defined review panel specs and approval gates.

`runAgent()` returns structured execution results only. It does not transition workflow state, commit artifacts, write review decisions, or approve gates.

## Testing strategy

The runtime is tested with deterministic fake child processes instead of real LLM calls:

- unit tests cover role policy, launch safety, recursion/model policy, prompt/audit files, spawn/output, validation/progress, and `runAgent()` orchestration;
- integration tests use `tests/fixtures/agent-execution/fake-child.mjs` for success, non-zero exit, timeout, huge output, malformed output, and schema mismatch;
- security tests assert no generic subagent API, no shell parsing, no child workflow command registration, and no direct workflow state/artifact/approval mutation.

## Adapter usage sketch

Phase adapters should provide the role, prompt, system prompt, provider-qualified model from the persisted workflow `agentModel`, workflow context, and a business-specific output schema:

```ts
const result = await runAgent({
  role: "design-author",
  purpose: "draft design",
  prompt,
  systemPrompt,
  model,
  workflow,
  outputSchema: designDraftSchema,
});
```

Adapters must interpret `AgentRunResult` and return adapter output to the workflow runtime. Artifact commits and phase transitions remain workflow runtime responsibilities.
