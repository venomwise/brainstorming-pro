import type { ExecutionViewModel } from "../execution-view-model.ts";
import { truncateWorkflowToWidth, visibleWorkflowWidth } from "../render-helpers.ts";
import { renderBlockerView } from "./blocker-view.ts";
import { renderCheckboxView } from "./checkbox-view.ts";
import { renderCheckpointView } from "./checkpoint-view.ts";
import { renderCurrentTaskView } from "./current-task-view.ts";
import { renderExecutionReportView } from "./execution-report-view.ts";
import { renderMutationWarningView } from "./mutation-warning-view.ts";
import { renderTaskTimelineView } from "./task-timeline-view.ts";

export function renderExecutionView(viewModel: ExecutionViewModel, width: number): string[] {
  const lines: string[] = [];
  section(lines, "Summary", [
    `Status: ${viewModel.status}${viewModel.mode ? ` • mode ${viewModel.mode}` : ""}`,
    `Tasks: ${viewModel.summary.completedTasks}/${viewModel.summary.totalTasks} completed, ${viewModel.summary.runningTasks} running, ${viewModel.summary.blockedTasks} blocked, ${viewModel.summary.failedTasks} failed, ${viewModel.summary.skippedTasks} skipped`,
  ]);
  if (viewModel.currentTask) section(lines, "Current task", renderCurrentTaskView(viewModel.currentTask));
  section(lines, "Task timeline", renderTaskTimelineView(viewModel.taskTimeline, width));
  section(lines, "Checkpoint tasks", renderCheckpointView(viewModel.taskTimeline));
  section(lines, "Checkbox updates", renderCheckboxView(viewModel.taskTimeline));
  section(lines, "Mutation warnings", renderMutationWarningView(viewModel.mutationWarnings));
  section(lines, "Blockers and failures", renderBlockerView(viewModel.blockers, viewModel.safeCommands));
  section(lines, "Execution report", renderExecutionReportView(viewModel.executionReport, viewModel));
  if (viewModel.diagnostics.length) section(lines, "Execution diagnostics", viewModel.diagnostics.map((diagnostic) => `${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`));
  if (viewModel.safeCommands.length) section(lines, "Safe next commands", viewModel.safeCommands);
  return lines.map((line) => fitLine(line, width));
}

function section(lines: string[], title: string, body: string[]): void {
  if (!body.length) return;
  lines.push(`${title}:`);
  for (const line of body) lines.push(`- ${line}`);
}

function fitLine(line: string, width: number): string {
  if (visibleWorkflowWidth(line) <= width) return line;
  return truncateWorkflowToWidth(line, Math.max(0, width));
}
