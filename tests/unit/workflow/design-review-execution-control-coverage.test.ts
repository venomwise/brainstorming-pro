import test from "node:test";
import assert from "node:assert/strict";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";
import type { DesignReviewerResult } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import { assertCoverageConsistent, computeDesignReviewCoverage, createInitialDesignReviewCoverage } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts";

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };

function result(reviewerRole: DesignReviewerResult["reviewerRole"], status: DesignReviewerResult["status"]): DesignReviewerResult {
  return {
    reviewRunId: "run-1",
    reviewerRole,
    status,
    summary: status === "succeeded" ? "ok" : undefined,
    findings: [],
    error: status === "failed" ? { kind: "failed", message: "failed", retryable: true } : undefined,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
  };
}

test("creates initial coverage with selected and unselected semantics", () => {
  const coverage = createInitialDesignReviewCoverage(["testing-reviewer", "product-reviewer"]);
  assert.deepEqual(coverage.selectedReviewers, ["product-reviewer", "testing-reviewer"]);
  assert.deepEqual(coverage.unselectedReviewers, ["architecture-reviewer", "risk-security-reviewer", "scope-simplicity-reviewer"]);
  assert.deepEqual(coverage.succeededReviewers, []);
  assert.deepEqual(coverage.failedReviewers, []);
  assert.deepEqual(coverage.pendingRetryReviewers, []);
  assertCoverageConsistent(coverage);
});

test("computes success, failure, and pending retry from latest selected reviewer results", () => {
  const coverage = computeDesignReviewCoverage({
    selectedReviewerRoles: ["product-reviewer", "testing-reviewer"],
    reviewerResults: [result("product-reviewer", "succeeded"), result("testing-reviewer", "failed")],
  });
  assert.deepEqual(coverage.succeededReviewers, ["product-reviewer"]);
  assert.deepEqual(coverage.failedReviewers, ["testing-reviewer"]);
  assert.deepEqual(coverage.pendingRetryReviewers, ["testing-reviewer"]);
  assertCoverageConsistent(coverage);
});

test("supports retry updates by recomputing latest effective results", () => {
  const coverage = computeDesignReviewCoverage({
    selectedReviewerRoles: ["product-reviewer", "testing-reviewer"],
    reviewerResults: [result("product-reviewer", "succeeded"), result("testing-reviewer", "succeeded")],
  });
  assert.deepEqual(coverage.succeededReviewers, ["product-reviewer", "testing-reviewer"]);
  assert.deepEqual(coverage.failedReviewers, []);
  assert.deepEqual(coverage.pendingRetryReviewers, []);
});

test("rejects roles outside stable selected set", () => {
  assert.throws(
    () => computeDesignReviewCoverage({ selectedReviewerRoles: ["product-reviewer"], reviewerResults: [result("testing-reviewer", "failed")] }),
    /unselected reviewer role/,
  );
  assert.throws(
    () => assertCoverageConsistent({
      availableReviewers: ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
      selectedReviewers: ["product-reviewer"],
      unselectedReviewers: ["architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
      succeededReviewers: ["product-reviewer"],
      failedReviewers: ["testing-reviewer"],
      pendingRetryReviewers: [],
    }),
    /out-of-selection/,
  );
});
