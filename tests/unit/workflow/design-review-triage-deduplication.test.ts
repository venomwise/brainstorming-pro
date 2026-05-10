import test from "node:test";
import assert from "node:assert/strict";
import { clusterDesignReviewFindings } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-deduplication.ts";

const baseFinding = {
  id: "f-1",
  reviewRunId: "run-1",
  designRef: { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" },
  reviewerRole: "product-reviewer",
  category: "product",
  severity: "blocking",
  title: "Missing goal",
  description: "The design omits a goal.",
  requiresRevision: true,
} as const;

test("clusters duplicate findings deterministically", () => {
  const clusters = clusterDesignReviewFindings([baseFinding, { ...baseFinding, id: "f-2", reviewerRole: "architecture-reviewer" } as const]);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].sourceFindingIds, ["f-1", "f-2"]);
  assert.equal(clusters[0].triageLevel, "must-fix");
});

test("keeps ambiguous findings separate", () => {
  const clusters = clusterDesignReviewFindings([baseFinding, { ...baseFinding, id: "f-2", title: "Different issue" } as const]);
  assert.equal(clusters.length, 2);
});
