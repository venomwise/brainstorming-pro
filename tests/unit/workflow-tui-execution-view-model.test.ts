import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionViewModel } from "../../extensions/clarification-orchestrator/tui/execution-view-model.ts";
import { createEmptyWorkflowExecutionSummary, type WorkflowExecutionSummary } from "../../extensions/clarification-orchestrator/workflow/execution-summary.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";

const snapshot: WorkflowLiveSnapshot = {
  topic: "demo-topic",
  runId: "run-1",
  phase: "executing",
  phaseStatus: "running",
  version: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:05.000Z",
  stale: false,
  fallbackText: "Executing",
  timeline: [],
  artifacts: [],
  agents: [],
  reviewers: [],
  tasks: [],
  gates: [],
  diagnostics: [],
};

test("maps normal execution summary", () => {
  const summary: WorkflowExecutionSummary = {
    ...createEmptyWorkflowExecutionSummary({ topic: "demo-topic", runId: "run-1", status: "running", mode: "full" }),
    currentTaskId: "1.2",
    tasks: [
      { taskId: "1.1", title: "Done", kind: "task", status: "completed", optional: false, requirementIds: ["1.1"], validation: { commands: [], evidence: ["ok"] } },
      { taskId: "1.2", title: "Now", kind: "checkpoint", status: "running", requirementIds: ["1.2"], activity: "checking" },
    ],
    report: { status: "unknown", validationCommands: [] },
  };
  const model = buildExecutionViewModel({ snapshot, summary });
  assert.equal(model?.status, "running");
  assert.equal(model?.mode, "full");
  assert.equal(model?.summary.completedTasks, 1);
  assert.equal(model?.currentTask?.taskId, "1.2");
  assert.equal(model?.taskTimeline[1]?.kind, "checkpoint");
});

test("builds snapshot-only task progress when summary is absent", () => {
  const model = buildExecutionViewModel({ snapshot: { ...snapshot, tasks: [{ taskId: "1.1", title: "Live", status: "started", activity: "running now" }] } });
  assert.equal(model?.status, "running");
  assert.equal(model?.taskTimeline[0]?.source, "snapshot");
  assert.equal(model?.taskTimeline[0]?.status, "running");
  assert.ok(model?.diagnostics.some((diagnostic) => diagnostic.code === "execution-summary-unavailable"));
});

test("returns undefined when no execution data exists", () => {
  assert.equal(buildExecutionViewModel({ snapshot }), undefined);
});

test("preserves durable summary precedence over live task disagreement", () => {
  const summary = createEmptyWorkflowExecutionSummary({ topic: "demo-topic", runId: "run-1", status: "completed" });
  summary.tasks.push({ taskId: "1.1", title: "Summary", kind: "task", status: "completed", requirementIds: [] });
  const model = buildExecutionViewModel({ snapshot: { ...snapshot, tasks: [{ taskId: "1.1", title: "Live", status: "running", activity: "live hint" }] }, summary });
  assert.equal(model?.status, "completed");
  assert.equal(model?.taskTimeline[0]?.status, "completed");
  assert.equal(model?.taskTimeline[0]?.activity, "live hint");
});

test("detects topic/run mismatch and avoids mismatched summary evidence", () => {
  const summary = createEmptyWorkflowExecutionSummary({ topic: "other-topic", runId: "run-2", status: "completed" });
  summary.tasks.push({ taskId: "9.9", title: "Wrong", kind: "task", status: "completed", requirementIds: [] });
  const model = buildExecutionViewModel({ snapshot: { ...snapshot, tasks: [{ taskId: "1.1", title: "Live", status: "running" }] }, summary });
  assert.equal(model?.taskTimeline[0]?.taskId, "1.1");
  assert.ok(model?.diagnostics.some((diagnostic) => diagnostic.code === "execution-context-mismatch"));
});

test("preserves partial fields without file-system access", () => {
  const summary = createEmptyWorkflowExecutionSummary({ topic: "demo-topic", runId: "run-1", status: "blocked" });
  summary.tasks.push({ taskId: "1.1", kind: "unknown", status: "blocked", requirementIds: [], checkbox: { taskId: "1.1", expected: "checked", updateStatus: "unavailable" } });
  summary.blockers.push({ taskId: "1.1", type: "unknown", tried: [], options: [] });
  const model = buildExecutionViewModel({ snapshot, summary });
  assert.equal(model?.taskTimeline[0]?.title, "Untitled execution task");
  assert.equal(model?.taskTimeline[0]?.checkbox?.updateStatus, "unavailable");
  assert.equal(model?.blockers[0]?.type, "unknown");
});
