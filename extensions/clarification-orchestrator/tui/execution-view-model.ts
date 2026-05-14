import type { WorkflowLiveSnapshot, TaskProgressSnapshot } from "../workflow/progress-types.ts";
import type { WorkflowPhase } from "../workflow/types.ts";
import type { ExecutionCheckboxSummary, ExecutionDiagnosticLevel, ExecutionDisplayBlockerSummary, ExecutionMutationWarningSummary, ExecutionReportSummary, ExecutionSafeCommandHint, ExecutionTaskKind, ExecutionTaskStatus, ExecutionValidationSummary, WorkflowExecutionMode, WorkflowExecutionStatus, WorkflowExecutionSummary } from "../workflow/execution-summary.ts";

export type ExecutionViewModel = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  generatedAt: string;
  status: WorkflowExecutionStatus;
  mode?: WorkflowExecutionMode;
  summary: ExecutionSummaryView;
  currentTask?: ExecutionTaskView;
  taskTimeline: ExecutionTaskView[];
  blockers: ExecutionBlockerView[];
  mutationWarnings: ExecutionMutationWarningView[];
  executionReport?: ExecutionReportView;
  diagnostics: ExecutionDiagnosticView[];
  safeCommands: string[];
};

export type ExecutionSummaryView = {
  totalTasks: number;
  completedTasks: number;
  runningTasks: number;
  pendingTasks: number;
  skippedTasks: number;
  blockedTasks: number;
  failedTasks: number;
};

export type ExecutionTaskView = {
  taskId: string;
  title: string;
  kind: ExecutionTaskKind;
  status: ExecutionTaskStatus;
  optional?: boolean;
  requirementIds: string[];
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  durationMs?: number;
  activity?: string;
  agentRunId?: string;
  outputPath?: string;
  evidencePath?: string;
  evidence: string[];
  checkbox?: ExecutionCheckboxSummary;
  validation?: ExecutionValidationSummary;
  blocker?: ExecutionBlockerView;
  diagnostics: ExecutionDiagnosticView[];
  source: "summary" | "snapshot";
};

export type ExecutionBlockerView = ExecutionDisplayBlockerSummary;
export type ExecutionMutationWarningView = ExecutionMutationWarningSummary;
export type ExecutionReportView = ExecutionReportSummary;

export type ExecutionDiagnosticView = {
  level: ExecutionDiagnosticLevel;
  code: string;
  message: string;
  at?: string;
  details?: unknown;
};

export type BuildExecutionViewModelInput = {
  snapshot: WorkflowLiveSnapshot;
  summary?: WorkflowExecutionSummary;
};

export function buildExecutionViewModel(input: BuildExecutionViewModelInput): ExecutionViewModel | undefined {
  const diagnostics: ExecutionDiagnosticView[] = [];
  const summary = isSummaryForSnapshot(input.summary, input.snapshot, diagnostics) ? input.summary : undefined;
  if (!summary && !input.snapshot.tasks.length) return undefined;

  if (!summary) {
    diagnostics.push({ level: "info", code: "execution-summary-unavailable", message: "Runtime execution summary is unavailable; showing live task progress only." });
  }

  const taskTimeline = summary ? summary.tasks.map((task) => ({
    taskId: task.taskId,
    title: task.title ?? "Untitled execution task",
    kind: normalizeTaskKind(task.kind, diagnostics, task.taskId),
    status: normalizeTaskStatus(task.status, diagnostics, task.taskId),
    ...(task.optional === undefined ? {} : { optional: task.optional }),
    requirementIds: task.requirementIds,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.durationMs === undefined ? {} : { durationMs: task.durationMs }),
    ...(task.activity ? { activity: task.activity } : {}),
    ...(task.agentRunId ? { agentRunId: task.agentRunId } : {}),
    ...(task.outputPath ? { outputPath: task.outputPath } : {}),
    ...(task.evidencePath ? { evidencePath: task.evidencePath } : {}),
    evidence: task.evidence ?? [],
    ...(task.checkbox ? { checkbox: task.checkbox } : {}),
    ...(task.validation ? { validation: task.validation } : {}),
    ...(task.blocker ? { blocker: task.blocker } : {}),
    diagnostics: task.diagnostics ?? [],
    source: "summary" as const,
  })) : input.snapshot.tasks.map(snapshotTaskToView);

  if (summary) addLiveHints(taskTimeline, input.snapshot.tasks);

  const currentTask = findCurrentTask(taskTimeline, summary?.currentTaskId);
  const safeCommands = summary ? summary.safeCommands.map(formatSafeCommand) : ["/brainstorm-pro --status", "/brainstorm-pro --resume"];
  return {
    topic: input.snapshot.topic,
    runId: input.snapshot.runId,
    phase: input.snapshot.phase,
    generatedAt: summary?.generatedAt ?? input.snapshot.updatedAt,
    status: summary?.status ?? statusFromSnapshotTasks(input.snapshot.tasks),
    ...(summary?.mode ? { mode: summary.mode } : {}),
    summary: summarizeTasks(taskTimeline),
    ...(currentTask ? { currentTask } : {}),
    taskTimeline,
    blockers: summary?.blockers ?? taskTimeline.flatMap((task) => task.blocker ? [task.blocker] : []),
    mutationWarnings: summary?.mutationWarnings ?? [],
    ...(summary?.report ? { executionReport: summary.report } : {}),
    diagnostics: [...diagnostics, ...(summary?.diagnostics ?? [])],
    safeCommands,
  };
}

function isSummaryForSnapshot(summary: WorkflowExecutionSummary | undefined, snapshot: WorkflowLiveSnapshot, diagnostics: ExecutionDiagnosticView[]): summary is WorkflowExecutionSummary {
  if (!summary) return false;
  if (summary.topic !== snapshot.topic || summary.runId !== snapshot.runId) {
    diagnostics.push({ level: "warning", code: "execution-context-mismatch", message: "Execution summary context does not match the live snapshot; summary evidence is not shown as current.", details: { summaryTopic: summary.topic, snapshotTopic: snapshot.topic, summaryRunId: summary.runId, snapshotRunId: snapshot.runId } });
    return false;
  }
  return true;
}

function snapshotTaskToView(task: TaskProgressSnapshot): ExecutionTaskView {
  return {
    taskId: task.taskId,
    title: task.title ?? "Untitled execution task",
    kind: "unknown",
    status: task.status === "started" ? "running" : task.status,
    requirementIds: [],
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.updatedAt ? { updatedAt: task.updatedAt } : {}),
    ...(task.completedAt ? { completedAt: task.completedAt } : {}),
    ...(task.activity ? { activity: task.activity } : {}),
    ...(task.outputPath ? { outputPath: task.outputPath } : {}),
    ...(task.evidencePath ? { evidencePath: task.evidencePath } : {}),
    evidence: [],
    diagnostics: [{ level: "info", code: "execution-task-summary-unavailable", message: "Task is shown from live progress; durable execution details are unavailable." }],
    source: "snapshot",
  };
}

function addLiveHints(tasks: ExecutionTaskView[], snapshots: TaskProgressSnapshot[]): void {
  const byId = new Map(snapshots.map((task) => [task.taskId, task]));
  for (const task of tasks) {
    const live = byId.get(task.taskId);
    if (!live) continue;
    if (!task.activity && live.activity) task.activity = live.activity;
    if (!task.updatedAt && live.updatedAt) task.updatedAt = live.updatedAt;
  }
}

function normalizeTaskKind(kind: ExecutionTaskKind, diagnostics: ExecutionDiagnosticView[], taskId: string): ExecutionTaskKind {
  if (kind === "task" || kind === "checkpoint" || kind === "phase" || kind === "unknown") return kind;
  diagnostics.push({ level: "warning", code: "execution-task-kind-unknown", message: `Task ${taskId} has an unknown kind.` });
  return "unknown";
}

function normalizeTaskStatus(status: ExecutionTaskStatus, diagnostics: ExecutionDiagnosticView[], taskId: string): ExecutionTaskStatus {
  if (["pending", "running", "completed", "skipped", "blocked", "failed", "unknown"].includes(status)) return status;
  diagnostics.push({ level: "warning", code: "execution-task-status-unknown", message: `Task ${taskId} has an unknown status.` });
  return "unknown";
}

function statusFromSnapshotTasks(tasks: TaskProgressSnapshot[]): WorkflowExecutionStatus {
  if (!tasks.length) return "unavailable";
  if (tasks.some((task) => task.status === "blocked")) return "blocked";
  if (tasks.some((task) => task.status === "failed")) return "failed";
  if (tasks.some((task) => task.status === "running" || task.status === "started")) return "running";
  if (tasks.every((task) => task.status === "completed")) return "completed";
  return "running";
}

function findCurrentTask(tasks: ExecutionTaskView[], currentTaskId?: string): ExecutionTaskView | undefined {
  if (currentTaskId) return tasks.find((task) => task.taskId === currentTaskId);
  return tasks.find((task) => task.status === "running") ?? tasks.find((task) => task.status === "blocked" || task.status === "failed") ?? tasks.at(-1);
}

function summarizeTasks(tasks: ExecutionTaskView[]): ExecutionSummaryView {
  return {
    totalTasks: tasks.length,
    completedTasks: tasks.filter((task) => task.status === "completed").length,
    runningTasks: tasks.filter((task) => task.status === "running").length,
    pendingTasks: tasks.filter((task) => task.status === "pending").length,
    skippedTasks: tasks.filter((task) => task.status === "skipped").length,
    blockedTasks: tasks.filter((task) => task.status === "blocked").length,
    failedTasks: tasks.filter((task) => task.status === "failed").length,
  };
}

function formatSafeCommand(hint: ExecutionSafeCommandHint): string {
  return hint.reason ? `${hint.command} — ${hint.reason}` : hint.command;
}
