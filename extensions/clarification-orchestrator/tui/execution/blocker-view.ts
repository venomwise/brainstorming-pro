import type { ExecutionBlockerView } from "../execution-view-model.ts";

export function renderBlockerView(blockers: readonly ExecutionBlockerView[], safeCommands: readonly string[]): string[] {
  const lines: string[] = [];
  for (const blocker of blockers) {
    const task = blocker.task ?? ([blocker.taskId, blocker.taskTitle].filter(Boolean).join(" ") || "unknown task");
    lines.push(`${task}: ${blocker.type}`);
    if (blocker.risk) lines.push(`Risk: ${blocker.risk}`);
    for (const tried of blocker.tried) lines.push(`Tried: ${tried}`);
    for (const option of blocker.options) lines.push(`Option: ${option}`);
    if (blocker.neededFromUser) lines.push(`Needed from user: ${blocker.neededFromUser}`);
  }
  for (const command of safeCommands) lines.push(`Safe command: ${command}`);
  return lines;
}
