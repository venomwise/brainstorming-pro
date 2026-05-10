import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { markPhaseComplete, markTaskComplete } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/checkbox-writer.ts";
import { buildSpecExecAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts";
import { parseTaskPlan } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { approveGate } from "../../../extensions/clarification-orchestrator/workflow/gates.ts";
import { readWorkflowEvents } from "../../../extensions/clarification-orchestrator/workflow/events.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";

test("updates exactly one task checkbox and appends an event", async () => {
  const context = await fixtureContext(`## Tasks\n- [ ] 1. Phase\n  - [ ] 1.1 Do it\n    - _Requirements: 1.1_\n`);
  const task = parseTaskPlan(await fs.readFile(path.join(context.topicDir, "tasks.md"), "utf8")).tasks.find((entry) => entry.id === "1.1");
  assert.ok(task);
  await markTaskComplete(context, task);
  const next = await fs.readFile(path.join(context.topicDir, "tasks.md"), "utf8");
  assert.match(next, /- \[✅\] 1\.1 Do it/u);
  assert.match(next, /- \[ \] 1\. Phase/u);
  assert.equal((await readWorkflowEvents(context.layout)).at(-1)?.type, "task.completed");
});

test("preserves optional marker and refuses original-line mismatch", async () => {
  const context = await fixtureContext(`## Tasks\n- [ ]* 1. Optional\n  - _Requirements: 1.1_\n`);
  const task = parseTaskPlan(await fs.readFile(path.join(context.topicDir, "tasks.md"), "utf8")).tasks[0];
  assert.ok(task);
  await fs.writeFile(path.join(context.topicDir, "tasks.md"), `## Tasks\n- [ ]* 1. Optional changed\n  - _Requirements: 1.1_\n`);
  await assert.rejects(() => markTaskComplete(context, task), /original line/u);
});

test("marks phase complete", async () => {
  const context = await fixtureContext(`## Tasks\n- [ ] 1. Phase\n  - [✅] 1.1 Done\n    - _Requirements: 1.1_\n`);
  const task = parseTaskPlan(await fs.readFile(path.join(context.topicDir, "tasks.md"), "utf8")).tasks[0];
  assert.ok(task);
  await markPhaseComplete(context, task);
  assert.match(await fs.readFile(path.join(context.topicDir, "tasks.md"), "utf8"), /- \[✅\] 1\. Phase/u);
});

async function fixtureContext(tasksMarkdown: string): Promise<Awaited<ReturnType<typeof buildSpecExecAdapterContext>>> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "spec-exec-writer-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements\n");
  const tasks = await writeVersionedArtifact(layout, "tasks", tasksMarkdown);
  const planApproval = await approveGate(layout, { gate: "plan", artifacts: [requirements, tasks], approvedBy: "tester" });
  const initial = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  return buildSpecExecAdapterContext(cwd, { ...initial, phase: "executing", artifacts: { requirements, tasks }, gates: { plan: planApproval } });
}
