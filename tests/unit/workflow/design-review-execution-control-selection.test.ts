import test from "node:test";
import assert from "node:assert/strict";
import type { ReviewDecisionRef, VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";
import { resolveDesignReviewerSelection, validateDesignReviewerSelection } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/reviewer-selection.ts";

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };

function decision(overrides: Partial<ReviewDecisionRef> = {}): ReviewDecisionRef {
  return {
    id: "design-review-decision",
    target: "design",
    mode: "full",
    artifacts: [designRef],
    selectedBy: "tester",
    selectedAt: "2026-01-01T00:00:00.000Z",
    path: ".workflow/decisions/design-review-decision.json",
    ...overrides,
  } as ReviewDecisionRef;
}

test("defaults omitted full reviewer selection to all five reviewers", () => {
  const selection = resolveDesignReviewerSelection(decision(), designRef);
  assert.deepEqual(selection.selectedReviewerRoles, ["product-reviewer", "architecture-reviewer", "risk-security-reviewer", "testing-reviewer", "scope-simplicity-reviewer"]);
  assert.deepEqual(selection.unselectedReviewerRoles, []);
});

test("resolves explicit reviewer subset with deterministic selected and unselected ordering", () => {
  const selection = resolveDesignReviewerSelection(decision({ selectedReviewerRoles: ["testing-reviewer", "product-reviewer"] }), designRef);
  assert.deepEqual(selection.selectedReviewerRoles, ["product-reviewer", "testing-reviewer"]);
  assert.deepEqual(selection.unselectedReviewerRoles, ["architecture-reviewer", "risk-security-reviewer", "scope-simplicity-reviewer"]);
});

test("rejects empty, duplicate, unknown, and minimal reviewer selections", () => {
  assert.throws(() => validateDesignReviewerSelection(decision({ selectedReviewerRoles: [] }), designRef), /At least one/);
  assert.throws(() => validateDesignReviewerSelection(decision({ selectedReviewerRoles: ["product-reviewer", "product-reviewer"] }), designRef), /Duplicate/);
  assert.throws(() => validateDesignReviewerSelection(decision({ selectedReviewerRoles: ["unknown-reviewer" as never] }), designRef), /Unknown/);
  assert.throws(() => validateDesignReviewerSelection(decision({ selectedReviewerRoles: ["minimal-reviewer" as never] }), designRef), /minimal-reviewer/);
});

test("rejects stale design artifact selection semantics", () => {
  const changedDesignRef = { ...designRef, checksum: "changed" };
  assert.throws(() => validateDesignReviewerSelection(decision(), changedDesignRef), /stale/);
});

test("rejects non-full or non-design selection usage", () => {
  assert.throws(() => validateDesignReviewerSelection(decision({ mode: "minimal" }), designRef), /only valid for full design review/);
  assert.throws(() => validateDesignReviewerSelection(decision({ target: "plan" }), designRef), /only valid for full design review/);
});
