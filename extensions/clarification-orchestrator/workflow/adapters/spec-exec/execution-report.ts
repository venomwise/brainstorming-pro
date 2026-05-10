import fs from "node:fs/promises";
import path from "node:path";
import { assertWorkflowPath } from "../../artifact-store.ts";
import type { SpecExecAdapterContext } from "./context.ts";
import type { ExecutionLoopResult } from "./execution-loop.ts";
import type { ExecutionReportOutput } from "./schemas.ts";

export type ExecutionReportRefs = {
  jsonPath: string;
  markdownPath: string;
};

export function buildExecutionReport(loopResult: ExecutionLoopResult, context: SpecExecAdapterContext): ExecutionReportOutput {
  const mode = loopResult.status === "decision-required" ? "full" : "mode" in loopResult ? loopResult.mode : "full";
  const plan = "plan" in loopResult ? loopResult.plan : undefined;
  return {
    kind: "execution-report",
    topic: context.topic,
    status: loopResult.status === "completed" ? "completed" : "blocked",
    mode,
    taskRuns: [],
    completedTasks: plan ? plan.tasks.filter((task) => task.completed).map((task) => task.id) : [],
    remainingTasks: plan ? plan.tasks.filter((task) => !task.completed && !(mode === "mvp" && task.optional)).map((task) => task.id) : [],
    skippedOptionalTasks: plan && mode === "mvp" ? plan.tasks.filter((task) => !task.completed && task.optional).map((task) => task.id) : [],
    changedFiles: [],
    validationCommands: [],
    blockers: [],
    summary: loopResult.status === "completed" ? "Execution completed." : `Execution stopped: ${loopResult.status}`,
  };
}

export async function writeExecutionReport(context: SpecExecAdapterContext, report: ExecutionReportOutput): Promise<ExecutionReportRefs> {
  const runDir = path.join(context.workflowDir, "runs", context.runId);
  assertWorkflowPath(context.layout, runDir);
  await fs.mkdir(runDir, { recursive: true });
  const jsonPath = path.join(runDir, "execution-report.json");
  const markdownPath = path.join(runDir, "execution-report.md");
  assertWorkflowPath(context.layout, jsonPath);
  assertWorkflowPath(context.layout, markdownPath);
  await fs.writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.writeFile(markdownPath, renderMarkdownReport(report));
  return {
    jsonPath: path.relative(context.topicDir, jsonPath),
    markdownPath: path.relative(context.topicDir, markdownPath),
  };
}

function renderMarkdownReport(report: ExecutionReportOutput): string {
  const blockerLines = report.blockers.length ? report.blockers.map((blocker) => `- ${blocker.type}: ${blocker.task} — ${blocker.risk}`).join("\n") : "None.";
  const runLines = report.taskRuns.length ? report.taskRuns.map((run) => `- ${run.taskId} ${run.title}: ${run.status}`).join("\n") : "None.";
  return `# Execution Report: ${report.topic}\n\n- Status: ${report.status}\n- Mode: ${report.mode}\n- Summary: ${report.summary}\n\n## Task Runs\n\n${runLines}\n\n## Completed Tasks\n\n${formatList(report.completedTasks)}\n\n## Remaining Tasks\n\n${formatList(report.remainingTasks)}\n\n## Skipped Optional Tasks\n\n${formatList(report.skippedOptionalTasks)}\n\n## Changed Files\n\n${formatList(report.changedFiles)}\n\n## Validation Commands\n\n${report.validationCommands.length ? report.validationCommands.map((command) => `- ${command.status}: \`${command.command}\` — ${command.summary}`).join("\n") : "None."}\n\n## Blockers\n\n${blockerLines}\n`;
}

function formatList(values: string[]): string {
  return values.length ? values.map((value) => `- ${value}`).join("\n") : "None.";
}
