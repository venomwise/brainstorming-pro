import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowProgressController } from "../../extensions/clarification-orchestrator/workflow/live-snapshot-store.ts";
import type { WorkflowState } from "../../extensions/clarification-orchestrator/workflow/types.ts";

function state(overrides: Partial<WorkflowState> = {}): WorkflowState {
  return {
    version: 1,
    runId: "run-1",
    topic: "live-progress",
    request: "show live workflow progress",
    phase: "designing",
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:00.000Z",
    artifacts: {},
    reviewDecisions: {},
    reviewStatus: {},
    gates: {},
    ...overrides,
  };
}

test("snapshot uses durable phase over conflicting live progress", () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  controller.emit({
    type: "phase.activity",
    topic: "live-progress",
    runId: "run-1",
    phase: "planning",
    at: "2026-05-12T00:00:01.000Z",
    activity: "planning from a stale callback",
  });

  const snapshot = controller.getSnapshot(state({ phase: "designing" }));

  assert.equal(snapshot.phase, "designing");
  assert.equal(snapshot.phaseStatus, "running");
  assert.match(snapshot.diagnostics.map((diagnostic) => diagnostic.code).join("\n"), /live-progress-phase-differs-from-durable-state/);
});

test("snapshot version increments for visible progress and diagnostics", () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  const initial = controller.getSnapshot(state());
  assert.equal(initial.version, 0);

  controller.emit({
    type: "task.progress",
    topic: "live-progress",
    runId: "run-1",
    phase: "executing",
    at: "2026-05-12T00:00:01.000Z",
    taskId: "1.1",
    status: "running",
    activity: "editing files",
  });
  assert.equal(controller.getSnapshot(state({ phase: "executing" })).version, 1);

  controller.emit({ type: "task.progress", topic: "other", runId: "run-1", phase: "executing", at: "x", taskId: "1.1", status: "running" });
  assert.equal(controller.getSnapshot(state({ phase: "executing" })).version, 2);
});

test("stale markers are set for controller/state mismatch and stale gate artifacts", () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  const snapshot = controller.getSnapshot(state({
    topic: "other-topic",
    pendingDecision: {
      type: "approval",
      gate: "design",
      artifacts: [{ kind: "design", version: 2, path: "specs/live-progress/design.md", checksum: "missing", createdAt: "now" }],
      choices: ["approve", "revise", "status", "exit"],
    },
  }));

  assert.equal(snapshot.stale, true);
  assert.match(snapshot.staleReason ?? "", /topic\/run/);
  assert.match(snapshot.staleReason ?? "", /artifact bindings/);
});

test("late progress after close is diagnostic only", () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  controller.close();
  const accepted = controller.emit({
    type: "phase.activity",
    topic: "live-progress",
    runId: "run-1",
    phase: "designing",
    at: "2026-05-12T00:00:01.000Z",
    activity: "too late",
  });

  const snapshot = controller.getSnapshot(state());
  assert.equal(accepted, false);
  assert.equal(snapshot.currentActivity?.label, "Workflow phase: designing");
  assert.match(snapshot.diagnostics.map((diagnostic) => diagnostic.code).join("\n"), /late-progress-after-close/);
});

test("high-frequency output events are coalesced while final statuses are preserved", () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 10 });
  controller.emit({
    type: "agent.progress",
    topic: "live-progress",
    runId: "run-1",
    phase: "designing",
    at: "2026-05-12T00:00:01.000Z",
    agentRunId: "agent-1",
    status: "output",
    outputBytes: 10,
    outputStream: "stdout",
    source: { type: "agent.output", agentRunId: "agent-1", stream: "stdout", bytes: 10, at: "2026-05-12T00:00:01.000Z" },
  });
  controller.emit({
    type: "agent.progress",
    topic: "live-progress",
    runId: "run-1",
    phase: "designing",
    at: "2026-05-12T00:00:02.000Z",
    agentRunId: "agent-1",
    status: "output",
    outputBytes: 5,
    outputStream: "stdout",
    source: { type: "agent.output", agentRunId: "agent-1", stream: "stdout", bytes: 5, at: "2026-05-12T00:00:02.000Z" },
  });
  controller.emit({
    type: "agent.progress",
    topic: "live-progress",
    runId: "run-1",
    phase: "designing",
    at: "2026-05-12T00:00:03.000Z",
    agentRunId: "agent-1",
    status: "succeeded",
    source: { type: "agent.completed", agentRunId: "agent-1", status: "succeeded", at: "2026-05-12T00:00:03.000Z" },
  });

  const snapshot = controller.getSnapshot(state());
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.agents[0]?.status, "succeeded");
  assert.equal(snapshot.agents[0]?.outputBytes, 15);
});

test("malformed progress produces a minimal fallback snapshot with diagnostics", () => {
  const controller = new WorkflowProgressController({ topic: "live-progress", runId: "run-1", throttleMs: 0 });
  controller.emit({ type: "phase.activity" });
  const snapshot = controller.getSnapshot(state({ phase: "awaiting-design-approval" }));

  assert.equal(snapshot.phase, "awaiting-design-approval");
  assert.equal(snapshot.fallbackText, "Workflow live-progress is awaiting-design-approval.");
  assert.match(snapshot.diagnostics.map((diagnostic) => diagnostic.code).join("\n"), /malformed-progress/);
});
