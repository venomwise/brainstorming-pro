import test from "node:test";
import assert from "node:assert/strict";

import {
  rejectUnauthorizedRevisionDirectives,
  validateDesignRevisionAuthorization,
  validateDesignRevisionOutput,
  validateDesignRevisionRecord,
  validateDesignRevisionRequest,
} from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/schemas.ts";
import type { DesignRevisionAuthorization, DesignRevisionRequest } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-revision/types.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const designRef: VersionedArtifactRef = {
  kind: "design",
  version: 1,
  path: ".workflow/artifacts/design/v1.md",
  checksum: "sha256-design",
  createdAt: "2026-05-11T00:00:00.000Z",
};

function authorization(overrides: Partial<DesignRevisionAuthorization> = {}): DesignRevisionAuthorization {
  return {
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    allowedAction: "single-revision-and-rereview",
    sourceDesignRef: designRef,
    sourceReviewRunId: "review-1",
    sourceTriageRef: { path: ".workflow/reviews/design/review-1/triage-report.json", checksum: "sha256-triage" },
    sourceReadinessRef: { path: ".workflow/reviews/design/review-1/readiness.json", checksum: "sha256-readiness" },
    postRevisionReview: { mode: "full", selectedReviewerRoles: ["product-reviewer"] },
    roundPolicy: {
      maxTotalRevisionRounds: 3,
      maxTotalPostRevisionReviewRounds: 3,
      usedRevisionRounds: 0,
      usedPostRevisionReviewRounds: 0,
    },
    userAnswers: [{ questionId: "q-1", answer: "Use option A.", answeredBy: "user", answeredAt: "2026-05-11T00:01:00.000Z" }],
    authorizedBy: "user",
    authorizedAt: "2026-05-11T00:02:00.000Z",
    ...overrides,
  };
}

function request(overrides: Partial<DesignRevisionRequest> = {}): DesignRevisionRequest {
  const auth = authorization();
  return {
    revisionId: auth.revisionId,
    workflowRunId: auth.workflowRunId,
    topic: auth.topic,
    sourceDesignRef: designRef,
    sourceReviewRunId: auth.sourceReviewRunId,
    sourceTriageRef: auth.sourceTriageRef,
    sourceReadinessRef: auth.sourceReadinessRef,
    mustFixClusterIds: ["cluster-1"],
    shouldFixClusterIds: ["cluster-2"],
    conflictIds: ["conflict-1"],
    unresolvedQuestionIds: ["q-1"],
    carryForwardQuestionIds: ["q-2"],
    userAnswers: auth.userAnswers,
    roundPolicy: auth.roundPolicy,
    postRevisionReview: auth.postRevisionReview,
    triage: { summary: "Needs revision.", clusters: [], conflicts: [], unresolvedQuestions: [] },
    readiness: {
      status: "blocked",
      sourceReadiness: { status: "blocked", blockingFindingIds: ["finding-1"], unresolvedUserQuestions: ["q-1"], summary: "Blocked." },
      recommendedNextAction: "revise-design",
      blockingFindingIds: ["finding-1"],
      blockingConflictIds: ["conflict-1"],
      blockingQuestionIds: ["q-1"],
      summary: "Blocked.",
    },
    requestedAt: "2026-05-11T00:03:00.000Z",
    ...overrides,
  };
}

test("validates design revision authorization, request, output, and record", () => {
  assert.equal(validateDesignRevisionAuthorization(authorization()).allowedAction, "single-revision-and-rereview");
  assert.equal(validateDesignRevisionRequest(request()).mustFixClusterIds[0], "cluster-1");
  assert.deepEqual(validateDesignRevisionOutput({
    revisedDesignMarkdown: "# Design\n\n## Summary\nUpdated.",
    changeSummary: ["Updated summary"],
    resolvedItemIds: ["cluster-1"],
    unresolvedItemIds: ["q-2"],
    assumptions: ["Assumption"],
    riskNotes: ["Risk"],
  }, new Set(["cluster-1", "q-2"])).resolvedItemIds, ["cluster-1"]);
  assert.equal(validateDesignRevisionRecord({
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    status: "committed",
    sourceDesignRef: designRef,
    targetDesignRef: { ...designRef, version: 2, checksum: "sha256-design-2" },
    sourceReviewRunId: "review-1",
    sourceTriageRef: { path: "triage-report.json", checksum: "sha256-triage" },
    sourceReadinessRef: { path: "readiness.json", checksum: "sha256-readiness" },
    postRevisionReviewRunId: "review-2",
    resolvedItemIds: ["cluster-1"],
    unresolvedItemIds: [],
    changeSummary: ["Updated summary"],
    completedAt: "2026-05-11T00:04:00.000Z",
  }).status, "committed");
});

test("rejects consumed authorization", () => {
  assert.throws(() => validateDesignRevisionAuthorization(authorization({ consumedAt: "2026-05-11T00:05:00.000Z" })), /already been consumed/);
});

test("rejects unauthorized directives recursively", () => {
  assert.throws(() => rejectUnauthorizedRevisionDirectives({ nested: { approveDesign: true } }), /unauthorized directive: approveDesign/);
  assert.throws(() => validateDesignRevisionOutput({
    revisedDesignMarkdown: "# Design",
    changeSummary: [],
    resolvedItemIds: [],
    unresolvedItemIds: [],
    assumptions: [],
    riskNotes: [],
    statePatch: { phase: "planning" },
  }), /unauthorized directive: statePatch/);
});

test("rejects output item IDs unknown to validation inputs", () => {
  assert.throws(() => validateDesignRevisionOutput({
    revisedDesignMarkdown: "# Design",
    changeSummary: ["Updated"],
    resolvedItemIds: ["missing-cluster"],
    unresolvedItemIds: [],
    assumptions: [],
    riskNotes: [],
  }, new Set(["cluster-1"])), /unknown id: missing-cluster/);
});

test("rejects malformed status fields", () => {
  assert.throws(() => validateDesignRevisionRecord({
    revisionId: "rev-1",
    workflowRunId: "run-1",
    topic: "demo-topic",
    status: "started",
    sourceDesignRef: designRef,
    sourceReviewRunId: "review-1",
    sourceTriageRef: { path: "triage-report.json", checksum: "sha256-triage" },
    sourceReadinessRef: { path: "readiness.json", checksum: "sha256-readiness" },
    resolvedItemIds: [],
    unresolvedItemIds: [],
    changeSummary: [],
    completedAt: "2026-05-11T00:04:00.000Z",
  }), /record.status is invalid/);
});
