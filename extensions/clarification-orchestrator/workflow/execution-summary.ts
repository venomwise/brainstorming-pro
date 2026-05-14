import type { ExecutionBlockerType, ExecutionReportOutput } from "./adapters/spec-exec/schemas.ts";

export type WorkflowExecutionStatus = "not-started" | "running" | "blocked" | "failed" | "completed" | "unavailable";
export type WorkflowExecutionMode = "mvp" | "full";
export type ExecutionTaskKind = "task" | "checkpoint" | "phase" | "unknown";
export type ExecutionTaskStatus = "pending" | "running" | "completed" | "skipped" | "blocked" | "failed" | "unknown";
export type ExecutionCheckboxState = "unchecked" | "checked" | "unknown";
export type ExecutionCheckboxUpdateStatus = "not-needed" | "pending" | "written" | "failed" | "unauthorized-mutation-detected" | "unavailable";
export type ExecutionDiagnosticLevel = "info" | "warning" | "error";
export type ExecutionValidationCommandStatus = "passed" | "failed" | "not-run" | "unknown";

export type ExecutionValidationCommandSummary = {
  command: string;
  status: ExecutionValidationCommandStatus;
  summary?: string;
};

export type ExecutionValidationSummary = {
  commands: ExecutionValidationCommandSummary[];
  evidence: string[];
};

export type ExecutionCheckboxSummary = {
  taskId: string;
  expected: ExecutionCheckboxState;
  observed?: ExecutionCheckboxState;
  updateStatus: ExecutionCheckboxUpdateStatus;
  path?: string;
  message?: string;
};

export type ExecutionDisplayBlockerSummary = {
  taskId?: string;
  taskTitle?: string;
  task?: string;
  type: ExecutionBlockerType | "unknown";
  context?: {
    taskExcerpt?: string;
    requirements?: string;
  };
  tried: string[];
  risk?: string;
  options: string[];
  neededFromUser?: string;
  diagnostics?: ExecutionSummaryDiagnostic[];
};

export type ExecutionMutationWarningSummary = {
  message: string;
  severity: "info" | "warning" | "error";
  affectedPath?: string;
  affectedTaskIds: string[];
  failClosed?: boolean;
  diagnostics?: ExecutionSummaryDiagnostic[];
};

export type ExecutionReportSummary = {
  status: "completed" | "blocked" | "failed" | "unavailable" | "unknown";
  mode?: WorkflowExecutionMode;
  completedTaskCount?: number;
  remainingTaskCount?: number;
  skippedOptionalTaskCount?: number;
  changedFilesCount?: number;
  validationCommands: ExecutionValidationCommandSummary[];
  blockerCount?: number;
  summaryText?: string;
  jsonPath?: string;
  markdownPath?: string;
  diagnostics?: ExecutionSummaryDiagnostic[];
};

export type ExecutionTaskSummary = {
  taskId: string;
  title?: string;
  kind: ExecutionTaskKind;
  optional?: boolean;
  requirementIds: string[];
  status: ExecutionTaskStatus;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  durationMs?: number;
  activity?: string;
  agentRunId?: string;
  outputPath?: string;
  evidencePath?: string;
  evidence?: string[];
  changedFiles?: string[];
  checkbox?: ExecutionCheckboxSummary;
  validation?: ExecutionValidationSummary;
  blocker?: ExecutionDisplayBlockerSummary;
  diagnostics?: ExecutionSummaryDiagnostic[];
};

export type ExecutionSummaryDiagnostic = {
  level: ExecutionDiagnosticLevel;
  code: string;
  message: string;
  at?: string;
  details?: unknown;
};

export type ExecutionSafeCommandHint = {
  command: "/brainstorm-pro --resume" | "/brainstorm-pro --status" | string;
  reason?: string;
};

export type WorkflowExecutionSummary = {
  topic: string;
  runId: string;
  generatedAt: string;
  status: WorkflowExecutionStatus;
  mode?: WorkflowExecutionMode;
  currentTaskId?: string;
  tasks: ExecutionTaskSummary[];
  checkboxes: ExecutionCheckboxSummary[];
  blockers: ExecutionDisplayBlockerSummary[];
  mutationWarnings: ExecutionMutationWarningSummary[];
  report?: ExecutionReportSummary;
  diagnostics: ExecutionSummaryDiagnostic[];
  safeCommands: ExecutionSafeCommandHint[];
};

export type CreateEmptyWorkflowExecutionSummaryInput = {
  topic: string;
  runId: string;
  generatedAt?: string;
  status?: WorkflowExecutionStatus;
  mode?: WorkflowExecutionMode;
  diagnostics?: ExecutionSummaryDiagnostic[];
  safeCommands?: ExecutionSafeCommandHint[];
};

export function createEmptyWorkflowExecutionSummary(input: CreateEmptyWorkflowExecutionSummaryInput): WorkflowExecutionSummary {
  return {
    topic: input.topic,
    runId: input.runId,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    status: input.status ?? "not-started",
    ...(input.mode ? { mode: input.mode } : {}),
    tasks: [],
    checkboxes: [],
    blockers: [],
    mutationWarnings: [],
    diagnostics: input.diagnostics ?? [],
    safeCommands: input.safeCommands ?? defaultExecutionSafeCommandHints(),
  };
}

export function defaultExecutionSafeCommandHints(): ExecutionSafeCommandHint[] {
  return [
    { command: "/brainstorm-pro --status", reason: "Inspect current workflow status." },
    { command: "/brainstorm-pro --resume", reason: "Resume through the runtime-owned workflow boundary." },
  ];
}

export function normalizeExecutionSummaryDiagnostic(input: Partial<ExecutionSummaryDiagnostic> & { message?: unknown; code?: unknown; level?: unknown }): ExecutionSummaryDiagnostic {
  const level = input.level === "warning" || input.level === "error" || input.level === "info" ? input.level : "warning";
  return {
    level,
    code: typeof input.code === "string" && input.code.trim() ? input.code : "execution-summary-diagnostic",
    message: typeof input.message === "string" && input.message.trim() ? input.message : "Execution summary diagnostic is unavailable.",
    ...(typeof input.at === "string" && input.at.trim() ? { at: input.at } : {}),
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}

export function summarizeExecutionReportOutput(report: ExecutionReportOutput, paths: { jsonPath?: string; markdownPath?: string } = {}): ExecutionReportSummary {
  return {
    status: report.status,
    mode: report.mode,
    completedTaskCount: report.completedTasks.length,
    remainingTaskCount: report.remainingTasks.length,
    skippedOptionalTaskCount: report.skippedOptionalTasks.length,
    changedFilesCount: report.changedFiles.length,
    validationCommands: report.validationCommands.map((command) => ({
      command: command.command,
      status: command.status,
      summary: command.summary,
    })),
    blockerCount: report.blockers.length,
    summaryText: report.summary,
    ...(paths.jsonPath ? { jsonPath: formatExecutionDisplayPath(paths.jsonPath) } : {}),
    ...(paths.markdownPath ? { markdownPath: formatExecutionDisplayPath(paths.markdownPath) } : {}),
  };
}

export function formatExecutionDisplayPath(filePath: string | undefined): string | undefined {
  const trimmed = filePath?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\\/gu, "/");
}

export function formatExecutionStatusLabel(status: WorkflowExecutionStatus | ExecutionTaskStatus | ExecutionCheckboxUpdateStatus | string | undefined): string {
  if (!status) return "unknown";
  return status.replace(/-/gu, " ");
}

export function executionDiagnosticForUnavailableEvidence(message: string, details?: unknown): ExecutionSummaryDiagnostic {
  return normalizeExecutionSummaryDiagnostic({
    level: "warning",
    code: "execution-evidence-unavailable",
    message,
    details,
  });
}
