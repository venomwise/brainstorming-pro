import test from "node:test";
import assert from "node:assert/strict";
import { validateDesignReviewerSelection } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-selection.ts";
import { assertCoverageConsistent } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/review-coverage.ts";
import { evaluateDesignApprovalReadiness } from "../../extensions/clarification-orchestrator/workflow/adapters/design-review/readiness.ts";
import type { ReviewDecisionRef, VersionedArtifactRef } from "../../extensions/clarification-orchestrator/workflow/types.ts";

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };

function decision(overrides: Partial<ReviewDecisionRef> = {}): ReviewDecisionRef {
  return { id: "decision-1", target: "design", mode: "full", artifacts: [designRef], selectedBy: "user", selectedAt: "now", path: ".workflow/decisions/design.json", ...overrides } as ReviewDecisionRef;
}

test("rejects spoofed design refs and non-package reviewer roles at selection boundary", () => {
  assert.throws(() => validateDesignReviewerSelection(decision({ selectedReviewerRoles: ["minimal-reviewer" as never] }), designRef), /minimal-reviewer/);
  assert.throws(() => validateDesignReviewerSelection(decision({ selectedReviewerRoles: ["evil-reviewer" as never] }), designRef), /Unknown/);
  assert.throws(() => validateDesignReviewerSelection(decision(), { ...designRef, checksum: "changed" }), /stale/);
});

test("fails closed when crafted coverage claims unselected reviewers succeeded", () => {
  assert.throws(() => assertCoverageConsistent({
    availableReviewers: ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
    selectedReviewers: ["product-reviewer"],
    unselectedReviewers: ["architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"],
    succeededReviewers: ["testing-reviewer"],
    failedReviewers: [],
    pendingRetryReviewers: [],
  }), /out-of-selection/);
});

test("crafted partial readiness without consistent coverage is not approval-ready", () => {
  const readiness = evaluateDesignApprovalReadiness({ status: "partial", findings: [] });
  assert.equal(readiness.status, "failed");
});
