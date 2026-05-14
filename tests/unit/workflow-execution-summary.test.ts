import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorkflowExecutionSummary, executionDiagnosticForUnavailableEvidence, normalizeExecutionSummaryDiagnostic, summarizeExecutionReportOutput, type ExecutionMutationWarningSummary, type ExecutionTaskSummary } from "../../extensions/clarification-orchestrator/workflow/execution-summary.ts";
import type { ExecutionReportOutput } from "../../extensions/clarification-orchestrator/workflow/adapters/spec-exec/schemas.ts";

test("creates empty display-safe execution summary", () => {
  const summary = createEmptyWorkflowExecutionSummary({ topic: "demo-topic", runId: "run-1", generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(summary.topic, "demo-topic");
  assert.equal(summary.runId, "run-1");
  assert.equal(summary.status, "not-started");
  assert.deepEqual(summary.tasks, []);
  assert.deepEqual(summary.checkboxes, []);
  assert.ok(summary.safeCommands.some((hint) => hint.command === "/brainstorm-pro --status"));
});

test("normalizes and preserves diagnostics", () => {
  assert.deepEqual(normalizeExecutionSummaryDiagnostic({ level: "error", code: "bad-report", message: "Malformed report", details: { path: "x" } }), {
    level: "error",
    code: "bad-report",
    message: "Malformed report",
    details: { path: "x" },
  });
  assert.equal(executionDiagnosticForUnavailableEvidence("Missing optional evidence").code, "execution-evidence-unavailable");
});

test("summarizes execution report output", () => {
  const report: ExecutionReportOutput = {
    kind: "execution-report",
    topic: "demo-topic",
    status: "blocked",
    mode: "full",
    taskRuns: [],
    completedTasks: ["1.1"],
    remainingTasks: ["1.2"],
    skippedOptionalTasks: [],
    changedFiles: ["src/a.ts", "src/b.ts"],
    validationCommands: [{ command: "npm test", status: "passed", summary: "ok" }],
    blockers: [{ task: "1.2 Next", type: "missing_dependency", context: { taskExcerpt: "x", requirements: "1.2" }, tried: ["checked"], risk: "missing service", options: ["provide service"], neededFromUser: "service" }],
    summary: "Stopped on dependency.",
  };
  const summary = summarizeExecutionReportOutput(report, { jsonPath: ".workflow/runs/run-1/execution-report.json" });
  assert.equal(summary.status, "blocked");
  assert.equal(summary.completedTaskCount, 1);
  assert.equal(summary.remainingTaskCount, 1);
  assert.equal(summary.changedFilesCount, 2);
  assert.equal(summary.blockerCount, 1);
  assert.equal(summary.validationCommands[0]?.command, "npm test");
  assert.equal(summary.jsonPath, ".workflow/runs/run-1/execution-report.json");
});

test("task, checkbox, and mutation warning summaries are serializable display data", () => {
  const task: ExecutionTaskSummary = {
    taskId: "1.1",
    title: "Implement thing",
    kind: "task",
    optional: false,
    requirementIds: ["1.1"],
    status: "completed",
    checkbox: { taskId: "1.1", expected: "checked", observed: "checked", updateStatus: "written" },
    validation: { commands: [{ command: "npm run typecheck", status: "passed", summary: "clean" }], evidence: ["typecheck passed"] },
  };
  const warning: ExecutionMutationWarningSummary = {
    message: "tasks.md changed outside checkbox writer",
    severity: "error",
    affectedTaskIds: ["1.1"],
    failClosed: true,
  };
  assert.equal(JSON.parse(JSON.stringify(task)).checkbox.updateStatus, "written");
  assert.equal(JSON.parse(JSON.stringify(warning)).failClosed, true);
});

test("summary data does not expose mutation-like executable fields", () => {
  const summary = createEmptyWorkflowExecutionSummary({ topic: "demo-topic", runId: "run-1" }) as unknown as Record<string, unknown>;
  const forbidden = ["write", "mutate", "selectTask", "validateEvidence", "launchChild", "retry", "abort", "continue", "commitArtifact", "transition"];
  for (const key of forbidden) assert.equal(key in summary, false, key);
});
