import test from "node:test";
import assert from "node:assert/strict";
import { clusterDesignReviewFindings } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-deduplication.ts";
import { detectDesignReviewConflicts } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-conflicts.ts";

const designRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-01-01T00:00:00.000Z" };
const findings = [
  { id: "f-1", reviewRunId: "run-1", designRef, reviewerRole: "product-reviewer", category: "product", severity: "blocking", title: "Scope up", description: "Expand scope", recommendation: "Increase scope", requiresRevision: true },
  { id: "f-2", reviewRunId: "run-1", designRef, reviewerRole: "architecture-reviewer", category: "architecture", severity: "non-blocking", title: "Scope down", description: "Trim scope", recommendation: "Narrow scope", requiresRevision: false },
] as const;

test("detects recommendation and scope conflicts", () => {
  const clusters = clusterDesignReviewFindings(findings as never);
  const conflicts = detectDesignReviewConflicts(clusters, findings as never);
  assert.ok(conflicts.some((conflict) => conflict.type === "recommendation-conflict"));
  assert.ok(conflicts.some((conflict) => conflict.type === "scope-disagreement"));
  assert.ok(conflicts.some((conflict) => conflict.impact === "blocking-approval-readiness"));
});
