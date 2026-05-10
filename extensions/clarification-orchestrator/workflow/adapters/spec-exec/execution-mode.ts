import fs from "node:fs/promises";
import path from "node:path";
import type { SpecExecAdapterContext } from "./context.ts";
import type { ParsedTaskPlan } from "./task-plan-parser.ts";

export type ExecutionMode = "mvp" | "full";

export type ExecutionModeDecision = {
  target: "execution";
  mode: ExecutionMode;
  selectedAt: string;
  selectedBy: "user";
  artifactVersions: {
    requirements: number;
    tasks: number;
  };
  path: string;
};

export type ExecutionModeResolution =
  | { status: "ready"; mode: ExecutionMode; decision?: ExecutionModeDecision; optionalTaskCount: number }
  | { status: "decision-required"; optionalTaskCount: number; choices: ExecutionMode[]; decisionPath: string };

export async function resolveExecutionMode(context: SpecExecAdapterContext, plan: ParsedTaskPlan): Promise<ExecutionModeResolution> {
  const optionalTaskCount = plan.tasks.filter((task) => task.optional).length;
  if (optionalTaskCount === 0) return { status: "ready", mode: "full", optionalTaskCount };

  const decisionPath = executionModeDecisionAbsolutePath(context);
  try {
    const raw = await fs.readFile(decisionPath, "utf8");
    const decision = validateExecutionModeDecision(JSON.parse(raw) as unknown, context);
    return { status: "ready", mode: decision.mode, decision, optionalTaskCount };
  } catch (error: unknown) {
    if (isNotFound(error)) {
      return { status: "decision-required", optionalTaskCount, choices: ["mvp", "full"], decisionPath: path.relative(context.topicDir, decisionPath) };
    }
    throw error;
  }
}

export function validateExecutionModeDecision(decision: unknown, context: SpecExecAdapterContext): ExecutionModeDecision {
  const output = asRecord(decision);
  if (output.target !== "execution") throw new Error("Execution mode decision target must be execution.");
  const mode = output.mode;
  if (mode !== "mvp" && mode !== "full") throw new Error("Execution mode decision must be mvp or full.");
  if (output.selectedBy !== "user") throw new Error("Execution mode decision must be selected by user.");
  const artifactVersions = asRecord(output.artifactVersions);
  if (artifactVersions.requirements !== context.approvedRequirements.ref.version || artifactVersions.tasks !== context.approvedTasks.ref.version) {
    throw new Error("Execution mode decision references stale requirements or tasks artifacts.");
  }
  const selectedAt = asString(output.selectedAt, "selectedAt");
  const decisionPath = asString(output.path, "path");
  if (path.isAbsolute(decisionPath) || decisionPath.includes("..")) throw new Error("Execution mode decision path must be topic-relative.");

  return {
    target: "execution",
    mode,
    selectedAt,
    selectedBy: "user",
    artifactVersions: {
      requirements: context.approvedRequirements.ref.version,
      tasks: context.approvedTasks.ref.version,
    },
    path: decisionPath,
  };
}

export async function persistExecutionModeDecision(context: SpecExecAdapterContext, mode: ExecutionMode, date = new Date()): Promise<ExecutionModeDecision> {
  const decisionPath = executionModeDecisionAbsolutePath(context);
  const decision: ExecutionModeDecision = {
    target: "execution",
    mode,
    selectedAt: date.toISOString(),
    selectedBy: "user",
    artifactVersions: {
      requirements: context.approvedRequirements.ref.version,
      tasks: context.approvedTasks.ref.version,
    },
    path: path.relative(context.topicDir, decisionPath),
  };
  await fs.mkdir(path.dirname(decisionPath), { recursive: true });
  await fs.writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`);
  return decision;
}

export function isTaskExecutableInMode(task: { optional: boolean }, mode: ExecutionMode): boolean {
  return mode === "full" || !task.optional;
}

function executionModeDecisionAbsolutePath(context: SpecExecAdapterContext): string {
  return path.join(context.layout.decisionsDir, "execution-mode.json");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Execution mode decision must be an object.");
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
