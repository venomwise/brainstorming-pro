import test from "node:test";
import assert from "node:assert/strict";
import { hasAllExecutableChildrenComplete, selectNextExecutableTask } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-loop.ts";
import { parseTaskPlan } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts";

test("selects first incomplete child before phase and skips completed tasks", () => {
  const plan = parseTaskPlan(`## Tasks\n- [ ] 1. Phase\n  - [✅] 1.1 Done\n    - _Requirements: 1.1_\n  - [ ] 1.2 Next\n    - _Requirements: 1.2_\n`);
  const selection = selectNextExecutableTask(plan, "full");
  assert.equal(selection.kind, "execute");
  assert.equal(selection.kind === "execute" && selection.task.id, "1.2");
});

test("marks phase complete after executable children and selects checkpoint in order", () => {
  const plan = parseTaskPlan(`## Tasks\n- [ ] 1. Phase\n  - [✅] 1.1 Done\n    - _Requirements: 1.1_\n- [ ] 2. Checkpoint - Verify\n  - _Requirements: 2.1_\n`);
  const phase = plan.tasks[0];
  assert.ok(phase);
  assert.equal(hasAllExecutableChildrenComplete(phase, plan, "full"), true);
  const selection = selectNextExecutableTask(plan, "full");
  assert.equal(selection.kind, "complete-phase");
});

test("skips optional tasks and optional phase children in mvp but includes them in full", () => {
  const plan = parseTaskPlan(`## Tasks\n- [ ]* 1. Optional Phase\n  - [ ] 1.1 Optional child\n    - _Requirements: 1.1_\n- [ ] 2. Required\n  - _Requirements: 2.1_\n`);
  const mvp = selectNextExecutableTask(plan, "mvp");
  assert.equal(mvp.kind === "execute" && mvp.task.id, "2");
  const full = selectNextExecutableTask(plan, "full");
  assert.equal(full.kind === "execute" && full.task.id, "1.1");
});

test("returns none when no executable required tasks remain", () => {
  const plan = parseTaskPlan(`## Tasks\n- [✅] 1. Required\n  - _Requirements: 1.1_\n- [ ]* 2. Optional\n  - _Requirements: 2.1_\n`);
  assert.equal(selectNextExecutableTask(plan, "mvp").kind, "none");
});
