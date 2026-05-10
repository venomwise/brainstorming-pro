import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { runDesignReviewPanel } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/panel.ts";
import { emptyOutputCaptureSummary, createAgentRunError, type AgentRunRequest, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import type { RunAgentFunction } from "../../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";
import type { DesignReviewerOutput, MinimalDesignReviewOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { FullDesignReviewerRole, ReviewMode, WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function fixture(mode: ReviewMode, design = "# Design", selectedReviewerRoles?: FullDesignReviewerRole[]) {
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
    reviewDecisions: { design: mode === "full" ? { id: "decision-1", target: "design", mode, artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json", selectedReviewerRoles } : { id: "decision-1", target: "design", mode, artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" } },
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

function fullAgentByRole(outputs: Record<string, DesignReviewerOutput | "fail">): RunAgentFunction {
  return async <TOutput>(request: AgentRunRequest<TOutput>) => {
    const output = outputs[request.role];
    if (output === "fail") {
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
        error: createAgentRunError("timeout", `${request.role} timed out`, { retryable: true }),
      } as unknown as AgentRunResult<TOutput>;
    }
    return {
      agentRunId: `agent-${request.role}`,
      role: request.role,
      status: "succeeded",
      output: output ?? { summary: "ok", confidence: "high", findings: [] },
      paths: { agentRunDir: "/tmp/agent" },
      startedAt: "now",
      completedAt: "later",
      attempts: 1,
      attemptRecords: [],
      outputCapture: emptyOutputCaptureSummary(),
    } as unknown as AgentRunResult<TOutput>;
  };
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

test("skip remains explicit and full review now executes the registered reviewer pack", async () => {
  const skippedFixture = await fixture("skip");
  const skipped = await runDesignReviewPanel(skippedFixture.state, { projectRoot: skippedFixture.cwd, model: "test:model", runAgent: successfulAgent({ summary: "unused", confidence: "high", findings: [] }) });
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.readiness.status, "skipped-by-user");

  const fullFixture = await fixture("full");
  const full = await runDesignReviewPanel(fullFixture.state, { projectRoot: fullFixture.cwd, model: "test:model", runAgent: successfulAgent({ summary: "unused", confidence: "high", findings: [] }) });
  assert.equal(full.status, "passed");
  assert.equal(full.readiness.status, "ready-for-user-approval");
  assert.equal(full.unavailableReason, undefined);
});

test("full review partial success aggregates successful findings and reports incomplete readiness", async () => {
  const partialFixture = await fixture("full", "# Design", ["product-reviewer", "testing-reviewer"]);
  const partial = await runDesignReviewPanel(partialFixture.state, {
    projectRoot: partialFixture.cwd,
    model: "test:model",
    runAgent: fullAgentByRole({
      "product-reviewer": { summary: "ok", confidence: "high", findings: [{ category: "product", severity: "non-blocking", title: "Clarify user", description: "Add user detail.", requiresRevision: false }] },
      "testing-reviewer": "fail",
    }),
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.readiness.status, "incomplete-review");
  assert.equal(partial.aggregate?.findings.length, 1);
  assert.deepEqual(partial.aggregate?.coverage?.succeededReviewers, ["product-reviewer"]);
  assert.deepEqual(partial.aggregate?.coverage?.failedReviewers, ["testing-reviewer"]);
});

test("full review partial success with blocking findings is blocked", async () => {
  const partialFixture = await fixture("full", "# Design", ["product-reviewer", "testing-reviewer"]);
  const partial = await runDesignReviewPanel(partialFixture.state, {
    projectRoot: partialFixture.cwd,
    model: "test:model",
    runAgent: fullAgentByRole({
      "product-reviewer": { summary: "blocked", confidence: "high", findings: [{ category: "product", severity: "blocking", title: "Missing user", description: "User story is missing.", requiresRevision: true }] },
      "testing-reviewer": "fail",
    }),
  });
  assert.equal(partial.status, "blocked");
  assert.equal(partial.readiness.status, "blocked");
  assert.equal(partial.aggregate?.counts.blocking, 1);
});

test("full review all selected reviewers failed remains failed", async () => {
  const failedFixture = await fixture("full", "# Design", ["product-reviewer", "testing-reviewer"]);
  const failed = await runDesignReviewPanel(failedFixture.state, {
    projectRoot: failedFixture.cwd,
    model: "test:model",
    runAgent: fullAgentByRole({ "product-reviewer": "fail", "testing-reviewer": "fail" }),
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.readiness.status, "failed");
});
