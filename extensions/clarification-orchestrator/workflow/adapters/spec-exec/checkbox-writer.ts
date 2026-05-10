import fs from "node:fs/promises";
import path from "node:path";
import { appendWorkflowEvent } from "../../events.ts";
import type { SpecExecAdapterContext } from "./context.ts";
import type { ParsedTask } from "./task-plan-parser.ts";

export async function markTaskComplete(context: SpecExecAdapterContext, task: ParsedTask): Promise<void> {
  await markComplete(context, task, "task.completed");
}

export async function markPhaseComplete(context: SpecExecAdapterContext, task: ParsedTask): Promise<void> {
  if (task.kind !== "phase") throw new Error("Only phase tasks can be marked complete with markPhaseComplete.");
  await markComplete(context, task, "phase.completed");
}

async function markComplete(context: SpecExecAdapterContext, task: ParsedTask, eventType: "task.completed" | "phase.completed"): Promise<void> {
  if (task.completed) throw new Error(`Task ${task.id} is already complete.`);
  const nextLine = completedLine(task.originalLine);
  if (nextLine === task.originalLine) throw new Error(`Task ${task.id} does not have an incomplete checkbox marker.`);

  const tasksPath = path.join(context.topicDir, "tasks.md");
  const content = await fs.readFile(tasksPath, "utf8");
  const lines = content.split(/\r?\n/u);
  const index = task.lineNumber - 1;
  if (lines[index] !== task.originalLine) throw new Error(`Task ${task.id} original line no longer matches tasks.md.`);
  lines[index] = nextLine;
  await fs.writeFile(tasksPath, lines.join("\n"));
  await appendWorkflowEvent(context.layout, {
    type: eventType,
    phase: "executing",
    details: { taskId: task.id, title: task.title, kind: task.kind, lineNumber: task.lineNumber },
  });
}

function completedLine(line: string): string {
  if (line.includes("- [ ]*")) return line.replace("- [ ]*", "- [✅]*");
  if (line.includes("- [ ]")) return line.replace("- [ ]", "- [✅]");
  return line;
}
