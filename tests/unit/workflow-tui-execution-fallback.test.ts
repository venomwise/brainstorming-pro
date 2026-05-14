import test from "node:test";
import assert from "node:assert/strict";
import { renderExecutionFallback } from "../../extensions/clarification-orchestrator/tui/execution-fallback.ts";
import type { ExecutionViewModel } from "../../extensions/clarification-orchestrator/tui/execution-view-model.ts";

const model: ExecutionViewModel = {
  topic: "demo-topic",
  runId: "run-1",
  phase: "executing",
  generatedAt: "now",
  status: "blocked",
  mode: "full",
  summary: { totalTasks: 2, completedTasks: 1, runningTasks: 0, pendingTasks: 0, skippedTasks: 0, blockedTasks: 1, failedTasks: 0 },
  currentTask: { taskId: "1.2", title: "Blocked", kind: "task", status: "blocked", requirementIds: [], evidence: [], diagnostics: [], source: "summary" },
  taskTimeline: [],
  blockers: [{ taskId: "1.2", taskTitle: "Blocked", type: "missing_dependency", tried: [], risk: "missing API", options: [] }],
  mutationWarnings: [{ severity: "error", message: "tasks.md changed", affectedTaskIds: ["1.2"], failClosed: true }],
  executionReport: { status: "blocked", validationCommands: [], markdownPath: ".workflow/report.md" },
  diagnostics: [{ level: "warning", code: "x", message: "detail" }],
  safeCommands: ["/brainstorm-pro --status", "/brainstorm-pro --resume"],
};

test("renders deterministic execution fallback content", () => {
  const output = renderExecutionFallback(model, { width: 120 });
  assert.equal(output, renderExecutionFallback(model, { width: 120 }));
  assert.match(output, /Execution: blocked \(full\)/);
  assert.match(output, /Current task: 1\.2 Blocked/);
  assert.match(output, /Blocked: 1\.2 Blocked missing_dependency/);
  assert.match(output, /Mutation warning: tasks\.md changed \(fail-closed\)/);
  assert.match(output, /Execution report: \.workflow\/report\.md/);
  assert.match(output, /Safe next commands: \/brainstorm-pro --status; \/brainstorm-pro --resume/);
});

test("fallback respects narrow width", () => {
  const output = renderExecutionFallback(model, { width: 44 });
  for (const line of output.split("\n")) assert.ok(line.length <= 44);
});
