import test from "node:test";
import assert from "node:assert/strict";
import { validateDesignReviewTriageReport, validateDesignReviewFindingCluster, validateDesignReviewReadinessReport } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-schemas.ts";

const designRef = {
  kind: "design",
  version: 1,
  path: ".workflow/artifacts/design/v1.md",
  checksum: "abc",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const sourceFinding = {
  id: "finding-1",
  reviewRunId: "review-run-1",
  designRef,
  reviewerRole: "product-reviewer",
  category: "product",
  severity: "blocking",
  title: "Missing goal",
  description: "The design omits a goal.",
  requiresRevision: true,
  userQuestion: "Should this cover onboarding?",
};

const triageReport = {
  reviewRunId: "review-run-1",
  designRef,
  status: "fresh",
  generatedAt: "2026-01-01T00:00:00.000Z",
  sources: {
    reviewRunId: "review-run-1",
    designRef,
    aggregate: { path: ".workflow/reviews/design/review-run-1/aggregated-findings.json", checksum: "agg" },
    coverage: { path: ".workflow/reviews/design/review-run-1/coverage.json", checksum: "cov" },
    reviewerResults: [{ reviewerRole: "product-reviewer", path: ".workflow/reviews/design/review-run-1/reviewer-results/product-reviewer.json", checksum: "rr", status: "succeeded" }],
    reviewDecisionRef: "decision-1",
  },
  findings: [sourceFinding],
  clusters: [
    {
      clusterId: "cluster-1",
      triageLevel: "must-fix",
      sourceFindingIds: ["finding-1"],
      reviewerRoles: ["product-reviewer"],
      category: "product",
      severity: "blocking",
      requiresRevision: true,
      title: "Missing goal",
      description: "The design omits a goal.",
      evidence: ["goal missing"],
      affectedSections: ["Goals"],
      recommendations: ["Add goal"],
      userQuestions: ["Should this cover onboarding?"],
    },
  ],
  conflicts: [],
  unresolvedQuestions: [
    {
      questionId: "question-1",
      question: "Should this cover onboarding?",
      blocking: true,
      sourceFindingIds: ["finding-1"],
      clusterIds: ["cluster-1"],
      reviewerRoles: ["product-reviewer"],
      relatedSections: ["Goals"],
    },
  ],
  coverage: {
    availableReviewers: ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
    selectedReviewers: ["product-reviewer"],
    unselectedReviewers: ["architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
    succeededReviewers: ["product-reviewer"],
    failedReviewers: [],
    pendingRetryReviewers: [],
    status: "complete",
    hasIncompleteCoverage: false,
  },
  readiness: {
    status: "blocked",
    sourceReadiness: { status: "blocked", blockingFindingIds: ["finding-1"], unresolvedUserQuestions: ["Should this cover onboarding?"], summary: "blocked" },
    recommendedNextAction: "revise-design",
    blockingFindingIds: ["finding-1"],
    blockingConflictIds: [],
    blockingQuestionIds: ["question-1"],
    summary: "blocked",
  },
  summary: "1 must-fix finding and 1 blocking question.",
};

test("triage report schema accepts a valid report", () => {
  const parsed = validateDesignReviewTriageReport(triageReport);
  assert.equal(parsed.status, "fresh");
  assert.equal(parsed.clusters[0].triageLevel, "must-fix");
  assert.equal(parsed.readiness.recommendedNextAction, "revise-design");
});

test("triage report schema rejects invalid cluster source ids", () => {
  assert.throws(() => validateDesignReviewTriageReport({ ...triageReport, clusters: [{ ...triageReport.clusters[0], sourceFindingIds: ["missing-finding"] }] }), /unknown finding id/u);
});

test("triage report schema rejects invalid readiness actions", () => {
  assert.throws(() => validateDesignReviewReadinessReport({ ...triageReport.readiness, recommendedNextAction: "approve-now" }), /recommendedNextAction/u);
});

test("triage report schema rejects unauthorized authority fields", () => {
  assert.throws(() => validateDesignReviewTriageReport({ ...triageReport, approval: true }), /unauthorized directive/u);
  assert.throws(() => validateDesignReviewTriageReport({ ...triageReport, readiness: { ...triageReport.readiness, approveDesign: true } }), /unauthorized directive/u);
  assert.throws(() => validateDesignReviewTriageReport({ ...triageReport, clusters: [{ ...triageReport.clusters[0], workflowState: { phase: "planning" } }] }), /unauthorized directive/u);
});
