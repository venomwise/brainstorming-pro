import type { ExecutionTaskView } from "../execution-view-model.ts";

export function renderCheckpointView(tasks: readonly ExecutionTaskView[]): string[] {
  const checkpoints = tasks.filter((task) => task.kind === "checkpoint");
  if (!checkpoints.length) return [];
  return [
    "Checkpoints are execution validation tasks, not user approval gates.",
    ...checkpoints.map((task) => `${task.taskId} ${task.title}: ${task.status}${task.activity ? ` — ${task.activity}` : ""}`),
  ];
}
