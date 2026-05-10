import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_ROLE_DEFINITIONS } from "../../../extensions/clarification-orchestrator/runtime/agent-execution/roles.ts";
import { resolveFullDesignReviewerSet, getFullDesignReviewerDefinition, assertFullDesignReviewerPackComplete, FULL_DESIGN_REVIEWER_ORDER } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts";
import type { FullDesignReviewerRole } from "../../../extensions/clarification-orchestrator/workflow/adapters/design-review/full-reviewer-registry.ts";

const expectedRoles: FullDesignReviewerRole[] = [
  "product-reviewer",
  "architecture-reviewer",
  "risk-security-reviewer",
  "testing-reviewer",
  "scope-simplicity-reviewer",
];

test("full reviewer roles are registered in agent execution and restricted to design-review", () => {
  assert.deepEqual(Object.keys(AGENT_ROLE_DEFINITIONS).filter((role) => expectedRoles.includes(role as FullDesignReviewerRole)).sort(), [...expectedRoles].sort());
  for (const role of expectedRoles) {
    const definition = AGENT_ROLE_DEFINITIONS[role];
    assert.equal(definition.role, role);
    assert.deepEqual(definition.allowedPhases, ["design-review"]);
    assert.equal(definition.expectedResultKind, "review-findings");
    assert.equal(definition.allowSkills, false);
    assert.equal(definition.allowSession, false);
  }
});

test("full reviewer registry resolves all five roles in deterministic order", () => {
  assert.deepEqual(FULL_DESIGN_REVIEWER_ORDER, expectedRoles);
  const resolved = resolveFullDesignReviewerSet();
  assert.deepEqual(resolved.map((entry) => entry.role), expectedRoles);
  for (const role of expectedRoles) {
    const definition = getFullDesignReviewerDefinition(role);
    assert.equal(definition.role, role);
    assert.ok(definition.displayName.length > 0);
    assert.ok(definition.buildPrompt({ topic: "topic", designRef: { kind: "design", version: 1, path: "a", checksum: "b", createdAt: "2026-01-01T00:00:00.000Z" }, designContent: "# design" }).includes("Exact design artifact metadata"));
    assert.ok(definition.buildSystemPrompt().includes("structured JSON findings only"));
  }
});

test("full reviewer registry rejects unknown and duplicate selected roles", () => {
  assert.throws(() => getFullDesignReviewerDefinition("unknown" as FullDesignReviewerRole), /Unknown full design reviewer role/u);
  assert.throws(() => resolveFullDesignReviewerSet(["product-reviewer", "product-reviewer"]), /Duplicate full design reviewer role selected/u);
  assert.throws(() => resolveFullDesignReviewerSet(["product-reviewer", "unknown" as FullDesignReviewerRole]), /Unknown full design reviewer role/u);
});

test("full reviewer pack completeness validation passes when all roles are present", () => {
  assert.doesNotThrow(() => assertFullDesignReviewerPackComplete());
});
