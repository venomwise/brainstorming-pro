import test from "node:test";
import assert from "node:assert/strict";
import { classifyDesignReviewClusters } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-classification.ts";

const cluster = {
  clusterId: "cluster-1",
  triageLevel: "note",
  sourceFindingIds: ["f-1"],
  reviewerRoles: ["product-reviewer"],
  category: "product",
  severity: "blocking",
  requiresRevision: true,
  title: "Missing goal",
  description: "Missing goal.",
  affectedSections: [],
  recommendations: [],
  userQuestions: [],
};

test("classifies blocking cluster as must-fix", () => {
  const classified = classifyDesignReviewClusters([cluster as never]);
  assert.equal(classified[0].triageLevel, "must-fix");
});
