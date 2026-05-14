import test from "node:test";
import assert from "node:assert/strict";
import { renderExecutionView } from "../../extensions/clarification-orchestrator/tui/execution/index.ts";
import type { ExecutionViewModel } from "../../extensions/clarification-orchestrator/tui/execution-view-model.ts";

function model(): ExecutionViewModel {
  return {
    topic: "demo-topic",
    runId: "run-1",
    phase: "executing",
    generatedAt: "2026-01-01T00:00:00.000Z",
    status: "running",
    mode: "full",
    summary: { totalTasks: 3, completedTasks: 1, runningTasks: 1, pendingTasks: 0, skippedTasks: 1, blockedTasks: 0, failedTasks: 0 },
    currentTask: { taskId: "1.2", title: "Check", kind: "checkpoint", status: "running", requirementIds: ["1.2"], activity: "validating", outputPath: ".workflow/out.txt", evidencePath: ".workflow/evidence.txt", evidence: ["inspected files"], validation: { commands: [{ command: "npm run typecheck", status: "passed", summary: "clean" }], evidence: ["typecheck passed"] }, diagnostics: [], source: "summary" },
    taskTimeline: [
      { taskId: "1.1", title: "Done", kind: "task", status: "completed", requirementIds: [], evidence: [], checkbox: { taskId: "1.1", expected: "checked", observed: "checked", updateStatus: "written" }, diagnostics: [], source: "summary" },
      { taskId: "1.2", title: "Check", kind: "checkpoint", status: "running", requirementIds: [], activity: "validating", evidence: [], diagnostics: [], source: "summary" },
      { taskId: "1.3", title: "Optional", kind: "task", status: "skipped", optional: true, requirementIds: [], evidence: [], diagnostics: [], source: "summary" },
    ],
    blockers: [{ taskId: "1.4", taskTitle: "Blocked", type: "missing_dependency", tried: ["checked service"], risk: "service missing", options: ["provide service"], neededFromUser: "service URL" }],
    mutationWarnings: [{ severity: "error", message: "tasks.md changed outside writer", affectedPath: "tasks.md", affectedTaskIds: ["1.2"], failClosed: true }],
    executionReport: { status: "blocked", mode: "full", completedTaskCount: 1, remainingTaskCount: 1, skippedOptionalTaskCount: 1, changedFilesCount: 2, validationCommands: [{ command: "npm test", status: "passed", summary: "ok" }], blockerCount: 1, summaryText: "blocked", jsonPath: ".workflow/report.json" },
    diagnostics: [{ level: "warning", code: "unknown-kind", message: "Unknown kind rendered safely." }],
    safeCommands: ["/brainstorm-pro --status"],
  };
}

test("renders task timeline statuses and skipped optional", () => {
  const output = renderExecutionView(model(), 120).join("\n");
  assert.match(output, /completed task/);
  assert.match(output, /running checkpoint/);
  assert.match(output, /skipped optional/);
});

test("renders current task paths and validation details", () => {
  const output = renderExecutionView(model(), 120).join("\n");
  assert.match(output, /Output: \.workflow\/out\.txt/);
  assert.match(output, /Evidence path: \.workflow\/evidence\.txt/);
  assert.match(output, /Validation: passed npm run typecheck/);
});

test("renders checkpoint-as-task wording without approval-gate wording", () => {
  const output = renderExecutionView(model(), 120).join("\n");
  assert.match(output, /Checkpoints are execution validation tasks, not user approval gates/);
  assert.doesNotMatch(output, /approve checkpoint/i);
});

test("narrow width truncates without throwing", () => {
  const lines = renderExecutionView(model(), 30);
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => line.length <= 40));
});

test("renders checkbox, mutation warning, blocker, and report details", () => {
  const output = renderExecutionView(model(), 120).join("\n");
  assert.match(output, /expected checked, observed checked, update written/);
  assert.match(output, /tasks\.md changed outside writer/);
  assert.match(output, /Execution remains fail-closed/);
  assert.match(output, /Risk: service missing/);
  assert.match(output, /Report: blocked/);
  assert.match(output, /JSON report: \.workflow\/report\.json/);
});

test("does not expose unsupported execution controls", () => {
  const output = renderExecutionView(model(), 120).join("\n");
  assert.doesNotMatch(output, /retry|abort|continue|mark-complete|resolve/i);
});

test("renders done card and unavailable report diagnostic", () => {
  const done = { ...model(), phase: "done" as const, status: "completed" as const, executionReport: undefined };
  const output = renderExecutionView(done, 120).join("\n");
  assert.match(output, /Report unavailable/);
  assert.match(output, /Done: controlled execution is complete/);
});

test("renders unknown diagnostics", () => {
  const output = renderExecutionView(model(), 120).join("\n");
  assert.match(output, /WARNING unknown-kind/);
});
