import test from "node:test";
import assert from "node:assert/strict";
import type { DesignReviewAggregateResult, DesignReviewCoverage, DesignReviewFinding, DesignReviewPanelResult, FullDesignReviewerRegistration } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/types.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };

test("design review persisted contracts carry exact design refs", () => {
  const finding: DesignReviewFinding = {
    id: "minimal-reviewer-001",
    reviewRunId: "run-1",
    designRef,
    reviewerRole: "minimal-reviewer",
    category: "architecture",
    severity: "blocking",
    title: "Missing flow",
    description: "The design does not explain runtime flow.",
    requiresRevision: true,
  };
  const result: DesignReviewPanelResult = {
    reviewRunId: "run-1",
    mode: "full",
    status: "unavailable",
    designRef,
    readiness: { status: "not-ready", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "Full unavailable." },
    ledgerPath: ".workflow/reviews/design/run-1",
    unavailableReason: "full-review-unavailable",
  };
  const registration: FullDesignReviewerRegistration = {
    role: "product-reviewer",
    promptBuilder: ({ designRef: ref }) => ({ prompt: ref.checksum, systemPrompt: "review" }),
  };
  assert.equal(finding.designRef.checksum, "abc");
  assert.equal(result.unavailableReason, "full-review-unavailable");
  assert.equal(registration.role, "product-reviewer");
});

test("partial review contracts carry coverage and incomplete readiness", () => {
  const coverage: DesignReviewCoverage = {
    availableReviewers: ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
    selectedReviewers: ["product-reviewer", "testing-reviewer"],
    unselectedReviewers: ["architecture-reviewer", "risk-security-reviewer", "scope-simplicity-reviewer"],
    succeededReviewers: ["product-reviewer"],
    failedReviewers: ["testing-reviewer"],
    pendingRetryReviewers: ["testing-reviewer"],
  };
  const aggregate: DesignReviewAggregateResult = {
    reviewRunId: "run-1",
    designRef,
    status: "partial",
    summary: "One reviewer succeeded and one failed.",
    counts: { blocking: 0, nonBlocking: 0, notes: 0, byCategory: {}, byReviewer: {} },
    findings: [],
    readiness: { status: "incomplete-review", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "Incomplete review can be retried or explicitly accepted." },
    coverage,
  };
  const encoded = JSON.parse(JSON.stringify(aggregate)) as DesignReviewAggregateResult;
  assert.equal(encoded.status, "partial");
  assert.equal(encoded.readiness.status, "incomplete-review");
  assert.deepEqual(encoded.coverage?.pendingRetryReviewers, ["testing-reviewer"]);
});
