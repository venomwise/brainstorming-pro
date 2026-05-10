import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { acceptIncompleteDesignReview } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/accept-incomplete.ts";
import { aggregatePartialDesignReviewFindings } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/partial-aggregation.ts";
import { computeDesignReviewCoverage } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts";
import { createDesignReviewRun, ensureReviewLedger, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import type { DesignReviewFinding, DesignReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function partialFixture(blocking = false) {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-accept-incomplete-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  const state: WorkflowState = { version: 1, runId: "run-1", topic: "my-topic", request: "x", phase: "blocked", createdAt: "now", updatedAt: "now", artifacts: { design: ref }, reviewDecisions: { design: { id: "decision-1", target: "design", mode: "full", artifacts: [ref], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json", selectedReviewerRoles: ["product-reviewer", "testing-reviewer"] } }, reviewStatus: {}, gates: {} };
  let run = createDesignReviewRun({ layout, workflowRunId: state.runId, mode: "full", designRef: ref, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  const finding: DesignReviewFinding | undefined = blocking ? { id: "product-reviewer-001", reviewRunId: run.reviewRunId, designRef: ref, reviewerRole: "product-reviewer", category: "product", severity: "blocking", title: "Block", description: "Blocking issue.", requiresRevision: true } : undefined;
  const product: DesignReviewerResult = { reviewRunId: run.reviewRunId, reviewerRole: "product-reviewer", status: "succeeded", findings: finding ? [finding] : [], summary: "ok", startedAt: "now", completedAt: "later" };
  const testing: DesignReviewerResult = { reviewRunId: run.reviewRunId, reviewerRole: "testing-reviewer", status: "failed", findings: [], error: { kind: "timeout", message: "timed out", retryable: true }, startedAt: "now", completedAt: "later" };
  run = await writeReviewerResult(layout, run, product);
  run = await writeReviewerResult(layout, run, testing);
  const coverage = computeDesignReviewCoverage({ selectedReviewerRoles: ["product-reviewer", "testing-reviewer"], reviewerResults: [product, testing] });
  await writeCoverage(layout, run, coverage);
  const aggregate = aggregatePartialDesignReviewFindings({ reviewRunId: run.reviewRunId, designRef: ref, successfulResults: [product], failedResults: [testing], coverage });
  run = await writeAggregatedFindings(layout, run, aggregate);
  run = await writeReadiness(layout, run, aggregate.readiness);
  run = { ...run, status: aggregate.status };
  await writeDesignReviewRun(layout, run);
  return { cwd, layout, ref, state, run };
}

test("accepts safe incomplete full review with explicit user confirmation", async () => {
  const fixture = await partialFixture();
  const accepted = await acceptIncompleteDesignReview({ layout: fixture.layout, state: fixture.state, reviewRun: fixture.run, confirmedByUser: true, decidedBy: "tester", decidedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(accepted.nextPhase, "awaiting-design-approval");
  assert.equal(accepted.decision.decidedBy, "user");
  assert.deepEqual(accepted.decision.acceptedCoverage.failedReviewers, ["testing-reviewer"]);
  assert.equal((await fs.stat(path.join(fixture.layout.topicDir, fixture.run.ledgerPath, "accept-incomplete-decision.json"))).isFile(), true);
});

test("rejects missing explicit confirmation, blocking partial, stale artifact, and minimal mode", async () => {
  const fixture = await partialFixture();
  await assert.rejects(() => acceptIncompleteDesignReview({ layout: fixture.layout, state: fixture.state, reviewRun: fixture.run, confirmedByUser: false, decidedBy: "tester" }), /explicit user confirmation/);
  const blocking = await partialFixture(true);
  await assert.rejects(() => acceptIncompleteDesignReview({ layout: blocking.layout, state: blocking.state, reviewRun: blocking.run, confirmedByUser: true, decidedBy: "tester" }), /Only incomplete partial|blocking findings/);
  await assert.rejects(() => acceptIncompleteDesignReview({ layout: fixture.layout, state: { ...fixture.state, artifacts: { design: { ...fixture.ref, checksum: "changed" } } }, reviewRun: fixture.run, confirmedByUser: true, decidedBy: "tester" }), /Stale design review decision|stale design artifact/i);
  await assert.rejects(() => acceptIncompleteDesignReview({ layout: fixture.layout, state: fixture.state, reviewRun: { ...fixture.run, mode: "minimal" }, confirmedByUser: true, decidedBy: "tester" }), /Only full/);
});
