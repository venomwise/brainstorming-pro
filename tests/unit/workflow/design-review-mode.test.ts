import test from "node:test";
import assert from "node:assert/strict";
import { assertSupportedDesignReviewMode, resolveDesignReviewMode } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/mode.ts";
import type { ReviewDecisionRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

const decision: ReviewDecisionRef = { id: "design-1", target: "design", mode: "minimal", artifacts: [], selectedBy: "u", selectedAt: "now", path: ".workflow/decisions/design.json" };

test("resolves skip minimal and full without fallback", () => {
  assert.equal(assertSupportedDesignReviewMode("skip"), "skip");
  assert.equal(resolveDesignReviewMode(decision), "minimal");
  assert.equal(resolveDesignReviewMode({ ...decision, mode: "full" }), "full");
});

test("rejects invalid modes and non-design targets", () => {
  assert.throws(() => assertSupportedDesignReviewMode("automatic"), /Unsupported design review mode/);
  assert.throws(() => resolveDesignReviewMode({ ...decision, target: "plan" }), /target must be design/);
});
