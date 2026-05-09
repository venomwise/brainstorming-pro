import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { buildBrainstormingAdapterContext, buildSpecPlanAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/context.ts";
import { createInitialWorkflowState, saveWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-adapter-context-"));
}

async function stateWithDesign(cwd: string): Promise<WorkflowState> {
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  const layout = await createWorkflowLayout(cwd, state.topic);
  const design = await writeVersionedArtifact(layout, "design", "# Design\n");
  return { ...state, artifacts: { design } };
}

test("brainstorming context includes workflow metadata", async () => {
  const cwd = await tempProject();
  const state = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  const context = await buildBrainstormingAdapterContext(cwd, state);
  assert.equal(context.topic, "my-topic");
  assert.equal(context.runId, "run-1");
  assert.equal(context.request, "Build");
  assert.equal(context.topicDir, path.join(cwd, "specs", "my-topic"));
  assert.equal(context.existingDesign, undefined);
});

test("brainstorming context loads existing design safely", async () => {
  const cwd = await tempProject();
  const state = await stateWithDesign(cwd);
  const context = await buildBrainstormingAdapterContext(cwd, state);
  assert.equal(context.existingDesign?.content, "# Design\n");
  assert.equal(context.existingDesign?.ref.kind, "design");
});

test("planning context loads approved design", async () => {
  const cwd = await tempProject();
  const base = await stateWithDesign(cwd);
  const design = base.artifacts.design!;
  const state: WorkflowState = {
    ...base,
    phase: "planning",
    reviewDecisions: { design: { id: "d", target: "design", mode: "skip", artifacts: [design], selectedBy: "u", selectedAt: "2026-05-08T00:00:00.000Z", path: ".workflow/decisions/design.json" } },
    reviewStatus: { design: { target: "design", mode: "skip", status: "skipped", artifacts: [design] } },
    gates: { design: { gate: "design", artifacts: [design], approvedBy: "u", approvedAt: "2026-05-08T00:00:00.000Z", path: ".workflow/approvals/design-approval.json" } },
  };
  const context = await buildSpecPlanAdapterContext(cwd, state);
  assert.equal(context.approvedDesign.content, "# Design\n");
  assert.equal(context.designApproval.gate, "design");
});

test("planning context rejects missing approval", async () => {
  const cwd = await tempProject();
  const state = await stateWithDesign(cwd);
  await assert.rejects(buildSpecPlanAdapterContext(cwd, { ...state, phase: "planning" }), /approval/u);
});

test("planning context rejects stale approval", async () => {
  const cwd = await tempProject();
  const state = await stateWithDesign(cwd);
  const design = state.artifacts.design!;
  const stale = { ...design, version: 0 };
  await assert.rejects(buildSpecPlanAdapterContext(cwd, { ...state, phase: "planning", gates: { design: { gate: "design", artifacts: [stale], approvedBy: "u", approvedAt: "now", path: ".workflow/approvals/design-approval.json" } } }), /latest design/u);
});

test("context rejects checksum mismatch", async () => {
  const cwd = await tempProject();
  const state = await stateWithDesign(cwd);
  const design = { ...state.artifacts.design!, checksum: "bad" };
  await assert.rejects(buildBrainstormingAdapterContext(cwd, { ...state, artifacts: { design } }), /Checksum mismatch/u);
});

test("context rejects artifact paths outside topic", async () => {
  const cwd = await tempProject();
  const state = await stateWithDesign(cwd);
  const design = { ...state.artifacts.design!, path: "../outside.md" };
  await assert.rejects(buildBrainstormingAdapterContext(cwd, { ...state, artifacts: { design } }), /Unsafe workflow path/u);
});
