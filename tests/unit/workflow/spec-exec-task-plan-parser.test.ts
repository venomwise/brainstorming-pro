import test from "node:test";
import assert from "node:assert/strict";
import { isCheckpointTitle, parseTaskPlan } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts";

test("parses tasks section with phases, sub-tasks, optional markers, inheritance, requirements, and descriptions", () => {
  const plan = parseTaskPlan(`# Title\n\n## Tasks\n\n- [ ] 1. Phase 1: Build\n  - [ ] 1.1 Implement parser\n    - Description line\n    - _Requirements: 1.1, 1.2_\n  - [ ]* 1.2 Optional docs\n    - _Requirements: 2.1_\n- [ ]* 2. Optional Phase\n  - [ ] 2.1 Optional inherited child\n    - _Requirements: 3.1_\n- [✅] 3. Checkpoint - Verify scope\n  - _Requirements: 4.1_\n\n## Notes\nignored\n`);

  assert.deepEqual(plan.malformed, []);
  assert.equal(plan.tasksSectionStartLine, 3);
  assert.equal(plan.tasksSectionEndLine, 16);
  assert.equal(plan.completedCount, 1);
  assert.equal(plan.optionalCount, 3);

  const task = plan.tasks.find((entry) => entry.id === "1.1");
  assert.ok(task);
  assert.equal(task.kind, "task");
  assert.equal(task.parentId, "1");
  assert.deepEqual(task.requirementIds, ["1.1", "1.2"]);
  assert.deepEqual(task.descriptionLines, ["    - Description line", "    - _Requirements: 1.1, 1.2_"]);

  const optionalChild = plan.tasks.find((entry) => entry.id === "2.1");
  assert.ok(optionalChild);
  assert.equal(optionalChild.optional, true);
  assert.equal(optionalChild.optionalInherited, true);

  const checkpoint = plan.tasks.find((entry) => entry.id === "3");
  assert.ok(checkpoint);
  assert.equal(checkpoint.kind, "checkpoint");
  assert.equal(checkpoint.completed, true);
});

test("recognizes checkpoint and verification titles", () => {
  assert.equal(isCheckpointTitle("Checkpoint - Verify scope"), true);
  assert.equal(isCheckpointTitle("检查点 - 验证范围"), true);
  assert.equal(isCheckpointTitle("Implement feature"), false);
});

test("returns malformed entries for missing section and unsafe structures", () => {
  const missing = parseTaskPlan("# No tasks");
  assert.equal(missing.malformed[0]?.reason, "missing-tasks-section");

  const malformed = parseTaskPlan(`## Tasks\n- [maybe] 1. Bad marker\n- [ ] 1. No requirements leaf\n- [ ] 3.1 Missing parent\n  - [ ] 2.1 Bad parent numbering\n    - _Requirements: 1.1_\n`);
  assert.ok(malformed.malformed.some((entry) => entry.reason === "invalid-checkbox-marker-or-task-line"));
  assert.ok(malformed.malformed.some((entry) => entry.reason === "missing-executable-requirements"));
  assert.ok(malformed.malformed.some((entry) => entry.reason === "missing-parent-task"));
});
