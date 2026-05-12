import assert from "node:assert/strict";
import test from "node:test";
import { planReviewerOutputSchema } from "../../extensions/clarification-orchestrator/workflow/adapters/plan-review/schemas.ts";

test("plan reviewer output cannot forge approvals or execution", () => {
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], gateDecision: "approve" }), /unauthorized/u);
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], commands: ["run"] }), /unauthorized/u);
});
