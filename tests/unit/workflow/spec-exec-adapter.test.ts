import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSpecExecAdapter } from "../../../extensions/clarification-orchestrator/workflow/adapters/spec-exec.ts";
import { createWorkflowLayout, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";
import { approveGate } from "../../../extensions/clarification-orchestrator/workflow/gates.ts";
import { createInitialWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { WorkflowState } from "../../../extensions/clarification-orchestrator/workflow/types.ts";
import type { RunAgentFunction } from "../../../extensions/clarification-orchestrator/workflow/adapters/agent-backed.ts";

test("spec-exec adapter completes a single task through fake child and code-owned checkbox update", async () => {
  const { cwd, state } = await fixtureState();
  const adapter = createSpecExecAdapter({ projectRoot: cwd, model: "openai:gpt-4o-mini", runAgent: completedRunAgent });
  const output = await adapter.run(state, state);
  assert.equal(output.kind, "state-patch");
  assert.equal(output.kind === "state-patch" && output.statePatch.phase, "done");
  assert.match(await fs.readFile(path.join(cwd, "specs/my-topic/tasks.md"), "utf8"), /\[✅\] 1\. Do/u);
});

test("spec-exec adapter stops on blocked child result", async () => {
  const { cwd, state } = await fixtureState();
  const adapter = createSpecExecAdapter({ projectRoot: cwd, model: "openai:gpt-4o-mini", runAgent: blockedRunAgent });
  const output = await adapter.run(state, state);
  assert.equal(output.kind, "state-patch");
  assert.equal(output.kind === "state-patch" && output.statePatch.phase, "blocked");
  assert.equal(output.kind === "state-patch" && output.statePatch.lastError?.message, "missing_dependency");
  assert.match(await fs.readFile(path.join(cwd, "specs/my-topic/tasks.md"), "utf8"), /\[ \] 1\. Do/u);
});

test("spec-exec adapter blocks unauthorized child tasks.md mutation", async () => {
  const { cwd, state } = await fixtureState();
  const runAgent: RunAgentFunction = async (request) => {
    await fs.appendFile(path.join(cwd, "specs/my-topic/tasks.md"), "\nchild mutation");
    return completedRunAgent(request);
  };
  const adapter = createSpecExecAdapter({ projectRoot: cwd, model: "openai:gpt-4o-mini", runAgent });
  const output = await adapter.run(state, state);
  assert.equal(output.kind, "state-patch");
  assert.equal(output.kind === "state-patch" && output.statePatch.phase, "blocked");
  assert.equal(output.kind === "state-patch" && output.statePatch.lastError?.message, "scope_change");
});

const completedRunAgent: RunAgentFunction = async (request) => ({
  agentRunId: "agent-1",
  role: request.role,
  status: "succeeded",
  output: {
    kind: "single-task-result",
    taskId: "1",
    status: "completed",
    changedFiles: ["src/file.ts"],
    summary: "done",
    validation: { commands: [{ command: "npm test", status: "passed", summary: "ok" }], evidence: ["ok"] },
  } as never,
  paths: { agentRunDir: "/tmp/agent" },
  startedAt: "now",
  completedAt: "now",
  attempts: 1,
  attemptRecords: [],
  outputCapture: { stdoutBytes: 0, stderrBytes: 0, rawOutputBytes: 0, stdoutTruncated: false, stderrTruncated: false, rawOutputTruncated: false },
});

const blockedRunAgent: RunAgentFunction = async (request) => ({
  ...(await completedRunAgent(request)),
  output: {
    kind: "single-task-result",
    taskId: "1",
    status: "blocked",
    changedFiles: [],
    summary: "blocked",
    validation: { commands: [], evidence: [] },
    blocker: { task: "1 Do", type: "missing_dependency", context: { taskExcerpt: "- [ ] 1. Do", requirements: "1.1" }, tried: ["checked"], risk: "missing", options: ["provide"], neededFromUser: "dependency" },
  } as never,
});

async function fixtureState(): Promise<{ cwd: string; state: WorkflowState }> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "spec-exec-adapter-"));
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const requirements = await writeVersionedArtifact(layout, "requirements", "# Requirements\n");
  const tasks = await writeVersionedArtifact(layout, "tasks", "## Tasks\n- [ ] 1. Do\n  - _Requirements: 1.1_\n");
  const planApproval = await approveGate(layout, { gate: "plan", artifacts: [requirements, tasks], approvedBy: "tester" });
  const initial = createInitialWorkflowState({ topic: "my-topic", request: "Build", runId: "run-1" });
  return { cwd, state: { ...initial, phase: "executing", artifacts: { requirements, tasks }, gates: { plan: planApproval } } };
}
