import assert from "node:assert/strict";
import test from "node:test";
import { WorkflowLiveWidget, renderCompactWorkflowSnapshot, renderExpandedWorkflowSnapshot } from "../../extensions/clarification-orchestrator/tui/workflow-widget.ts";
import { visibleWorkflowWidth } from "../../extensions/clarification-orchestrator/tui/render-helpers.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";

function snapshot(overrides: Partial<WorkflowLiveSnapshot> = {}): WorkflowLiveSnapshot {
  return {
    topic: "live-progress",
    runId: "run-1",
    phase: "design-review",
    phaseStatus: "running",
    version: 4,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:00:10.000Z",
    stale: false,
    fallbackText: "Workflow live-progress is running.",
    timeline: [{ phase: "designing", status: "completed" }, { phase: "design-review", status: "running", activity: "reviewing" }],
    currentActivity: { id: "review", kind: "reviewer", label: "Reviewers are checking the design", status: "running" },
    artifacts: [{ kind: "design", version: 1, path: "specs/live-progress/design.md", checksum: "abcdef1234567890" }],
    agents: [{ agentRunId: "agent-1", role: "design-author", status: "succeeded", outputBytes: 100 }],
    reviewers: [{ reviewRunId: "review-1", target: "design", reviewerId: "product-reviewer", status: "passed", findingCount: 0 }],
    tasks: [{ taskId: "1.1", title: "Create widget", status: "running", activity: "rendering" }],
    gates: [],
    diagnostics: [],
    ...overrides,
  };
}

function assertWidth(lines: string[], width: number): void {
  for (const line of lines) {
    assert.ok(visibleWorkflowWidth(line) <= width, `${visibleWorkflowWidth(line)} > ${width}: ${line}`);
  }
}

test("compact renderer shows running progress and respects width", () => {
  const lines = renderCompactWorkflowSnapshot(snapshot(), 60, Date.parse("2026-05-12T00:00:10.000Z"));
  assert.match(lines.join("\n"), /live-progress/);
  assert.match(lines.join("\n"), /agents/);
  assertWidth(lines, 60);
  assertWidth(renderCompactWorkflowSnapshot(snapshot(), 24), 24);
});

test("workflow widget renders optional review panel in expanded mode and fails soft", () => {
  const widget = new WorkflowLiveWidget({
    getSnapshot: () => snapshot(),
    initialMode: "expanded",
    getReviewPanelViewModel: (live) => ({ topic: live.topic, runId: live.runId, phase: live.phase, staleEvidence: [], diagnostics: [{ level: "info", code: "x", message: "review detail" }] }),
  });
  assert.match(widget.render(100).join("\n"), /Review panel/);
  const failing = new WorkflowLiveWidget({ getSnapshot: () => snapshot(), initialMode: "expanded", getReviewPanelViewModel: () => { throw new Error("boom"); } });
  assert.match(failing.render(100).join("\n"), /Review panel rendering unavailable: boom/);
});

test("workflow widget renders optional execution provider in expanded mode and fails soft", () => {
  const widget = new WorkflowLiveWidget({
    getSnapshot: () => snapshot(),
    initialMode: "expanded",
    getExecutionViewModel: (live) => ({
      topic: live.topic,
      runId: live.runId,
      phase: live.phase,
      generatedAt: live.updatedAt,
      status: "running",
      summary: { totalTasks: 1, completedTasks: 0, runningTasks: 1, pendingTasks: 0, skippedTasks: 0, blockedTasks: 0, failedTasks: 0 },
      taskTimeline: [{ taskId: "1.1", title: "Execute", kind: "task", status: "running", requirementIds: [], evidence: [], diagnostics: [], source: "summary" }],
      blockers: [],
      mutationWarnings: [],
      diagnostics: [],
      safeCommands: ["/brainstorm-pro --status"],
    }),
  });
  assert.match(widget.render(100).join("\n"), /Execution:/);
  assert.match(widget.render(100).join("\n"), /Task timeline:/);
  const compact = new WorkflowLiveWidget({ getSnapshot: () => snapshot(), initialMode: "compact", getExecutionViewModel: () => { throw new Error("should not run compact"); } });
  assert.doesNotMatch(compact.render(100).join("\n"), /Execution details unavailable/);
  const failing = new WorkflowLiveWidget({ getSnapshot: () => snapshot(), initialMode: "expanded", getExecutionViewModel: () => { throw new Error("boom"); } });
  assert.match(failing.render(100).join("\n"), /Execution details unavailable: boom/);
});

test("expanded renderer includes timeline, agents, reviewers, tasks, artifacts, diagnostics, and gates", () => {
  const lines = renderExpandedWorkflowSnapshot(snapshot({
    phase: "awaiting-design-approval",
    phaseStatus: "awaiting-user",
    gates: [{ id: "design-approval", gate: "design-approval", title: "Design approval required", status: "awaiting-user", artifacts: [{ kind: "design", version: 1, path: "specs/live-progress/design.md", checksum: "abcdef1234567890" }], safeCommands: ["/brainstorm-pro --resume live-progress"] }],
    diagnostics: [{ level: "info", code: "note", message: "diagnostic" }],
  }), 72);
  const output = lines.join("\n");
  assert.match(output, /Timeline:/);
  assert.match(output, /Agents:/);
  assert.match(output, /Reviewers:/);
  assert.match(output, /Tasks:/);
  assert.match(output, /Artifacts:/);
  assert.match(output, /Read-only gates:/);
  assert.match(output, /Readiness is not approval/);
  assert.match(output, /Diagnostics:/);
  assertWidth(lines, 72);
});

test("widget handles presentation-only keyboard actions", () => {
  let closed = false;
  const widget = new WorkflowLiveWidget({ getSnapshot: () => snapshot(), onClose: () => { closed = true; } });
  assert.equal(widget.handleInput("e"), "handled");
  assert.equal(widget.isInvalidated(), true);
  assert.match(widget.render(80).join("\n"), /Timeline:/);
  assert.equal(widget.handleInput("j"), "handled");
  assert.equal(widget.handleInput("k"), "handled");
  assert.equal(widget.handleInput("approve"), "ignored");
  assert.equal(widget.handleInput("q"), "closed");
  assert.equal(closed, true);
  assert.deepEqual(widget.render(80), []);
});

test("renderers cover gate, blocked, failed, done, stale, reviewer, agent, and task snapshots", () => {
  const cases: WorkflowLiveSnapshot[] = [
    snapshot({ phase: "awaiting-plan-approval", phaseStatus: "awaiting-user", gates: [{ id: "plan-approval", gate: "plan-approval", title: "Plan approval required", status: "awaiting-user", artifacts: [], safeCommands: ["/brainstorm-pro --resume live-progress"] }] }),
    snapshot({ phase: "blocked", phaseStatus: "blocked", gates: [{ id: "blocked", gate: "blocked", title: "Workflow blocked", status: "blocked", artifacts: [], safeCommands: ["/brainstorm-pro --resume live-progress"] }] }),
    snapshot({ phase: "failed", phaseStatus: "failed", gates: [{ id: "failed", gate: "failed", title: "Workflow failed", status: "failed", artifacts: [], safeCommands: [] }] }),
    snapshot({ phase: "done", phaseStatus: "done", gates: [{ id: "done", gate: "done", title: "Workflow complete", status: "done", artifacts: [], safeCommands: [] }] }),
    snapshot({ stale: true, staleReason: "stale run" }),
  ];

  for (const item of cases) {
    assertWidth(renderCompactWorkflowSnapshot(item, 50), 50);
    assertWidth(renderExpandedWorkflowSnapshot(item, 50), 50);
  }
});
