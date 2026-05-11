import test from "node:test";
import assert from "node:assert/strict";

import { applyPostRevisionReviewResultToState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowState, VersionedArtifactRef } from "../../extensions/clarification-orchestrator/workflow/types.ts";
import type { DesignRevisionRecord } from "../../extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts";
import type { DesignReviewPanelResult } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";

const sourceRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "old", createdAt: "2026-05-11T00:00:00.000Z" };
const revisedRef: VersionedArtifactRef = { kind: "design", version: 2, path: ".workflow/artifacts/design/v2.md", checksum: "new", createdAt: "2026-05-11T00:01:00.000Z" };

function state(): WorkflowState {
  return { version: 1, runId: "run-1", topic: "demo-topic", request: "demo", phase: "design-review", createdAt: "t", updatedAt: "t", artifacts: { design: sourceRef }, reviewDecisions: {}, reviewStatus: {}, gates: {} };
}

function record(): DesignRevisionRecord {
  return { revisionId: "rev-1", workflowRunId: "run-1", topic: "demo-topic", status: "committed", sourceDesignRef: sourceRef, targetDesignRef: revisedRef, sourceReviewRunId: "review-1", sourceTriageRef: { path: "triage.json", checksum: "sha" }, sourceReadinessRef: { path: "readiness.json", checksum: "sha" }, postRevisionReviewRunId: "review-2", resolvedItemIds: ["cluster-1"], unresolvedItemIds: [], changeSummary: ["fixed"], completedAt: "2026-05-11T00:01:00.000Z" };
}

function panel(status: DesignReviewPanelResult["status"]): DesignReviewPanelResult {
  return { reviewRunId: "review-2", mode: "full", status, designRef: revisedRef, readiness: { status: status === "passed" ? "ready-for-user-approval" : "blocked", blockingFindingIds: status === "passed" ? [] : ["finding-1"], unresolvedUserQuestions: [], summary: status }, ledgerPath: ".workflow/reviews/design/review-2", triageSummary: status };
}

test("passed post-revision review stops at design approval gate", () => {
  const next = applyPostRevisionReviewResultToState(state(), panel("passed"), record());
  assert.equal(next.phase, "awaiting-design-approval");
  assert.equal(next.gates.design, undefined);
  assert.equal(next.artifacts.design?.checksum, "new");
});

test("blocked post-revision review pauses without automatic another revision", () => {
  const next = applyPostRevisionReviewResultToState(state(), panel("blocked"), record());
  assert.equal(next.phase, "blocked");
  assert.equal(next.reviewStatus.design?.revisionHandoff?.postRevisionReviewRunId, "review-2");
  assert.ok(next.lastError?.recoverable);
});

test("latest design requires new authorization for another revision", () => {
  const next = applyPostRevisionReviewResultToState(state(), panel("blocked"), record());
  assert.equal(next.reviewStatus.design?.revisionHandoff?.revisedDesignRef.version, 2);
  assert.notEqual(next.reviewStatus.design?.revisionHandoff?.revisedDesignRef.checksum, record().sourceDesignRef.checksum);
});
