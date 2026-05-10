import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createAgentRunError, emptyOutputCaptureSummary, type AgentRunRequest, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import { runDesignReviewPanel } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts";
import type { RunAgentFunction } from "../../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function fixture(mode: "full" | "minimal" = "full", design = "# Design") {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-full-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", design);
  const state: WorkflowState = {
    version: 1,
    runId: "run-1",
    topic: "my-topic",
    request: "x",
    phase: "design-review",
    createdAt: "now",
    updatedAt: "now",
    artifacts: { design: ref },
    reviewDecisions: { design: { id: "decision-1", target: "design", mode, artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" } },
    reviewStatus: {},
    gates: {},
  };
  return { cwd, layout, ref, state };
}

function fullReviewAgent(options: { blockingRole?: string; failingRole?: string } = {}): RunAgentFunction {
  return async <TOutput>(request: AgentRunRequest<TOutput>) => {
    if (request.role === options.failingRole) {
      return {
        agentRunId: `agent-${request.role}`,
        role: request.role,
        status: "timed-out",
        paths: { agentRunDir: "/tmp/agent" },
        startedAt: "now",
        completedAt: "later",
        attempts: 1,
        attemptRecords: [],
        outputCapture: emptyOutputCaptureSummary(),
        error: createAgentRunError("timeout", "timed out", { retryable: true }),
      } as unknown as AgentRunResult<TOutput>;
    }

    const findings = request.role === options.blockingRole
      ? [{ category: "testing", severity: "blocking", title: "Missing tests", description: "The design does not explain how testing will be verified.", requiresRevision: true }]
      : [];

    return {
      agentRunId: `agent-${request.role}`,
      role: request.role,
      status: "succeeded",
      output: { summary: `${request.role} done`, confidence: "high", findings },
      paths: { agentRunDir: "/tmp/agent" },
      startedAt: "now",
      completedAt: "later",
      attempts: 1,
      attemptRecords: [],
      outputCapture: emptyOutputCaptureSummary(),
    } as unknown as AgentRunResult<TOutput>;
  };
}

test("full review executes all five reviewers and writes all reviewer result files", async () => {
  const { cwd, layout, state } = await fixture();
  const seenRoles: string[] = [];
  const result = await runDesignReviewPanel(state, {
    projectRoot: cwd,
    model: "test:model",
    runAgent: async (request) => {
      seenRoles.push(request.role);
      return fullReviewAgent()(request);
    },
  });

  assert.equal(result.status, "passed");
  assert.equal(result.readiness.status, "ready-for-user-approval");
  assert.deepEqual(seenRoles, [
    "product-reviewer",
    "architecture-reviewer",
    "risk-security-reviewer",
    "testing-reviewer",
    "scope-simplicity-reviewer",
  ]);
  for (const role of seenRoles) {
    assert.equal((await fs.stat(path.join(layout.topicDir, result.ledgerPath, "reviewer-results", `${role}.json`))).isFile(), true);
  }
});

test("full review blocks when any reviewer returns a blocking finding", async () => {
  const { cwd, state } = await fixture();
  const result = await runDesignReviewPanel(state, {
    projectRoot: cwd,
    model: "test:model",
    runAgent: fullReviewAgent({ blockingRole: "testing-reviewer" }),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.aggregate?.counts.blocking, 1);
  assert.equal(result.aggregate?.findings.some((finding) => finding.reviewerRole === "testing-reviewer" && finding.severity === "blocking"), true);
});

test("full review records partial result when one selected reviewer fails", async () => {
  const { cwd, state } = await fixture();
  const result = await runDesignReviewPanel(state, {
    projectRoot: cwd,
    model: "test:model",
    runAgent: fullReviewAgent({ failingRole: "risk-security-reviewer" }),
  });

  assert.equal(result.status, "partial");
  assert.equal(result.readiness.status, "incomplete-review");
  assert.equal(result.error?.kind, "timeout");
  assert.equal(result.aggregate?.coverage?.failedReviewers.includes("risk-security-reviewer"), true);
});
