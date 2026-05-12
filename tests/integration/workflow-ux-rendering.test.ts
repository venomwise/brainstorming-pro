import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowRuntimeOrchestrator, createInitialWorkflowState, saveWorkflowState } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import { renderWorkflowUxResult } from "../../extensions/clarification-orchestrator/workflow/ux-renderer.ts";
import type { VersionedArtifactRef } from "../../extensions/clarification-orchestrator/workflow/types.ts";

const design: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "design", createdAt: "2026-05-12T00:00:00.000Z" };
const requirements: VersionedArtifactRef = { kind: "requirements", version: 1, path: ".workflow/artifacts/requirements/v1.md", checksum: "requirements", createdAt: "2026-05-12T00:00:00.000Z" };
const tasks: VersionedArtifactRef = { kind: "tasks", version: 1, path: ".workflow/artifacts/tasks/v1.md", checksum: "tasks", createdAt: "2026-05-12T00:00:00.000Z" };

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-ux-int-"));
}

test("resume rendering with multiple topics requires selection and does not advance", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "alpha-topic", request: "a", runId: "run-1" }), phase: "awaiting-design-review-decision", artifacts: { design } });
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "beta-topic", request: "b", runId: "run-1" }), phase: "awaiting-design-review-decision", artifacts: { design } });

  const result = await runtime.resumeWorkflow();
  const output = renderWorkflowUxResult(result);
  assert.match(output, /Select a workflow topic/);
  assert.match(output, /\/brainstorm-pro --resume alpha-topic/);
  assert.match(output, /\/brainstorm-pro --status beta-topic/);

  const alpha = await runtime.getStatus("alpha-topic");
  assert.equal("phase" in alpha && alpha.phase, "awaiting-design-review-decision");
});

test("status and resume rendering show artifacts and pending decisions", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "decision-topic", request: "x", runId: "run-1" }), phase: "awaiting-design-review-decision", artifacts: { design } });

  const statusOutput = renderWorkflowUxResult(await runtime.getStatus("decision-topic"));
  assert.match(statusOutput, /Phase: awaiting-design-review-decision/);
  assert.match(statusOutput, /Pending: review-decision/);
  assert.match(statusOutput, /design v1/);

  const resumeOutput = renderWorkflowUxResult(await runtime.resumeWorkflow("decision-topic"));
  assert.match(resumeOutput, /Design review decision gate/);
  assert.match(resumeOutput, /Available choices: skip, minimal, full, revise, exit/);
});

test("blocked and failed resume rendering returns diagnostics rather than active phase advancement", async () => {
  const cwd = await tempProject();
  const runtime = new WorkflowRuntimeOrchestrator(cwd);
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "blocked-topic", request: "x", runId: "run-1" }), phase: "blocked", artifacts: { design, requirements, tasks }, lastError: { message: "needs attention", phase: "plan-review", recoverable: true, occurredAt: "2026-05-12T00:00:00.000Z" } });
  await saveWorkflowState(cwd, { ...createInitialWorkflowState({ topic: "failed-topic", request: "x", runId: "run-1" }), phase: "failed", artifacts: { design }, lastError: { message: "bad output", phase: "designing", recoverable: false, occurredAt: "2026-05-12T00:00:00.000Z" } });

  const blockedOutput = renderWorkflowUxResult(await runtime.resumeWorkflow("blocked-topic"));
  assert.match(blockedOutput, /Blocked workflow diagnostics/);
  assert.match(blockedOutput, /needs attention/);
  assert.match(blockedOutput, /no automatic advancement is implied/);
  const blockedStatus = await runtime.getStatus("blocked-topic");
  assert.equal("phase" in blockedStatus && blockedStatus.phase, "blocked");

  const failedOutput = renderWorkflowUxResult(await runtime.resumeWorkflow("failed-topic"));
  assert.match(failedOutput, /Failed workflow diagnostics/);
  assert.match(failedOutput, /bad output/);
  assert.match(failedOutput, /No retry, approval, or recovery action/);
});
