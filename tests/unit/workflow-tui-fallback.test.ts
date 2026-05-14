import assert from "node:assert/strict";
import test from "node:test";
import { formatWorkflowArtifactLabel, formatWorkflowChecksumPrefix, shortenWorkflowDisplayPath } from "../../extensions/clarification-orchestrator/tui/formatters.ts";
import { stripAnsi, visibleWorkflowWidth } from "../../extensions/clarification-orchestrator/tui/render-helpers.ts";
import { renderWorkflowLiveSnapshotFallback } from "../../extensions/clarification-orchestrator/tui/workflow-result.ts";
import type { WorkflowLiveSnapshot } from "../../extensions/clarification-orchestrator/workflow/progress-types.ts";

function snapshot(overrides: Partial<WorkflowLiveSnapshot> = {}): WorkflowLiveSnapshot {
  return {
    topic: "live-progress",
    runId: "run-1",
    phase: "awaiting-design-approval",
    phaseStatus: "awaiting-user",
    version: 2,
    createdAt: "2026-05-12T00:00:00.000Z",
    updatedAt: "2026-05-12T00:01:00.000Z",
    stale: false,
    fallbackText: "Workflow live-progress is awaiting design approval.",
    timeline: [],
    currentActivity: {
      id: "gate:design",
      kind: "phase",
      label: "Awaiting design approval",
      status: "awaiting-user",
      updatedAt: "2026-05-12T00:01:00.000Z",
    },
    artifacts: [{ kind: "design", version: 3, path: "/home/user/project/specs/live-progress/design.md", checksum: "abcdef1234567890", status: "durable" }],
    agents: [],
    reviewers: [],
    tasks: [],
    gates: [{
      id: "design-approval",
      gate: "design-approval",
      title: "Design approval required",
      status: "awaiting-user",
      artifacts: [],
      safeCommands: ["/brainstorm-pro --resume live-progress"],
    }],
    diagnostics: [],
    ...overrides,
  };
}

test("fallback output is deterministic and ANSI-free", () => {
  const output = renderWorkflowLiveSnapshotFallback(snapshot(), { plain: true, width: 120 });
  assert.equal(output, renderWorkflowLiveSnapshotFallback(snapshot(), { plain: true, width: 120 }));
  assert.equal(stripAnsi(output), output);
  assert.match(output, /# Workflow status: live-progress/);
  assert.match(output, /Safe next commands/);
});

test("formatter helpers shorten checksums, artifacts, and paths", () => {
  assert.equal(formatWorkflowChecksumPrefix("abcdef1234567890", 8), "abcdef12");
  assert.equal(formatWorkflowArtifactLabel({ kind: "design", version: 3, checksum: "abcdef1234567890", path: "/tmp/design.md" }), "design v3@abcdef123456 /tmp/design.md");
  assert.equal(shortenWorkflowDisplayPath("/very/long/path/to/specs/topic/tasks.md", 12), "…ic/tasks.md");
});

test("fallback clearly marks stale snapshots and diagnostics", () => {
  const output = renderWorkflowLiveSnapshotFallback(snapshot({
    stale: true,
    staleReason: "Snapshot context does not match controller topic/run.",
    diagnostics: [{ level: "warning", code: "stale", message: "stale context" }],
  }));
  assert.match(output, /Stale snapshot/);
  assert.match(output, /WARNING stale: stale context/);
});

test("fallback remains useful with minimal durable-state data", () => {
  const output = renderWorkflowLiveSnapshotFallback(snapshot({
    currentActivity: undefined,
    artifacts: [],
    gates: [],
    fallbackText: "Workflow live-progress is designing.",
  }));
  assert.match(output, /Workflow live-progress is designing/);
});

test("fallback respects narrow width", () => {
  const output = renderWorkflowLiveSnapshotFallback(snapshot(), { width: 48 });
  for (const line of output.split("\n")) {
    assert.ok(visibleWorkflowWidth(line) <= 48, `${visibleWorkflowWidth(line)} > 48: ${line}`);
  }
});

test("fallback can include execution view model detail", () => {
  const output = renderWorkflowLiveSnapshotFallback(snapshot(), {
    width: 120,
    executionViewModel: {
      topic: "live-progress",
      runId: "run-1",
      phase: "executing",
      generatedAt: "now",
      status: "running",
      summary: { totalTasks: 1, completedTasks: 0, runningTasks: 1, pendingTasks: 0, skippedTasks: 0, blockedTasks: 0, failedTasks: 0 },
      taskTimeline: [],
      blockers: [],
      mutationWarnings: [],
      diagnostics: [],
      safeCommands: ["/brainstorm-pro --status"],
    },
  });
  assert.match(output, /## Execution/);
  assert.match(output, /Execution: running/);
});
