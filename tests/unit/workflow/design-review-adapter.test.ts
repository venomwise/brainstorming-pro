import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createDesignReviewAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review.ts";
import { emptyOutputCaptureSummary, type AgentRunRequest, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import type { RunAgentFunction } from "../../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { DesignReviewerOutput, MinimalDesignReviewOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { ReviewMode, WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function state(mode: ReviewMode): Promise<{ cwd: string; state: WorkflowState }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-adapter-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  return { cwd, state: { version: 1, runId: "run-1", topic: "my-topic", request: "x", phase: "design-review", createdAt: "now", updatedAt: "now", artifacts: { design: ref }, reviewDecisions: { design: mode === "full" ? { id: "decision-1", target: "design", mode, artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json", selectedReviewerRoles: ["product-reviewer", "testing-reviewer"] } : { id: "decision-1", target: "design", mode, artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" } }, reviewStatus: {}, gates: {} } };
}

function runAgent(output: MinimalDesignReviewOutput): RunAgentFunction {
  return async <TOutput>() => ({ agentRunId: "agent-1", role: "minimal-reviewer", status: "succeeded", output, paths: { agentRunDir: "/tmp/agent" }, startedAt: "now", completedAt: "later", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() } as unknown as AgentRunResult<TOutput>);
}

function fullAgentByRole(outputs: Record<string, DesignReviewerOutput | "fail">): RunAgentFunction {
  return async <TOutput>(request: AgentRunRequest<TOutput>) => {
    const output = outputs[request.role];
    return { agentRunId: `agent-${request.role}`, role: request.role, status: output === "fail" ? "timed-out" : "succeeded", output: output === "fail" ? undefined : output, paths: { agentRunDir: "/tmp/agent" }, startedAt: "now", completedAt: "later", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary(), error: output === "fail" ? { kind: "timeout", message: "timed out", retryable: true } : undefined } as unknown as AgentRunResult<TOutput>;
  };
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

test("adapter exposes partial full review as recoverable incomplete-design-review blocker", async () => {
  const fixture = await state("full");
  const adapter = createDesignReviewAdapter({
    projectRoot: fixture.cwd,
    model: "test:model",
    runAgent: fullAgentByRole({
      "product-reviewer": { summary: "ok", confidence: "high", findings: [] },
      "testing-reviewer": "fail",
    }),
  });
  const output = await adapter.run(fixture.state, fixture.state);
  await adapter.validate(output, fixture.state);
  const patch = await adapter.commit(output, fixture.state) as WorkflowState;
  assert.equal(patch.phase, "blocked");
  assert.equal(patch.lastError?.message, "incomplete-design-review");
  assert.equal(patch.reviewStatus.design?.status, "partial");
  assert.equal(patch.reviewStatus.design?.readinessStatus, "incomplete-review");
  assert.equal(Array.isArray(patch.reviewStatus.design?.recoveryActions), true);
});
