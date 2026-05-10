import fs from "node:fs/promises";
import path from "node:path";
import type { SpecExecAdapterContext } from "./context.ts";
import { isTaskExecutableInMode, resolveExecutionMode, type ExecutionMode } from "./execution-mode.ts";
import { parseTaskPlan, type MalformedTaskPlanEntry, type ParsedTask, type ParsedTaskPlan } from "./task-plan-parser.ts";

export type TaskSelection =
  | { kind: "execute"; task: ParsedTask }
  | { kind: "complete-phase"; task: ParsedTask }
  | { kind: "none" };

export type ExecutionLoopResult =
  | { status: "completed"; mode: ExecutionMode; plan: ParsedTaskPlan }
  | { status: "decision-required"; optionalTaskCount: number; choices: ExecutionMode[]; decisionPath: string }
  | { status: "ready"; mode: ExecutionMode; selection: Extract<TaskSelection, { kind: "execute" | "complete-phase" }>; plan: ParsedTaskPlan }
  | { status: "blocked"; reason: string; malformed?: MalformedTaskPlanEntry[] };

export function selectNextExecutableTask(plan: ParsedTaskPlan, mode: ExecutionMode): TaskSelection {
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));

  for (const task of plan.tasks) {
    if (task.completed) continue;
    if (!isTaskExecutableInMode(task, mode)) continue;

    if (task.kind === "phase") {
      const executableChildren = task.children.map((childId) => byId.get(childId)).filter((child): child is ParsedTask => Boolean(child)).filter((child) => isTaskExecutableInMode(child, mode));
      if (executableChildren.length === 0) return { kind: "execute", task };
      if (executableChildren.some((child) => !child.completed)) continue;
      return { kind: "complete-phase", task };
    }

    return { kind: "execute", task };
  }

  return { kind: "none" };
}

export function hasAllExecutableChildrenComplete(task: ParsedTask, plan: ParsedTaskPlan, mode: ExecutionMode): boolean {
  const byId = new Map(plan.tasks.map((entry) => [entry.id, entry]));
  const executableChildren = task.children.map((childId) => byId.get(childId)).filter((child): child is ParsedTask => Boolean(child)).filter((child) => isTaskExecutableInMode(child, mode));
  return executableChildren.length > 0 && executableChildren.every((child) => child.completed);
}

export async function runExecutionLoop(context: SpecExecAdapterContext): Promise<ExecutionLoopResult> {
  const initialPlan = parseTaskPlan(await readCurrentTasksMarkdown(context));
  if (initialPlan.malformed.length > 0) return { status: "blocked", reason: "malformed-task-plan", malformed: initialPlan.malformed };

  const modeResolution = await resolveExecutionMode(context, initialPlan);
  if (modeResolution.status === "decision-required") {
    return {
      status: "decision-required",
      optionalTaskCount: modeResolution.optionalTaskCount,
      choices: modeResolution.choices,
      decisionPath: modeResolution.decisionPath,
    };
  }

  const plan = parseTaskPlan(await readCurrentTasksMarkdown(context));
  if (plan.malformed.length > 0) return { status: "blocked", reason: "malformed-task-plan", malformed: plan.malformed };
  const selection = selectNextExecutableTask(plan, modeResolution.mode);
  if (selection.kind === "none") return { status: "completed", mode: modeResolution.mode, plan };
  return { status: "ready", mode: modeResolution.mode, selection, plan };
}

async function readCurrentTasksMarkdown(context: SpecExecAdapterContext): Promise<string> {
  return fs.readFile(path.join(context.topicDir, "tasks.md"), "utf8");
}
