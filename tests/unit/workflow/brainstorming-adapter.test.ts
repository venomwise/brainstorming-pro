import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBrainstormingAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/brainstorming.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { AgentRunRequest, AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const designMarkdown = `# Design

## Summary
x
## Goals
x
## Primary Users / Roles
x
## Non-Goals
x
## Context
x
## Proposed Solution
x
## Error Handling
x
## Testing
x
## Open Questions
x
`;

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-brainstorm-adapter-"));
}

test("brainstorming adapter invokes design-author and returns commit request", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  let captured: AgentRunRequest<unknown> | undefined;
  const adapter = createBrainstormingAdapter({
    projectRoot: cwd,
    model: "openai:test",
    async runAgent<TOutput>(request: AgentRunRequest<TOutput>) {
      captured = request as AgentRunRequest<unknown>;
      return { agentRunId: "a", role: request.role, status: "succeeded", output: { kind: "design-draft", topic: "my-topic", summary: "s", designMarkdown, assumptions: [], nonGoals: [], risks: [], openQuestions: [] } as TOutput, paths: { agentRunDir: cwd }, startedAt: "now", completedAt: "now", attempts: 1, attemptRecords: [], outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false } } satisfies AgentRunResult<TOutput>;
    },
  });
  const result = await adapter.run(state, state);
  assert.equal(captured?.role, "design-author");
  assert.equal(captured?.workflow.phase, "designing");
  assert.match(captured?.prompt ?? "", /design-draft/u);
  assert.match(captured?.systemPrompt ?? "", /design-author/u);
  assert.equal(captured?.model, "openai:test");
  assert.equal(result.kind, "artifact-commit-request");
  assert.equal(result.kind === "artifact-commit-request" && result.artifacts[0]?.kind, "design");
  assert.equal(result.kind === "artifact-commit-request" && result.artifacts[0]?.content, designMarkdown);
});

test("brainstorming adapter fails closed on child failure", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  const adapter = createBrainstormingAdapter({
    projectRoot: cwd,
    model: "openai:test",
    async runAgent(request) {
      return { agentRunId: "a", role: request.role, status: "failed", error: { kind: "non-zero-exit", message: "boom", retryable: true }, paths: { agentRunDir: cwd }, startedAt: "now", completedAt: "now", attempts: 1, attemptRecords: [], outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false } };
    },
  });
  const result = await adapter.run(state, state);
  assert.equal(result.kind, "failed");
  assert.equal(result.kind === "failed" && result.error.kind, "non-zero-exit");
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), /ENOENT/u);
});
