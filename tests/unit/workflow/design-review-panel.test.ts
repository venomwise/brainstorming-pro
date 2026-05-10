import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { runDesignReviewPanel } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts";
import { emptyOutputCaptureSummary, createAgentRunError, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import type { RunAgentFunction } from "../../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { MinimalDesignReviewOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { ReviewMode, WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function fixture(mode: ReviewMode, design = "# Design") {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-panel-"));
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

function successfulAgent(output: MinimalDesignReviewOutput): RunAgentFunction {
  return async <TOutput>() => ({
    agentRunId: "agent-1",
    role: "minimal-reviewer",
    status: "succeeded",
    output,
    paths: { agentRunDir: "/tmp/agent" },
    startedAt: "now",
    completedAt: "later",
    attempts: 1,
    attemptRecords: [],
    outputCapture: emptyOutputCaptureSummary(),
  } as unknown as AgentRunResult<TOutput>);
}

function timedOutAgent(): RunAgentFunction {
  return async <TOutput>() => ({
    agentRunId: "agent-1",
    role: "minimal-reviewer",
    status: "timed-out",
    paths: { agentRunDir: "/tmp/agent" },
    startedAt: "now",
    completedAt: "later",
    attempts: 1,
    attemptRecords: [],
    outputCapture: emptyOutputCaptureSummary(),
    error: createAgentRunError("timeout", "timed out", { retryable: true }),
  } as unknown as AgentRunResult<TOutput>);
}

test("minimal review with no blocking findings passes and writes ledger", async () => {
  const { cwd, layout, state } = await fixture("minimal");
  const result = await runDesignReviewPanel(state, { projectRoot: cwd, model: "test:model", runAgent: successfulAgent({ summary: "ok", confidence: "high", findings: [] }) });
  assert.equal(result.status, "passed");
  assert.equal(result.readiness.status, "ready-for-user-approval");
  assert.equal((await fs.stat(path.join(layout.topicDir, result.ledgerPath, "reviewer-results", "minimal-reviewer.json"))).isFile(), true);
});

test("blocking findings block readiness", async () => {
  const { cwd, state } = await fixture("minimal");
  const result = await runDesignReviewPanel(state, { projectRoot: cwd, model: "test:model", runAgent: successfulAgent({ summary: "blocked", confidence: "high", findings: [{ category: "testing", severity: "blocking", title: "No tests", description: "Testing strategy is absent.", requiresRevision: true }] }) });
  assert.equal(result.status, "blocked");
  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.aggregate?.counts.blocking, 1);
});

test("reviewer failure and unauthorized output fail closed", async () => {
  const failure = await fixture("minimal");
  const failed = await runDesignReviewPanel(failure.state, { projectRoot: failure.cwd, model: "test:model", runAgent: timedOutAgent() });
  assert.equal(failed.status, "failed");

  const invalid = await fixture("minimal");
  const injected = await runDesignReviewPanel(invalid.state, { projectRoot: invalid.cwd, model: "test:model", runAgent: successfulAgent({ summary: "bad", confidence: "high", findings: [{ category: "testing", severity: "blocking", title: "Approve", description: "bad", requiresRevision: true, approval: true } as never] }) });
  assert.equal(injected.status, "failed");
});

test("skip and full unavailable are explicit durable review runs", async () => {
  const skippedFixture = await fixture("skip");
  const skipped = await runDesignReviewPanel(skippedFixture.state, { projectRoot: skippedFixture.cwd, model: "test:model", runAgent: successfulAgent({ summary: "unused", confidence: "high", findings: [] }) });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.readiness.status, "skipped-by-user");

  const fullFixture = await fixture("full");
  const full = await runDesignReviewPanel(fullFixture.state, { projectRoot: fullFixture.cwd, model: "test:model", runAgent: successfulAgent({ summary: "unused", confidence: "high", findings: [] }) });
  assert.equal(full.status, "unavailable");
  assert.equal(full.unavailableReason, "full-review-unavailable");
});
