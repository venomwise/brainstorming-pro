import type { ExecutionViewModel } from "./execution-view-model.ts";
import { truncateWorkflowToWidth, visibleWorkflowWidth } from "./render-helpers.ts";

export type ExecutionFallbackOptions = {
  width?: number;
};

export function renderExecutionFallback(viewModel: ExecutionViewModel, options: ExecutionFallbackOptions = {}): string {
  const width = Math.max(20, options.width ?? 80);
  const lines: string[] = [];
  lines.push(`Execution: ${viewModel.status}${viewModel.mode ? ` (${viewModel.mode})` : ""}`);
  lines.push(`Tasks: ${viewModel.summary.completedTasks}/${viewModel.summary.totalTasks} completed, ${viewModel.summary.runningTasks} running, ${viewModel.summary.blockedTasks} blocked, ${viewModel.summary.failedTasks} failed`);
  if (viewModel.currentTask) lines.push(`Current task: ${viewModel.currentTask.taskId} ${viewModel.currentTask.title} [${viewModel.currentTask.status}]`);
  const blocker = viewModel.blockers[0];
  if (blocker) lines.push(`Blocked: ${blocker.task ?? [blocker.taskId, blocker.taskTitle].filter(Boolean).join(" ")} ${blocker.type}${blocker.risk ? ` — ${blocker.risk}` : ""}`);
  const warning = viewModel.mutationWarnings[0];
  if (warning) lines.push(`Mutation warning: ${warning.message}${warning.failClosed ? " (fail-closed)" : ""}`);
  if (viewModel.executionReport?.markdownPath ?? viewModel.executionReport?.jsonPath) lines.push(`Execution report: ${viewModel.executionReport.markdownPath ?? viewModel.executionReport.jsonPath}`);
  for (const diagnostic of viewModel.diagnostics) lines.push(`${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`);
  const commands = viewModel.safeCommands.length ? viewModel.safeCommands : ["/brainstorm-pro --status", "/brainstorm-pro --resume"];
  lines.push(`Safe next commands: ${commands.join("; ")}`);
  return lines.map((line) => fitLine(line, width)).join("\n");
}

function fitLine(line: string, width: number): string {
  if (visibleWorkflowWidth(line) <= width) return line;
  return truncateWorkflowToWidth(line, width);
}
