import test from "node:test";
import assert from "node:assert/strict";

import { evaluateUserQuestionGate } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/user-questions.ts";
import { evaluateRevisionRoundPolicy } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/round-policy.ts";
import { validateDesignRevisionOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/schemas.ts";
import type { DesignReviewTriageReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { writeDesignRevisionRecord } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/ledger.ts";
import type { DesignRevisionRecord } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "sha", createdAt: "2026-05-11T00:00:00.000Z" };

function triage(overrides: Partial<DesignReviewTriageReport> = {}): DesignReviewTriageReport {
  return {
    reviewRunId: "review-1",
    designRef,
    status: "fresh",
    generatedAt: "2026-05-11T00:00:00.000Z",
    sources: { reviewRunId: "review-1", designRef, aggregate: { path: "aggregate.json", checksum: "sha" }, reviewerResults: [] },
    findings: [],
    clusters: [{ clusterId: "cluster-1", triageLevel: "must-fix", sourceFindingIds: [], reviewerRoles: [], category: "product", severity: "blocking", requiresRevision: true, title: "Fix", description: "Fix", affectedSections: [], recommendations: [], userQuestions: [] }],
    conflicts: [],
    unresolvedQuestions: [{ questionId: "q-1", question: "Which scope trade-off should we choose?", blocking: true, sourceFindingIds: [], clusterIds: [], reviewerRoles: [], relatedSections: ["Scope"] }],
    coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "complete", hasIncompleteCoverage: false },
    readiness: { status: "blocked", sourceReadiness: { status: "blocked", blockingFindingIds: [], unresolvedUserQuestions: ["q-1"], summary: "Blocked" }, recommendedNextAction: "revise-design", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: ["q-1"], summary: "Blocked" },
    summary: "Blocked",
    ...overrides,
  };
}

test("question gate accepts actionable must-fix input with supplied blocking answer", () => {
  const result = evaluateUserQuestionGate(triage(), [{ questionId: "q-1", answer: "Choose smaller scope.", answeredBy: "user", answeredAt: "2026-05-11T00:00:00.000Z" }]);
  assert.equal(result.status, "ready");
});

test("question gate blocks missing user answers", () => {
  const result = evaluateUserQuestionGate(triage(), []);
  assert.equal(result.status, "needs-user-input");
  assert.deepEqual(result.status === "needs-user-input" ? result.missingQuestionIds : [], ["q-1"]);
});

test("question gate rejects unknown answer IDs", () => {
  const result = evaluateUserQuestionGate(triage(), [{ questionId: "unknown", answer: "x", answeredBy: "user", answeredAt: "2026-05-11T00:00:00.000Z" }]);
  assert.equal(result.status, "invalid-answers");
});

test("output validator rejects unknown IDs for no actionable validation inputs", () => {
  assert.throws(() => validateDesignRevisionOutput({ revisedDesignMarkdown: "# Design", changeSummary: [], resolvedItemIds: ["unknown"], unresolvedItemIds: [], assumptions: [], riskNotes: [] }, new Set(["cluster-1"])), /unknown id/);
});

test("round policy reports cumulative limit exhaustion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-revision-policy-"));
  const layout = await createWorkflowLayout(root, "demo-topic");
  const sourceDesignRef = await writeVersionedArtifact(layout, "design", "# Design");
  const record: DesignRevisionRecord = {
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    status: "committed",
    sourceDesignRef,
    targetDesignRef: sourceDesignRef,
    sourceReviewRunId: "review-1",
    sourceTriageRef: { path: "triage.json", checksum: "sha" },
    sourceReadinessRef: { path: "readiness.json", checksum: "sha" },
    postRevisionReviewRunId: "review-2",
    resolvedItemIds: [],
    unresolvedItemIds: [],
    changeSummary: [],
    completedAt: "2026-05-11T00:00:00.000Z",
  };
  await writeDesignRevisionRecord(layout, record);
  const result = await evaluateRevisionRoundPolicy(layout, { maxTotalRevisionRounds: 1, maxTotalPostRevisionReviewRounds: 3 });
  assert.equal(result.status, "revision-exhausted");
});
