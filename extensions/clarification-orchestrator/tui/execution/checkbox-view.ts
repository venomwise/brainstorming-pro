import type { ExecutionTaskView } from "../execution-view-model.ts";

export function renderCheckboxView(tasks: readonly ExecutionTaskView[]): string[] {
  return tasks.flatMap((task) => {
    if (!task.checkbox) return [];
    const observed = task.checkbox.observed ? `, observed ${task.checkbox.observed}` : ", observed unavailable";
    const path = task.checkbox.path ? ` at ${task.checkbox.path}` : "";
    const message = task.checkbox.message ? ` — ${task.checkbox.message}` : "";
    return [`${task.taskId}: expected ${task.checkbox.expected}${observed}, update ${task.checkbox.updateStatus}${path}${message}`];
  });
}
