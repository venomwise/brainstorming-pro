import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSpecExecAdapter } from "../../extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { approveGate } from "../../extensions/clarification-orchestrator/workflow/gates.ts";
import { createInitialWorkflowState, saveWorkflowState, WorkflowRuntimeOrchestrator } from "../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { RunAgentFunction } from "../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";

test("runtime executes approved tasks, writes report, commits tasks artifact, and enters done", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "spec-exec-runtime-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements\n");
  const tasks = await writeVersionedArtifact(layout, "tasks", `## Tasks\n- [ ] 1. Phase\n  - [ ] 1.1 First\n    - _Requirements: 1.1_\n- [ ] 2. Checkpoint - Verify\n  - _Requirements: 2.1_\n`);
  const planApproval = await approveGate(layout, { gate: "plan", artifacts: [requirements, tasks], approvedBy: "tester" });
  const initial = createInitialWorkflowState({ agentModel: "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  await saveWorkflowState(cwd, { ...initial, phase: "executing", artifacts: { requirements, tasks }, gates: { plan: planApproval } });

  const orchestrator = new WorkflowRuntimeOrchestrator(cwd, { adapters: { executing: { run: async (state) => {
    const adapter = createSpecExecAdapter({ projectRoot: cwd, model: "openai/gpt-4o-mini", runAgent: completingRunAgent });
    const output = await adapter.run(state, state);
    return adapter.commit(output, state);
  } } } });
  const state = await orchestrator.resumeWorkflow("my-topic");
  assert.ok(!("selectionRequired" in state));
  assert.equal(state.phase, "done");
  assert.ok(state.artifacts.tasks && state.artifacts.tasks.version > tasks.version);
  assert.match(await fs.readFile(path.join(cwd, "specs/my-topic/tasks.md"), "utf8"), /\[✅\] 2\. Checkpoint/u);
  assert.ok(await exists(path.join(cwd, "specs/my-topic/.workflow/runs/run-1/execution-report.json")));
});

const completingRunAgent: RunAgentFunction = async (request) => {
  const match = /taskId[^\n]*([0-9.]+)/u.exec(request.prompt);
  const taskId = match?.[1] ?? "unknown";
  return {
    agentRunId: `agent-${taskId}`,
    role: request.role,
    status: "succeeded",
    output: { kind: "single-task-result", taskId, status: "completed", changedFiles: [`src/${taskId}.ts`], summary: "done", validation: { commands: [{ command: "npm test", status: "passed", summary: "ok" }], evidence: ["ok"] } } as never,
    paths: { agentRunDir: "/tmp/agent" },
    startedAt: "now",
    completedAt: "now",
    attempts: 1,
    attemptRecords: [],
    outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false },
  };
};

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}
