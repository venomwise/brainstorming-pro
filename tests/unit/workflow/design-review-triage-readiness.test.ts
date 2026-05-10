import test from "node:test";
import assert from "node:assert/strict";
import { buildDesignReviewReadinessReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-readiness.ts";

const sourceReady = { status: "ready-for-user-approval" as const, blockingFindingIds: [], unresolvedUserQuestions: [], summary: "ready" };
const mustFixCluster = { clusterId: "cluster-1", triageLevel: "must-fix", sourceFindingIds: ["f-1"], reviewerRoles: ["product-reviewer"], category: "product", severity: "blocking", requiresRevision: true, title: "Missing", description: "Missing", affectedSections: [], recommendations: [], userQuestions: [] } as const;

test("must-fix blocks readiness", () => {
  const readiness = buildDesignReviewReadinessReport({ sourceReadiness: sourceReady, clusters: [mustFixCluster as never], conflicts: [], unresolvedQuestions: [] });
  assert.equal(readiness.status, "blocked");
  assert.equal(readiness.recommendedNextAction, "revise-design");
});

test("incomplete without blockers stays incomplete", () => {
  const readiness = buildDesignReviewReadinessReport({ sourceReadiness: { ...sourceReady, status: "incomplete-review" }, clusters: [], conflicts: [], unresolvedQuestions: [] });
  assert.equal(readiness.status, "incomplete-review");
  assert.equal(readiness.recommendedNextAction, "accept-incomplete-or-retry");
});

test("passed without blockers is ready for explicit approval only", () => {
  const readiness = buildDesignReviewReadinessReport({ sourceReadiness: sourceReady, clusters: [], conflicts: [], unresolvedQuestions: [] });
  assert.equal(readiness.status, "ready-for-user-approval");
  assert.match(readiness.summary, /not approval/u);
});
