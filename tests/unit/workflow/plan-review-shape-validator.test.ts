import assert from "node:assert/strict";
import test from "node:test";
import { validatePlanShape } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/shape-validator.ts";
import type { PlanReviewArtifactBinding } from "../../../extensions/clarification-orchestrator/workflow/adapters/plan-review/types.ts";

const ref = { kind: "design" as const, version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "x", createdAt: "2026-01-01T00:00:00.000Z" };
const binding: PlanReviewArtifactBinding = { design: ref, approvedDesignRef: ref, requirements: { ...ref, kind: "requirements", path: ".workflow/artifacts/requirements/v1.md" }, tasks: { ...ref, kind: "tasks", path: ".workflow/artifacts/tasks/v1.md" }, createdAt: ref.createdAt };
const requirements = `# Requirements\n\n## Requirements\n\n### Requirement 1: Feature\n\n#### Acceptance Criteria\n\n1. WHEN the user runs it THEN the system SHALL work.\n`;
const tasks = `# Tasks\n\n## Tasks\n\n- [ ] 1. Phase\n  - [ ] 1.1 Implement feature\n    - _Requirements: 1.1_\n- [ ] 2. Checkpoint - Verify\n  - _Requirements: 1.1_\n`;

test("validatePlanShape accepts requirements and parseable tasks", () => {
  const result = validatePlanShape({ requirementsContent: requirements, tasksContent: tasks, binding });
  assert.equal(result.ok, true);
  assert.equal(result.findings.length, 0);
});

test("validatePlanShape emits plan-level finding for missing requirements structure", () => {
  const result = validatePlanShape({ requirementsContent: "# Requirements", tasksContent: tasks, binding });
  assert.equal(result.ok, true);
  assert.equal(result.findings[0].category, "requirements-coverage");
});

test("validatePlanShape fails closed for missing tasks section", () => {
  const result = validatePlanShape({ requirementsContent: requirements, tasksContent: "# Tasks", binding });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.diagnostics[0], /missing/i);
});

test("validatePlanShape reports malformed checkbox marker and missing requirement refs", () => {
  const malformedTasks = `# Tasks\n\n## Tasks\n\n- [todo] 1. Bad marker\n- [ ] 2. Verify scope\n`;
  const result = validatePlanShape({ requirementsContent: requirements, tasksContent: malformedTasks, binding });
  assert.equal(result.ok, true);
  assert.ok(result.findings.some((finding) => finding.title.includes("invalid-checkbox-marker")));
  assert.ok(result.findings.some((finding) => finding.title.includes("missing-executable-requirements")));
});

test("validatePlanShape fails closed for severe malformed task hierarchy", () => {
  const malformedTasks = `# Tasks\n\n## Tasks\n\n  - [ ] 1.1 Orphan task\n    - _Requirements: 1.1_\n`;
  const result = validatePlanShape({ requirementsContent: requirements, tasksContent: malformedTasks, binding });
  assert.equal(result.ok, false);
});
