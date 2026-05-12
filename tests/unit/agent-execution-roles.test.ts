import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_ROLE_DEFINITIONS, validateRoleForPhase } from "../../extensions/clarification-orchestrator/runtime/agent-execution/roles.ts";
import type { AgentRole } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const expectedRoles: AgentRole[] = [
  "design-author",
  "design-reviser",
  "plan-author",
  "task-executor",
  "minimal-reviewer",
  "product-reviewer",
  "architecture-reviewer",
  "risk-security-reviewer",
  "testing-reviewer",
  "scope-simplicity-reviewer",
  "requirements-coverage-reviewer",
  "task-coverage-reviewer",
  "dependency-order-reviewer",
  "plan-reviser",
];

test("agent role registry defines workflow roles with no skills and no session", () => {
  assert.deepEqual(Object.keys(AGENT_ROLE_DEFINITIONS).sort(), [...expectedRoles].sort());

  for (const role of expectedRoles) {
    const definition = AGENT_ROLE_DEFINITIONS[role];
    assert.equal(definition.role, role);
    assert.equal(definition.allowSkills, false);
    assert.equal(definition.allowSession, false);
    assert.ok(definition.allowedPhases.length > 0);
    assert.ok(definition.timeoutMs > 0);
    assert.ok(definition.maxStdoutBytes > 0);
    assert.ok(definition.maxStderrBytes > 0);
    assert.ok(definition.maxOutputBytes > 0);
    assert.ok(definition.maxRetries >= 0);
  }
});

test("validateRoleForPhase accepts roles only in their allowed workflow phases", () => {
  assert.equal(validateRoleForPhase("design-author", "designing").ok, true);
  assert.equal(validateRoleForPhase("plan-author", "planning").ok, true);
  assert.equal(validateRoleForPhase("task-executor", "executing").ok, true);
  assert.equal(validateRoleForPhase("minimal-reviewer", "design-review").ok, true);
  assert.equal(validateRoleForPhase("minimal-reviewer", "plan-review").ok, true);
  assert.equal(validateRoleForPhase("minimal-reviewer", "execution-review").ok, true);
  assert.equal(validateRoleForPhase("product-reviewer", "design-review").ok, true);
  assert.equal(validateRoleForPhase("architecture-reviewer", "design-review").ok, true);
  assert.equal(validateRoleForPhase("risk-security-reviewer", "design-review").ok, true);
  assert.equal(validateRoleForPhase("testing-reviewer", "design-review").ok, true);
  assert.equal(validateRoleForPhase("scope-simplicity-reviewer", "design-review").ok, true);
  assert.equal(validateRoleForPhase("requirements-coverage-reviewer", "plan-review").ok, true);
  assert.equal(validateRoleForPhase("task-coverage-reviewer", "plan-review").ok, true);
  assert.equal(validateRoleForPhase("dependency-order-reviewer", "plan-review").ok, true);
  assert.equal(validateRoleForPhase("plan-reviser", "plan-review").ok, true);

  const fullReviewerMismatch = validateRoleForPhase("product-reviewer", "planning");
  assert.equal(fullReviewerMismatch.ok, false);

  const mismatch = validateRoleForPhase("plan-author", "awaiting-design-approval");
  assert.equal(mismatch.ok, false);
  if (!mismatch.ok) {
    assert.equal(mismatch.error.kind, "role-not-allowed");
    assert.match(mismatch.error.message, /not allowed/u);
  }
});

test("validateRoleForPhase rejects unknown roles before spawn dependencies are needed", () => {
  const result = validateRoleForPhase("subagent" as AgentRole, "designing");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.kind, "role-not-allowed");
    assert.match(result.error.message, /Unknown agent role/u);
  }
});
