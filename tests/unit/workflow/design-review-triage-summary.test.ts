import test from "node:test";
import assert from "node:assert/strict";
import { buildDesignReviewUserFacingSummary } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/triage-summary.ts";

test("summary mentions counts and avoids approval implication when blocked", () => {
  const summary = buildDesignReviewUserFacingSummary({
    clusters: [{ triageLevel: "must-fix" }, { triageLevel: "should-fix" }, { triageLevel: "note" }] as never,
    conflicts: [{ impact: "blocking-approval-readiness" }] as never,
    unresolvedQuestions: [{ blocking: true }] as never,
    coverage: { hasIncompleteCoverage: true, failedReviewers: ["testing-reviewer"], succeededReviewers: ["product-reviewer"] } as never,
    readiness: { status: "blocked" } as never,
  });
  assert.match(summary, /1 must-fix, 1 should-fix, 1 note/u);
  assert.match(summary, /Not approval-ready/u);
  assert.doesNotMatch(summary, /approved/u);
});
