import type { ExecutionTaskView } from "../execution-view-model.ts";
import { formatWorkflowStatusGlyph, shortenWorkflowDisplayPath } from "../formatters.ts";

export function renderTaskTimelineView(tasks: readonly ExecutionTaskView[], width: number): string[] {
  if (!tasks.length) return [];
  return tasks.map((task) => {
    const optional = task.optional || task.status === "skipped" ? " optional" : "";
    const kind = task.kind === "unknown" ? "unknown-kind" : task.kind;
    const path = task.evidencePath ?? task.outputPath;
    const pathHint = path ? ` • ${shortenWorkflowDisplayPath(path, Math.max(10, Math.floor(width / 3)))}` : "";
    const activity = task.activity ? ` — ${task.activity}` : "";
    return `${formatWorkflowStatusGlyph(task.status)} ${task.taskId} ${task.title} [${statusLabel(task.status)} ${kind}${optional}]${activity}${pathHint}`;
  });
}

export function statusLabel(status: string): string {
  switch (status) {
    case "pending": return "pending";
    case "running": return "running";
    case "completed": return "completed";
    case "skipped": return "skipped optional";
    case "blocked": return "blocked";
    case "failed": return "failed";
    default: return "unknown";
  }
}
