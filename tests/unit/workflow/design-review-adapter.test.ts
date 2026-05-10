import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createDesignReviewAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review.ts";
import { emptyOutputCaptureSummary, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import type { RunAgentFunction } from "../../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { MinimalDesignReviewOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { ReviewMode, WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function state(mode: ReviewMode): Promise<{ cwd: string; state: WorkflowState }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-adapter-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  return { cwd, state: { version: 1, runId: "run-1", topic: "my-topic", request: "x", phase: "design-review", createdAt: "now", updatedAt: "now", artifacts: { design: ref }, reviewDecisions: { design: { id: "decision-1", target: "design", mode, artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" } }, reviewStatus: {}, gates: {} } };
}

function runAgent(output: MinimalDesignReviewOutput): RunAgentFunction {
  return async <TOutput>() => ({ agentRunId: "agent-1", role: "minimal-reviewer", status: "succeeded", output, paths: { agentRunDir: "/tmp/agent" }, startedAt: "now", completedAt: "later", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() } as unknown as AgentRunResult<TOutput>);
}

test("adapter moves only passed or skipped design reviews to approval", async () => {
  const passedFixture = await state("minimal");
  const adapter = createDesignReviewAdapter({ projectRoot: passedFixture.cwd, model: "test:model", runAgent: runAgent({ summary: "ok", confidence: "high", findings: [] }) });
  const output = await adapter.run(passedFixture.state, passedFixture.state);
  await adapter.validate(output, passedFixture.state);
  const patch = await adapter.commit(output, passedFixture.state) as WorkflowState;
  assert.equal(patch.phase, "awaiting-design-approval");
  assert.equal(patch.reviewStatus.design?.status, "passed");

  const blockedFixture = await state("minimal");
  const blockedAdapter = createDesignReviewAdapter({ projectRoot: blockedFixture.cwd, model: "test:model", runAgent: runAgent({ summary: "blocked", confidence: "high", findings: [{ category: "architecture", severity: "blocking", title: "Gap", description: "Architecture is unclear.", requiresRevision: true }] }) });
  const blockedOutput = await blockedAdapter.run(blockedFixture.state, blockedFixture.state);
  const blockedPatch = await blockedAdapter.commit(blockedOutput, blockedFixture.state) as WorkflowState;
  assert.equal(blockedPatch.phase, "blocked");
  assert.equal(blockedPatch.reviewStatus.design?.status, "blocked");
});
