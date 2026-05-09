import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createBrainstormingAdapter } from "../../extensions/clarification-orchestrator/workflow/adapters/brainstorming.ts";
import { createInitialWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { AgentRunRequest, AgentRunResult } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

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
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-adapter-sec-"));
}

test("agent-backed adapters draft only and do not write runtime authority files", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  const adapter = createBrainstormingAdapter({
    projectRoot: cwd,
    model: "openai:test",
    async runAgent<TOutput>(request: AgentRunRequest<TOutput>) {
      return { agentRunId: "a", role: request.role, status: "succeeded", output: { kind: "design-draft", topic: "my-topic", summary: "s", designMarkdown, assumptions: [], nonGoals: [], risks: [], openQuestions: [] } as TOutput, paths: { agentRunDir: cwd }, startedAt: "now", completedAt: "now", attempts: 1, attemptRecords: [], outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false } } satisfies AgentRunResult<TOutput>;
    },
  });
  await adapter.run(state, state);
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", "design.md"), "utf8"), /ENOENT/u);
  await assert.rejects(fs.readFile(path.join(cwd, "specs", "my-topic", ".workflow", "runs", "run-1", "state.json"), "utf8"), /ENOENT/u);
  assert.deepEqual(await fs.readdir(path.join(cwd, "specs", "my-topic", ".workflow", "approvals")), []);
  assert.deepEqual(await fs.readdir(path.join(cwd, "specs", "my-topic", ".workflow", "decisions")), []);
});

test("adapter source does not expose generic orchestration APIs", async () => {
  const files = await Promise.all([
    fs.readFile("extensions/clarification-orchestrator/workflow/adapters/brainstorming.ts", "utf8"),
    fs.readFile("extensions/clarification-orchestrator/workflow/adapters/spec-plan.ts", "utf8"),
    fs.readFile("extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts", "utf8"),
  ]);
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /generic subagent|parallel orchestration|chain orchestration|background async runner/u);
});
