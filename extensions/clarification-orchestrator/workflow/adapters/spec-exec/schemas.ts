import path from "node:path";
import type { AgentOutputSchema } from "../../../runtime/agent-execution/types.ts";
import type { ParsedTask } from "./task-plan-parser.ts";

export type ExecutionBlockerType =
  | "conflict"
  | "underspecified"
  | "validation_failure"
  | "scope_change"
  | "destructive_op"
  | "missing_dependency";

export type ExecutionBlocker = {
  task: string;
  type: ExecutionBlockerType;
  context: {
    taskExcerpt: string;
    requirements: string;
  };
  tried: string[];
  risk: string;
  options: string[];
  neededFromUser: string;
};

export type SingleTaskExecutionResult = {
  kind: "single-task-result";
  taskId: string;
  status: "completed" | "blocked" | "failed";
  changedFiles: string[];
  summary: string;
  validation: {
    commands: Array<{
      command: string;
      status: "passed" | "failed" | "not-run";
      summary: string;
    }>;
    evidence: string[];
  };
  blocker?: ExecutionBlocker;
  error?: {
    kind: string;
    message: string;
    retryable: boolean;
  };
};

export type TaskRunRecord = {
  taskId: string;
  title: string;
  kind: ParsedTask["kind"];
  status: "completed" | "skipped" | "blocked" | "failed";
  startedAt: string;
  completedAt?: string;
  agentRunId?: string;
  changedFiles: string[];
  evidence: string[];
};

export type ExecutionReportOutput = {
  kind: "execution-report";
  topic: string;
  status: "completed" | "blocked" | "failed";
  mode: "mvp" | "full";
  taskRuns: TaskRunRecord[];
  completedTasks: string[];
  remainingTasks: string[];
  skippedOptionalTasks: string[];
  changedFiles: string[];
  validationCommands: Array<{
    command: string;
    status: "passed" | "failed" | "not-run";
    summary: string;
  }>;
  blockers: ExecutionBlocker[];
  summary: string;
};

export function createSingleTaskExecutionResultSchema(task: ParsedTask): AgentOutputSchema<SingleTaskExecutionResult> {
  return {
    name: "SingleTaskExecutionResult",
    parse(raw) {
      return JSON.parse(raw) as unknown;
    },
    validate(value) {
      return validateSingleTaskExecutionResult(value, task);
    },
  };
}

export function validateSingleTaskExecutionResult(result: unknown, task: ParsedTask): SingleTaskExecutionResult {
  const output = asRecord(result);
  if (output.kind !== "single-task-result") throw new Error("Single-task result kind must be single-task-result.");
  if (output.taskId !== task.id) throw new Error(`Single-task result taskId must match ${task.id}.`);

  const status = asString(output.status, "status");
  if (status !== "completed" && status !== "blocked" && status !== "failed") throw new Error("Single-task result status must be completed, blocked, or failed.");

  const changedFiles = asStringArray(output.changedFiles, "changedFiles").map(validateRelativeProjectPath);
  const summary = asString(output.summary, "summary");
  const validation = asValidation(output.validation);
  const blocker = output.blocker === undefined ? undefined : asExecutionBlocker(output.blocker, task);
  const error = output.error === undefined ? undefined : asExecutionError(output.error);

  if (status === "completed") {
    if (!validation.evidence.length) throw new Error("Completed task results must include validation evidence.");
    if (task.kind === "checkpoint" && validation.evidence.length === 0) throw new Error("Checkpoint tasks require validation evidence.");
  }
  if (status === "blocked" && !blocker) throw new Error("Blocked task results must include a blocker.");
  if (status === "failed" && !error) throw new Error("Failed task results must include an error.");

  return {
    kind: "single-task-result",
    taskId: output.taskId,
    status,
    changedFiles,
    summary,
    validation,
    ...(blocker ? { blocker } : {}),
    ...(error ? { error } : {}),
  };
}

export function createExecutionBlocker(input: ExecutionBlocker): ExecutionBlocker {
  return input;
}

export function createTaskExecutionBlocker(task: ParsedTask, type: ExecutionBlockerType, input: Omit<ExecutionBlocker, "task" | "type">): ExecutionBlocker {
  return {
    task: `${task.id} ${task.title}`,
    type,
    context: input.context,
    tried: input.tried,
    risk: input.risk,
    options: input.options,
    neededFromUser: input.neededFromUser,
  };
}

export function blockerFromError(task: ParsedTask, type: ExecutionBlockerType, message: string): ExecutionBlocker {
  return createTaskExecutionBlocker(task, type, {
    context: { taskExcerpt: task.originalLine, requirements: task.requirementIds.join(", ") || "No requirement ids parsed." },
    tried: [message],
    risk: "Proceeding would violate controlled execution fail-closed rules.",
    options: ["Resolve the blocker and resume execution.", "Abort this execution run."],
    neededFromUser: message,
  });
}

function asExecutionBlocker(value: unknown, task: ParsedTask): ExecutionBlocker {
  const output = asRecord(value);
  const type = asString(output.type, "blocker.type");
  if (!isExecutionBlockerType(type)) throw new Error("Blocker type is invalid.");
  return {
    task: asString(output.task, "blocker.task"),
    type,
    context: asBlockerContext(output.context),
    tried: asStringArray(output.tried, "blocker.tried"),
    risk: asString(output.risk, "blocker.risk"),
    options: asStringArray(output.options, "blocker.options"),
    neededFromUser: asString(output.neededFromUser, "blocker.neededFromUser"),
  };
}

function asBlockerContext(value: unknown): ExecutionBlocker["context"] {
  const output = asRecord(value);
  return {
    taskExcerpt: asString(output.taskExcerpt, "blocker.context.taskExcerpt"),
    requirements: asString(output.requirements, "blocker.context.requirements"),
  };
}

function asExecutionError(value: unknown): NonNullable<SingleTaskExecutionResult["error"]> {
  const output = asRecord(value);
  return {
    kind: asString(output.kind, "error.kind"),
    message: asString(output.message, "error.message"),
    retryable: asBoolean(output.retryable, "error.retryable"),
  };
}

function asValidation(value: unknown): SingleTaskExecutionResult["validation"] {
  const output = asRecord(value);
  return {
    commands: asValidationCommands(output.commands),
    evidence: asStringArray(output.evidence, "validation.evidence"),
  };
}

function asValidationCommands(value: unknown): SingleTaskExecutionResult["validation"]["commands"] {
  if (!Array.isArray(value)) throw new Error("validation.commands must be an array.");
  return value.map((entry, index) => {
    const output = asRecord(entry);
    const status = asString(output.status, `validation.commands[${index}].status`);
    if (status !== "passed" && status !== "failed" && status !== "not-run") throw new Error("validation.commands status is invalid.");
    return {
      command: asString(output.command, `validation.commands[${index}].command`),
      status,
      summary: asString(output.summary, `validation.commands[${index}].summary`),
    };
  });
}

function validateRelativeProjectPath(value: string): string {
  if (path.isAbsolute(value)) throw new Error("changedFiles must be relative project paths.");
  if (value.includes("..")) throw new Error("changedFiles must stay within the project root.");
  const normalized = path.posix.normalize(value.replace(/\\/gu, "/"));
  if (normalized === "tasks.md" || normalized.endsWith("/tasks.md") || normalized === "requirements.md" || normalized.endsWith("/requirements.md") || normalized === "design.md" || normalized.endsWith("/design.md")) {
    throw new Error("changedFiles cannot target approved requirements, design, or tasks artifacts.");
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Result must be an object.");
  return value as Record<string, unknown>;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string.`);
  if (!value.trim()) throw new Error(`${name} cannot be empty.`);
  return value;
}

function asStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) throw new Error(`${name} must be an array of strings.`);
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean.`);
  return value;
}

function isExecutionBlockerType(value: string): value is ExecutionBlockerType {
  return value === "conflict" || value === "underspecified" || value === "validation_failure" || value === "scope_change" || value === "destructive_op" || value === "missing_dependency";
}
