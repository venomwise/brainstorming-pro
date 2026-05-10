import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { saveWorkflowState, startWorkflow, WorkflowRuntimeOrchestrator, type WorkflowAdapter } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import { createDesignReviewAdapter } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review.ts";
import { emptyOutputCaptureSummary, type AgentRunResult } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import type { RunAgentFunction } from "../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { MinimalDesignReviewOutput } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";

async function prepared(output: MinimalDesignReviewOutput) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-integration-"));
  const started = await startWorkflow({ cwd, topic: "my-topic", request: "Build it", runId: "run-1" });
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  await saveWorkflowState(cwd, { ...started.state, phase: "awaiting-design-review-decision", artifacts: { design: ref } });
  const runAgent: RunAgentFunction = async <TOutput>() => ({ agentRunId: "agent-1", role: "minimal-reviewer", status: "succeeded", output, paths: { agentRunDir: "/tmp/agent" }, startedAt: "now", completedAt: "later", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() } as unknown as AgentRunResult<TOutput>);
  const adapter = createDesignReviewAdapter({ projectRoot: cwd, model: "test:model", runAgent });
  const workflowAdapter: WorkflowAdapter = {
    async run(state) {
      const result = await adapter.run(state, state);
      await adapter.validate(result, state);
      return adapter.commit(result, state);
    },
  };
  return { cwd, orchestrator: new WorkflowRuntimeOrchestrator(cwd, { adapters: { "design-review": workflowAdapter } }) };
}

test("runtime minimal passed review reaches awaiting design approval", async () => {
  const { orchestrator } = await prepared({ summary: "ok", confidence: "high", findings: [] });
  const state = await orchestrator.resumeWorkflow("my-topic", { type: "review-mode", mode: "minimal", user: "u" });
  assert.ok(!("selectionRequired" in state));
  assert.equal(state.phase, "awaiting-design-approval");
  assert.equal(state.reviewStatus.design?.status, "passed");
});

test("runtime blocking review does not reach approval", async () => {
  const { orchestrator } = await prepared({ summary: "blocked", confidence: "high", findings: [{ category: "product", severity: "blocking", title: "Missing scope", description: "Scope is missing.", requiresRevision: true }] });
  const state = await orchestrator.resumeWorkflow("my-topic", { type: "review-mode", mode: "minimal", user: "u" });
  assert.ok(!("selectionRequired" in state));
  assert.equal(state.phase, "blocked");
  assert.equal(state.reviewStatus.design?.status, "blocked");
});

test("runtime full review is unavailable and not approval-ready", async () => {
  const { orchestrator } = await prepared({ summary: "unused", confidence: "high", findings: [] });
  const state = await orchestrator.resumeWorkflow("my-topic", { type: "review-mode", mode: "full", user: "u" });
  assert.ok(!("selectionRequired" in state));
  assert.equal(state.phase, "blocked");
  assert.equal(state.reviewStatus.design?.status, "unavailable");
});
