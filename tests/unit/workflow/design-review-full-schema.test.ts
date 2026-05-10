import assert from "node:assert/strict";
import test from "node:test";
import { designReviewerOutputSchema } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/schemas.ts";

const validFinding = {
  category: "product",
  severity: "blocking",
  title: "Missing success criteria",
  description: "The design omits measurable outcomes.",
  evidence: "Goals are descriptive only.",
  affectedSections: ["Goals"],
  recommendation: "Add success criteria.",
  requiresRevision: true,
};

test("shared full reviewer schema accepts valid structured output", () => {
  const output = designReviewerOutputSchema.validate({ summary: "Review complete.", confidence: "high", findings: [validFinding] });
  assert.equal(output.summary, "Review complete.");
  assert.equal(output.confidence, "high");
  assert.equal(output.findings.length, 1);
});

test("shared full reviewer schema rejects malformed output shapes", () => {
  assert.throws(() => designReviewerOutputSchema.parse("not-json"), /Unexpected token/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "", confidence: "high", findings: [] }), /summary/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "certain", findings: [] }), /confidence/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: {} }), /findings must be an array/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ ...validFinding, severity: "critical" }] }), /severity/u);
});

test("shared full reviewer schema rejects unauthorized lifecycle mutation fields", () => {
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], approval: true }), /unauthorized directive/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], workflowState: { phase: "approved" } }), /unauthorized directive/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], gateDecision: "skip" }), /unauthorized directive/u);
  assert.throws(() => designReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ ...validFinding, artifactCommit: true }] }), /unauthorized directive/u);
});

test("shared full reviewer schema does not trust canonical finding fields from reviewers", () => {
  const output = designReviewerOutputSchema.validate({
    summary: "x",
    confidence: "medium",
    id: "fake-id",
    reviewRunId: "fake-run",
    designRef: { checksum: "fake" },
    reviewerRole: "fake-role",
    findings: [{ ...validFinding, id: "fake-finding", reviewRunId: "fake-run", reviewerRole: "fake-role", designRef: { checksum: "fake" } }],
  });
  assert.deepEqual(Object.keys(output).sort(), ["confidence", "findings", "summary"]);
  assert.equal("id" in output.findings[0], false);
  assert.equal("reviewRunId" in output.findings[0], false);
  assert.equal("designRef" in output.findings[0], false);
  assert.equal("reviewerRole" in output.findings[0], false);
});
