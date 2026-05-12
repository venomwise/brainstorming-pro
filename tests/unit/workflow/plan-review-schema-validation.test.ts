import assert from "node:assert/strict";
import test from "node:test";
import { planReviewerOutputSchema, validatePlanRevisionAgentOutput } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/schemas.ts";

const validFinding = {
  severity: "blocking",
  category: "requirements-coverage",
  title: "Missing requirement for approved constraint",
  description: "The approved design includes a constraint that is not represented in requirements.md.",
  affectedArtifacts: ["design", "requirements"],
  affectedSections: ["Design constraints", "Requirements"],
  recommendation: "Add a requirement that captures the approved constraint.",
  requiresPlanRevision: true,
  requiresDesignRevision: false,
  evidence: "Design says the workflow must fail closed.",
};

test("plan reviewer schema accepts valid findings", () => {
  const output = planReviewerOutputSchema.validate({ summary: "Review complete.", confidence: "high", findings: [validFinding] });
  assert.equal(output.findings.length, 1);
  assert.deepEqual(output.findings[0].affectedArtifacts, ["design", "requirements"]);
});

test("plan reviewer schema rejects approval, execution, and state directives", () => {
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "Approve the plan", confidence: "high", findings: [] }), /unauthorized/u);
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [], workflowState: { phase: "executing" } }), /unauthorized directive/u);
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ ...validFinding, description: "start execution now" }] }), /unauthorized/u);
});

test("plan reviewer schema rejects unsupported artifacts and missing blocking recommendations", () => {
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ ...validFinding, affectedArtifacts: ["source"] }] }), /unsupported artifact/u);
  assert.throws(() => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ ...validFinding, recommendation: undefined }] }), /blocking findings/u);
});

test("plan reviewer schema rejects findings that mix design and automatic plan revision", () => {
  assert.throws(
    () => planReviewerOutputSchema.validate({ summary: "x", confidence: "high", findings: [{ ...validFinding, requiresDesignRevision: true, requiresPlanRevision: true }] }),
    /prevents automatic plan revision/u,
  );
});

test("plan reviser output validation accepts revised requirements and tasks", () => {
  const output = validatePlanRevisionAgentOutput({
    status: "revised",
    revisedRequirements: "# Requirements\n\n## Requirements\n\n### Requirement 1: X\n\n#### Acceptance Criteria\n\n1. WHEN x THEN y.",
    revisedTasks: "# Tasks\n\n## Tasks\n\n- [ ] 1. Phase\n  - [ ] 1.1 Task\n    - _Requirements: 1.1_",
    addressedFindingIds: ["finding-1"],
    unresolvedFindingIds: [],
    summary: "Revised plan artifacts.",
    requiresDesignRevision: false,
  });
  assert.equal(output.status, "revised");
});

test("plan reviser output validation rejects design blockers, missing revised artifacts, and progress mutation", () => {
  const base = { addressedFindingIds: [], unresolvedFindingIds: [], summary: "x", requiresDesignRevision: false };
  assert.throws(() => validatePlanRevisionAgentOutput({ status: "revised", revisedRequirements: "x", ...base }), /requires both/u);
  assert.throws(() => validatePlanRevisionAgentOutput({ status: "revised", revisedRequirements: "x", revisedTasks: "y", ...base, requiresDesignRevision: true }), /prevents automatic/u);
  assert.throws(() => validatePlanRevisionAgentOutput({ status: "revised", revisedRequirements: "x", revisedTasks: "- [✅] 1. Done", ...base }), /must not mark task execution/u);
  assert.throws(() => validatePlanRevisionAgentOutput({ status: "blocked", ...base, approval: true }), /unauthorized directive/u);
});
