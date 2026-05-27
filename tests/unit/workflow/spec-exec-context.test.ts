import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSpecExecAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts";
import { approveGate } from "../../../extensions/clarification-orchestrator/workflow/gates.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

test("loads approved requirements/tasks and approved design as background", async () => {
  const { cwd, state } = await fixtureState();
  const context = await buildSpecExecAdapterContext(cwd, state);

  assert.equal(context.topic, "my-topic");
  assert.match(context.approvedRequirements.content, /Requirement 1/u);
  assert.match(context.approvedTasks.content, /## Tasks/u);
  assert.match(context.approvedDesign?.content ?? "", /Design/u);
});

test("rejects missing plan approval and non-executing phase", async () => {
  const { cwd, state } = await fixtureState();
  await assert.rejects(() => buildSpecExecAdapterContext(cwd, { ...state, gates: {} }), /plan approval/u);
  await assert.rejects(() => buildSpecExecAdapterContext(cwd, { ...state, phase: "planning" }), /executing phase/u);
});

test("rejects stale approval and checksum-invalid approved artifacts", async () => {
  const { cwd, state, layout } = await fixtureState();
  const staleTasks = await writeVersionedArtifact(layout, "tasks", "## Tasks\n- [ ] 1. Other\n  - _Requirements: 1.1_\n");
  await assert.rejects(() => buildSpecExecAdapterContext(cwd, { ...state, artifacts: { ...state.artifacts, tasks: staleTasks } }), /stale or unexpected tasks/u);

  const tasksRef = state.artifacts.tasks;
  assert.ok(tasksRef);
  await fs.writeFile(path.join(layout.topicDir, tasksRef.path), "tampered");
  await assert.rejects(() => buildSpecExecAdapterContext(cwd, state), /checksum mismatch/u);
});

async function fixtureState(): Promise<{ cwd: string; layout: Awaited<ReturnType<typeof createWorkflowLayout>>; state: WorkflowState }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "spec-exec-context-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const design = await writeVersionedArtifact(layout, "design", "# Design\n");
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements\n\nRequirement 1\n");
  const tasks = await writeVersionedArtifact(layout, "tasks", "## Tasks\n- [ ] 1. Do work\n  - _Requirements: 1.1_\n");
  const designApproval = await approveGate(layout, { gate: "design", artifacts: [design], approvedBy: "tester" });
  const planApproval = await approveGate(layout, { gate: "plan", artifacts: [requirements, tasks], approvedBy: "tester" });
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  return {
    cwd,
    layout,
    state: {
      ...initial,
      phase: "executing",
      artifacts: { design, requirements, tasks },
      gates: { design: designApproval, plan: planApproval },
    },
  };
}
