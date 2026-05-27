import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildSpecExecAdapterContext } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/context.ts";
import { persistExecutionModeDecision, resolveExecutionMode, validateExecutionModeDecision } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/execution-mode.ts";
import { parseTaskPlan } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/task-plan-parser.ts";
import { approveGate } from "../../../extensions/clarification-orchestrator/workflow/gates.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";

const optionalPlan = `## Tasks\n- [ ] 1. Phase\n  - [ ]* 1.1 Optional\n    - _Requirements: 1.1_\n`;
const requiredPlan = `## Tasks\n- [ ] 1. Do work\n  - _Requirements: 1.1_\n`;

test("proceeds as full when no optional tasks exist", async () => {
  const context = await fixtureContext(requiredPlan);
  const result = await resolveExecutionMode(context, parseTaskPlan(requiredPlan));
  assert.equal(result.status, "ready");
  assert.equal(result.status === "ready" && result.mode, "full");
});

test("requires, persists, validates, and rejects stale optional mode decisions", async () => {
  const context = await fixtureContext(optionalPlan);
  const missing = await resolveExecutionMode(context, parseTaskPlan(optionalPlan));
  assert.equal(missing.status, "decision-required");

  const decision = await persistExecutionModeDecision(context, "mvp", new Date("2026-01-01T00:00:00Z"));
  assert.equal(validateExecutionModeDecision(decision, context).mode, "mvp");
  const ready = await resolveExecutionMode(context, parseTaskPlan(optionalPlan));
  assert.equal(ready.status === "ready" && ready.mode, "mvp");

  assert.throws(() => validateExecutionModeDecision({ ...decision, artifactVersions: { requirements: 999, tasks: 1 } }, context), /stale/u);
});

async function fixtureContext(tasksMarkdown: string): Promise<Awaited<ReturnType<typeof buildSpecExecAdapterContext>>> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "spec-exec-mode-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements\n");
  const tasks = await writeVersionedArtifact(layout, "tasks", tasksMarkdown);
  const planApproval = await approveGate(layout, { gate: "plan", artifacts: [requirements, tasks], approvedBy: "tester" });
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  return buildSpecExecAdapterContext(cwd, { ...initial, phase: "executing", artifacts: { requirements, tasks }, gates: { plan: planApproval } });
}
