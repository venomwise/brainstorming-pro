import type { ExecutionTaskView } from "../execution-view-model.ts";
import { formatWorkflowDuration, shortenWorkflowDisplayPath } from "../formatters.ts";

export function renderCurrentTaskView(task: ExecutionTaskView): string[] {
  const lines = [`${task.taskId} ${task.title} [${task.kind}/${task.status}]`];
  if (task.activity) lines.push(`Activity: ${task.activity}`);
  if (task.durationMs !== undefined) lines.push(`Duration: ${formatWorkflowDuration(task.durationMs)}`);
  if (task.startedAt) lines.push(`Started: ${task.startedAt}`);
  if (task.completedAt) lines.push(`Completed: ${task.completedAt}`);
  if (task.agentRunId) lines.push(`Agent run: ${task.agentRunId}`);
  if (task.outputPath) lines.push(`Output: ${shortenWorkflowDisplayPath(task.outputPath, 80)}`);
  if (task.evidencePath) lines.push(`Evidence path: ${shortenWorkflowDisplayPath(task.evidencePath, 80)}`);
  for (const command of task.validation?.commands ?? []) lines.push(`Validation: ${command.status} ${command.command}${command.summary ? ` — ${command.summary}` : ""}`);
  for (const evidence of task.validation?.evidence ?? task.evidence) lines.push(`Evidence: ${evidence}`);
  return lines;
}
