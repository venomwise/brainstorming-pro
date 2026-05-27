import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSpecExecAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts";
import { snapshotExecutionArtifacts, verifyNoUnauthorizedArtifactMutation } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/mutation-guard.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { approveGate } from "../../../extensions/clarification-orchestrator/workflow/gates.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";

test("allows unchanged execution artifacts", async () => {
  const context = await fixtureContext();
  await verifyNoUnauthorizedArtifactMutation(await snapshotExecutionArtifacts(context), context);
});

test("detects child mutation of tasks and approved artifacts", async () => {
  const context = await fixtureContext(true);
  const snapshot = await snapshotExecutionArtifacts(context);
  await fs.appendFile(path.join(context.topicDir, "tasks.md"), "\nmutated");
  await assert.rejects(() => verifyNoUnauthorizedArtifactMutation(snapshot, context), /tasks.md changed/u);

  const context2 = await fixtureContext(true);
  const snapshot2 = await snapshotExecutionArtifacts(context2);
  await fs.appendFile(context2.approvedRequirements.absolutePath, "mutated");
  await assert.rejects(() => verifyNoUnauthorizedArtifactMutation(snapshot2, context2), /requirements/u);

  const context3 = await fixtureContext(true);
  const snapshot3 = await snapshotExecutionArtifacts(context3);
  assert.ok(context3.approvedDesign);
  await fs.appendFile(context3.approvedDesign.absolutePath, "mutated");
  await assert.rejects(() => verifyNoUnauthorizedArtifactMutation(snapshot3, context3), /design/u);
});

async function fixtureContext(withDesign = false): Promise<Awaited<ReturnType<typeof buildSpecExecAdapterContext>>> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "spec-exec-guard-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const design = withDesign ? await writeVersionedArtifact(layout, "design", "# Design\n") : undefined;
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements\n");
  const tasks = await writeVersionedArtifact(layout, "tasks", "## Tasks\n- [ ] 1. Do\n  - _Requirements: 1.1_\n");
  const designApproval = design ? await approveGate(layout, { gate: "design", artifacts: [design], approvedBy: "tester" }) : undefined;
  const planApproval = await approveGate(layout, { gate: "plan", artifacts: [requirements, tasks], approvedBy: "tester" });
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  return buildSpecExecAdapterContext(cwd, { ...initial, phase: "executing", artifacts: { ...(design ? { design } : {}), requirements, tasks }, gates: { ...(designApproval ? { design: designApproval } : {}), plan: planApproval } });
}
