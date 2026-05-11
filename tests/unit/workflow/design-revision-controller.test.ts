import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checksum, createWorkflowLayout, writeVersionedArtifact, type WorkflowLayout } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { runDesignRevisionController } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/controller.ts";
import { assertDesignApprovalUsesLatestDesign } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/staleness.ts";
import { readDesignRevisionRecord, writeDesignRevisionRecord } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/ledger.ts";
import { createDesignReviewRun, ensureReviewLedger, writeAggregatedFindings, writeCoverage, writeDesignReviewRun, writeReadiness, writeTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-run-store.ts";
import type { DesignReviewAggregateResult, DesignReviewCoverage, DesignReviewRun, DesignReviewTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { DesignRevisionAuthorization, DesignRevisionRecord } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts";
import { emptyOutputCaptureSummary, type AgentRunResult } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const validMarkdown = "# Design\n\n## Summary\nUpdated\n\n## Goals\nGoal\n\n## Non-Goals\nNone\n\n## Proposed Solution\nSolution\n\n## Requirements Traceability\nTrace";

async function fixture(options: { blockingQuestion?: boolean; answer?: boolean; exhausted?: boolean } = {}): Promise<{ layout: WorkflowLayout; run: DesignReviewRun; authorization: DesignRevisionAuthorization }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-controller-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  const designRef = await writeVersionedArtifact(layout, "design", validMarkdown);
  const run = createDesignReviewRun({ layout, workflowRunId: "run-1", mode: "full", designRef, reviewDecisionRef: "decision-1" });
  await ensureReviewLedger(run, layout);
  await writeDesignReviewRun(layout, run);
  const coverage: DesignReviewCoverage = { availableReviewers: ["product-reviewer"], selectedReviewers: ["product-reviewer"], unselectedReviewers: [], succeededReviewers: ["product-reviewer"], failedReviewers: [], pendingRetryReviewers: [] };
  await writeCoverage(layout, run, coverage);
  const aggregate: DesignReviewAggregateResult = {
    reviewRunId: run.reviewRunId,
    designRef,
    status: "blocked",
    summary: "Blocked",
    counts: { blocking: 1, nonBlocking: 0, notes: 0, byCategory: {}, byReviewer: {} },
    findings: [],
    readiness: { status: "blocked", blockingFindingIds: [], unresolvedUserQuestions: options.blockingQuestion ? ["q-1"] : [], summary: "Blocked" },
    coverage,
  };
  await writeAggregatedFindings(layout, run, aggregate);
  await writeReadiness(layout, run, aggregate.readiness);
  const triage: DesignReviewTriageReport = {
    reviewRunId: run.reviewRunId,
    designRef,
    status: "fresh",
    generatedAt: "2026-05-11T00:00:00.000Z",
    sources: {
      reviewRunId: run.reviewRunId,
      designRef,
      aggregate: { path: path.join(run.ledgerPath, "aggregated-findings.json"), checksum: checksum(`${JSON.stringify(aggregate, null, 2)}\n`) },
      coverage: { path: path.join(run.ledgerPath, "coverage.json"), checksum: checksum(`${JSON.stringify(coverage, null, 2)}\n`) },
      reviewerResults: [],
      reviewDecisionRef: "decision-1",
    },
    findings: [],
    clusters: [{ clusterId: "cluster-1", triageLevel: "must-fix", sourceFindingIds: [], reviewerRoles: ["product-reviewer"], category: "product", severity: "blocking", requiresRevision: true, title: "Fix", description: "Fix", affectedSections: [], recommendations: ["Fix"], userQuestions: [] }],
    conflicts: [],
    unresolvedQuestions: options.blockingQuestion ? [{ questionId: "q-1", question: "Which scope option should we choose?", blocking: true, sourceFindingIds: [], clusterIds: ["cluster-1"], reviewerRoles: ["product-reviewer"], relatedSections: ["Scope"] }] : [],
    coverage: { ...coverage, status: "complete", hasIncompleteCoverage: false },
    readiness: { status: "blocked", sourceReadiness: aggregate.readiness, recommendedNextAction: "revise-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: options.blockingQuestion ? ["q-1"] : [], summary: "Blocked" },
    summary: "Blocked",
  };
  await writeTriageReport(layout, run, triage);
  const authorization: DesignRevisionAuthorization = {
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    allowedAction: "single-revision-and-rereview",
    sourceDesignRef: designRef,
    sourceReviewRunId: run.reviewRunId,
    sourceTriageRef: { path: path.join(run.ledgerPath, "triage-report.json"), checksum: checksum(`${JSON.stringify(triage, null, 2)}\n`) },
    sourceReadinessRef: { path: path.join(run.ledgerPath, "readiness.json"), checksum: checksum(`${JSON.stringify(aggregate.readiness, null, 2)}\n`) },
    sourceCoverageRef: { path: path.join(run.ledgerPath, "coverage.json"), checksum: checksum(`${JSON.stringify(coverage, null, 2)}\n`) },
    postRevisionReview: { mode: "full", selectedReviewerRoles: ["product-reviewer"] },
    roundPolicy: { maxTotalRevisionRounds: options.exhausted ? 0 : 3, maxTotalPostRevisionReviewRounds: 3, usedRevisionRounds: 0, usedPostRevisionReviewRounds: 0 },
    userAnswers: options.answer ? [{ questionId: "q-1", answer: "Choose option A.", answeredBy: "user", answeredAt: "2026-05-11T00:01:00.000Z" }] : [],
    authorizedBy: "user",
    authorizedAt: "2026-05-11T00:00:00.000Z",
  };
  return { layout, run, authorization };
}

test("controller commits revised design and writes committed record", async () => {
  const { layout, run, authorization } = await fixture();
  const output = { revisedDesignMarkdown: validMarkdown.replace("Updated", "Revised"), changeSummary: ["Fixed cluster"], resolvedItemIds: ["cluster-1"], unresolvedItemIds: [], assumptions: [], riskNotes: [] };
  const result = await runDesignRevisionController({
    layout,
    authorization,
    reviewRun: run,
    options: { projectRoot: path.dirname(layout.topicDir), model: "test:model", runAgent: async <TOutput>(): Promise<AgentRunResult<TOutput>> => ({ agentRunId: "agent-1", role: "design-reviser", status: "succeeded", output: output as TOutput, paths: { agentRunDir: "agent" }, startedAt: "t", completedAt: "t", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() }) },
  });
  assert.equal(result.status, "committed", result.record.reason);
  assert.equal(result.record.targetDesignRef?.version, 2);
  assert.equal((await readDesignRevisionRecord(layout, authorization.revisionId)).status, "committed");
});

test("controller leaves previous design authoritative on artifact commit failure", async () => {
  const { layout, run, authorization } = await fixture();
  const before = await fs.readFile(path.join(layout.topicDir, "design.md"), "utf8");
  const output = { revisedDesignMarkdown: validMarkdown, changeSummary: ["Fixed"], resolvedItemIds: ["cluster-1"], unresolvedItemIds: [], assumptions: [], riskNotes: [] };
  const result = await runDesignRevisionController({
    layout,
    authorization,
    reviewRun: run,
    options: {
      projectRoot: path.dirname(layout.topicDir),
      model: "test:model",
      runAgent: async <TOutput>(): Promise<AgentRunResult<TOutput>> => ({ agentRunId: "agent-1", role: "design-reviser", status: "succeeded", output: output as TOutput, paths: { agentRunDir: "agent" }, startedAt: "t", completedAt: "t", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() }),
      commitRevisedDesign: async () => { throw new Error("commit failed"); },
    },
  });
  assert.equal(result.status, "failed");
  assert.equal(await fs.readFile(path.join(layout.topicDir, "design.md"), "utf8"), before);
});

test("controller rejects stale source and needs-user-input", async () => {
  const stale = await fixture();
  await writeVersionedArtifact(stale.layout, "design", validMarkdown.replace("Updated", "new latest"));
  const staleResult = await runDesignRevisionController({ layout: stale.layout, authorization: stale.authorization, reviewRun: stale.run, options: { projectRoot: path.dirname(stale.layout.topicDir), model: "test:model" } });
  assert.equal(staleResult.status, "stale-source");

  const blocked = await fixture({ blockingQuestion: true });
  const blockedResult = await runDesignRevisionController({ layout: blocked.layout, authorization: blocked.authorization, reviewRun: blocked.run, options: { projectRoot: path.dirname(blocked.layout.topicDir), model: "test:model" } });
  assert.equal(blockedResult.status, "needs-user-input");
  assert.deepEqual(blockedResult.record.blockingQuestionIds, ["q-1"]);
});

test("controller reports revision-exhausted and all terminal record statuses are valid", async () => {
  const exhausted = await fixture({ exhausted: true });
  const result = await runDesignRevisionController({ layout: exhausted.layout, authorization: exhausted.authorization, reviewRun: exhausted.run, options: { projectRoot: path.dirname(exhausted.layout.topicDir), model: "test:model" } });
  assert.equal(result.status, "revision-exhausted");

  for (const status of ["committed", "needs-user-input", "blocked", "failed", "revision-exhausted", "stale-source"] as const) {
    const record: DesignRevisionRecord = { ...result.record, revisionId: `rev-${status}`, status, completedAt: "2026-05-11T00:00:00.000Z" };
    await writeDesignRevisionRecord(exhausted.layout, record);
    assert.equal((await readDesignRevisionRecord(exhausted.layout, record.revisionId)).status, status);
  }
});

test("old review approval evidence is rejected after a revised design commit", async () => {
  const { layout, run, authorization } = await fixture();
  const oldRef = authorization.sourceDesignRef;
  const output = { revisedDesignMarkdown: validMarkdown.replace("Updated", "Revised"), changeSummary: ["Fixed cluster"], resolvedItemIds: ["cluster-1"], unresolvedItemIds: [], assumptions: [], riskNotes: [] };
  await runDesignRevisionController({
    layout,
    authorization,
    reviewRun: run,
    options: { projectRoot: path.dirname(layout.topicDir), model: "test:model", runAgent: async <TOutput>(): Promise<AgentRunResult<TOutput>> => ({ agentRunId: "agent-1", role: "design-reviser", status: "succeeded", output: output as TOutput, paths: { agentRunDir: "agent" }, startedAt: "t", completedAt: "t", attempts: 1, attemptRecords: [], outputCapture: emptyOutputCaptureSummary() }) },
  });
  await assert.rejects(() => assertDesignApprovalUsesLatestDesign(layout, oldRef), /stale/);
});
