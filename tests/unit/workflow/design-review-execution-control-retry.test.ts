import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { emptyOutputCaptureSummary, type AgentRunRequest, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";
import { aggregatePartialDesignReviewFindings } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/partial-aggregation.ts";
import { computeDesignReviewCoverage } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts";
import { createDesignReviewRun, ensureReviewLedger, readCoverage, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import { retryFailedDesignReviewers } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/retry-failed-reviewers.ts";
import type { DesignReviewerOutput, DesignReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function partialFixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-retry-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  const state: WorkflowState = { version: 1, runId: "run-1", topic: "my-topic", request: "x", phase: "blocked", createdAt: "now", updatedAt: "now", artifacts: { design: ref }, reviewDecisions: { design: { id: "decision-1", target: "design", mode: "full", artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json", selectedReviewerRoles: ["product-reviewer", "testing-reviewer"] } }, reviewStatus: {}, gates: {} };
  let run = createDesignReviewRun({ layout, workflowRunId: state.runId, mode: "full", designRef: ref, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  const product = result(run.reviewRunId, "product-reviewer", "succeeded");
  const testing = result(run.reviewRunId, "testing-reviewer", "failed");
  run = await writeReviewerResult(layout, run, product);
  run = await writeReviewerResult(layout, run, testing);
  const coverage = computeDesignReviewCoverage({ selectedReviewerRoles: ["product-reviewer", "testing-reviewer"], reviewerResults: [product, testing] });
  await writeCoverage(layout, run, coverage);
  const aggregate = aggregatePartialDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: ref, successfulResults: [product], failedResults: [testing], coverage });
  run = await writeAggregatedFindings(layout, run, aggregate);
  run = await writeReadiness(layout, run, aggregate.readiness);
  run = { ...run, status: "partial" };
  await writeDesignReviewRun(layout, run);
  return { cwd, layout, ref, state, run };
}

function result(reviewRunId: string, reviewerRole: DesignReviewerResult["reviewerRole"], status: DesignReviewerResult["status"]): DesignReviewerResult {
  return { reviewRunId, reviewerRole, status, findings: [], summary: status === "succeeded" ? "ok" : undefined, error: status === "failed" ? { kind: "timeout", message: "timed out", retryable: true } : undefined, startedAt: "now", completedAt: "later" };
}

function retryAgent(output: DesignReviewerOutput | "fail") {
  return async <TOutput>(request: AgentRunRequest<TOutput>) => ({ agentRunId: `agent-${request.role}`, role: request.role, status: output === "fail" ? "timed-out" : "succeeded", output: output === "fail" ? undefined : output, paths: { agentRunDir: "/tmp/agent" }, startedAt: "now", completedAt: "later", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary(), error: output === "fail" ? { kind: "timeout", message: "timed out", retryable: true } : undefined } as unknown as AgentRunResult<TOutput>);
}

test("retries only current failed reviewers and updates effective results on success", async () => {
  const { cwd, layout, run, state } = await partialFixture();
  const retry = await retryFailedDesignReviewers({ layout, state, reviewRun: run, options: { projectRoot: cwd, model: "test:model", runAgent: retryAgent({ summary: "ok", confidence: "high", findings: [] }) } });
  assert.equal(retry.status, "passed");
  assert.equal(retry.readiness.status, "ready-for-user-approval");
  assert.deepEqual((await readCoverage(layout, run)).failedReviewers, []);
});

test("retry rejects stale design artifact binding", async () => {
  const fixture = await partialFixture();
  const staleState = { ...fixture.state, artifacts: { design: { ...fixture.ref, checksum: "changed" } } };
  await assert.rejects(() => retryFailedDesignReviewers({ layout: fixture.layout, state: staleState, reviewRun: fixture.run, options: { projectRoot: fixture.cwd, model: "test:model", runAgent: retryAgent({ summary: "ok", confidence: "high", findings: [] }) } }), /Stale design review decision|stale design artifact/i);
});

test("retry failure preserves previous successes and pending retry", async () => {
  const { cwd, layout, run, state } = await partialFixture();
  const retry = await retryFailedDesignReviewers({ layout, state, reviewRun: run, options: { projectRoot: cwd, model: "test:model", runAgent: retryAgent("fail") } });
  assert.equal(retry.status, "partial");
  const coverage = await readCoverage(layout, run);
  assert.deepEqual(coverage.succeededReviewers, ["product-reviewer"]);
  assert.deepEqual(coverage.pendingRetryReviewers, ["testing-reviewer"]);
});
