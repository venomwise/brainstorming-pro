import test from "node:test";
import assert from "node:assert/strict";
import { assignStableIssueIds, canonicalizeIssues, validateIssueReferences } from "../../extensions/clarification-orchestrator/issues.ts";
import type { DesignIssue } from "../../extensions/clarification-orchestrator/types.ts";

function issue(overrides: Partial<DesignIssue> = {}): DesignIssue {
  return {
    id: overrides.id ?? "local-1",
    title: overrides.title ?? "Missing state",
    description: overrides.description ?? "State is not persisted.",
    category: overrides.category ?? "architecture",
    severity: overrides.severity ?? "P1",
    confidence: overrides.confidence ?? "high",
    evidence: overrides.evidence ?? [{ type: "design-section", section: "Artifact Store", quote: "state.json" }],
    riskIfIgnored: overrides.riskIfIgnored ?? "Resume fails.",
    suggestedChange: overrides.suggestedChange ?? "Persist state.",
    estimatedCost: overrides.estimatedCost ?? "medium",
    recommendation: overrides.recommendation ?? "should-fix-now",
    tradeoffs: overrides.tradeoffs ?? { pros: [], cons: [] },
    ...overrides,
  };
}

test("assignStableIssueIds preserves source ids", () => {
  const [result] = assignStableIssueIds([issue({ id: "reviewer-1", sourceIssueIds: ["source-a"] })], 1);
  assert.equal(result.id, "BP-R1-I001");
  assert.deepEqual(result.sourceIssueIds, ["reviewer-1", "source-a"]);
});

test("canonicalizeIssues removes exact duplicates", () => {
  const result = canonicalizeIssues([issue(), issue()], 2);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "BP-R2-I001");
});

test("validateIssueReferences detects missing dependencies", () => {
  const problems = validateIssueReferences([issue({ id: "BP-R1-I001", dependsOn: ["missing"] })]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /dependsOn/);
});

test("validateIssueReferences detects invalid P0 recommendation", () => {
  const problems = validateIssueReferences([issue({ id: "BP-R1-I001", severity: "P0", recommendation: "should-fix-now" })]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /P0/);
});
