import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createDesignReviewRun, ensureReviewLedger, writeAggregatedFindings, writeDesignReviewRun, writeReadiness, writeReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import type { DesignReviewAggregateResult, DesignReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";

async function fixture() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-design-review-ledger-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const ref = await writeVersionedArtifact(layout, "design", "# Design");
  const run = createDesignReviewRun({ layout, workflowRunId: "run-1", mode: "minimal", designRef: ref, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  return { layout, ref, run };
}

test("writes review ledger layout under topic workflow directory", async () => {
  const { layout, ref, run } = await fixture();
  await writeDesignReviewRun(layout, run);
  const reviewer: DesignReviewerResult = { reviewRunId: run.reviewRunId, reviewerRole: "minimal-reviewer", status: "succeeded", findings: [], summary: "ok", startedAt: "now", completedAt: "later" };
  const withReviewer = await writeReviewerResult(layout, run, reviewer);
  const readiness = { status: "ready-for-user-approval" as const, blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" };
  const aggregate: DesignReviewAggregateResult = { reviewRunId: run.reviewRunId, designRef: ref, status: "passed", summary: "passed", counts: { blocking: 0, nonBlocking: 0, notes: 0, byCategory: {}, byReviewer: {} }, findings: [], readiness };
  const withAggregate = await writeAggregatedFindings(layout, withReviewer, aggregate);
  await writeReadiness(layout, withAggregate, readiness);

  const root = path.join(layout.topicDir, run.ledgerPath);
  const reviewRun = JSON.parse(await fs.readFile(path.join(root, "review-run.json"), "utf8")) as { mode: string; designRef: { checksum: string }; ledgerPath: string };
  assert.equal(reviewRun.mode, "minimal");
  assert.equal(reviewRun.designRef.checksum, ref.checksum);
  assert.ok(reviewRun.ledgerPath.startsWith(".workflow/reviews/design/"));
  assert.equal((await fs.stat(path.join(root, "reviewer-results", "minimal-reviewer.json"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, "aggregated-findings.json"))).isFile(), true);
  assert.equal((await fs.stat(path.join(root, "readiness.json"))).isFile(), true);
});
