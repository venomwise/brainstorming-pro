import type { AgentProgressEvent, AgentRunStatus, AgentRole } from "../runtime/agent-execution/types.ts";
import type { ReviewTarget, VersionedArtifactRef, WorkflowPhase } from "./types.ts";

export type WorkflowProgressStatus = "pending" | "running" | "completed" | "blocked" | "failed" | "stale";

export type WorkflowProgressIdentity = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  at: string;
};

export type PhaseProgressEvent = WorkflowProgressIdentity & (
  | {
      type: "phase.started";
      status?: "running";
      activity?: string;
    }
  | {
      type: "phase.activity";
      status?: "running";
      activity: string;
      output?: string;
    }
  | {
      type: "phase.completed";
      status: "completed" | "blocked" | "failed";
      output?: string;
      evidence?: string;
    }
);

export type AgentWorkflowProgressEvent = WorkflowProgressIdentity & {
  type: "agent.progress";
  agentRunId: string;
  role?: AgentRole;
  status: AgentRunStatus | "started" | "output" | "retrying";
  attempt?: number;
  outputBytes?: number;
  outputStream?: "stdout" | "stderr";
  output?: string;
  reason?: string;
  source: AgentProgressEvent;
};

export type ReviewerProgressStatus = "started" | "running" | "passed" | "blocked" | "failed" | "invalid-output" | "timed-out";

export type ReviewerProgressEvent = WorkflowProgressIdentity & {
  type: "reviewer.progress";
  reviewRunId: string;
  target: Extract<ReviewTarget, "design" | "plan">;
  reviewerId: string;
  status: ReviewerProgressStatus;
  findingCount?: number;
  failureReason?: string;
  outputPath?: string;
  evidence?: string;
};

export type PlanReviewProgressEvent = WorkflowProgressIdentity & {
  type: "plan-review.progress";
  reviewRunId: string;
  target: "plan";
  reviewerId?: "requirements-coverage-reviewer" | "task-coverage-reviewer" | "dependency-order-reviewer";
  status: ReviewerProgressStatus | "aggregating";
  findingCount?: number;
  failureReason?: string;
  evidence?: string;
};

export type ExecutionTaskProgressEvent = WorkflowProgressIdentity & {
  type: "task.progress";
  taskId: string;
  title?: string;
  status: "started" | "running" | "completed" | "blocked" | "failed";
  activity?: string;
  evidencePath?: string;
  outputPath?: string;
  evidence?: string;
};

export type ArtifactProgressEvent = WorkflowProgressIdentity & {
  type: "artifact.progress";
  artifact: VersionedArtifactRef;
  status: "drafting" | "created" | "updated" | "validated" | "failed";
  outputPath?: string;
  evidence?: string;
};

export type WorkflowProgressEvent =
  | PhaseProgressEvent
  | AgentWorkflowProgressEvent
  | ReviewerProgressEvent
  | PlanReviewProgressEvent
  | ExecutionTaskProgressEvent
  | ArtifactProgressEvent;

export type WorkflowLivePhaseStatus = "idle" | "running" | "awaiting-user" | "blocked" | "failed" | "done";

export type WorkflowPhaseSnapshot = {
  phase: WorkflowPhase;
  status: WorkflowLivePhaseStatus | WorkflowProgressStatus;
  startedAt?: string;
  completedAt?: string;
  activity?: string;
};

export type WorkflowActivitySnapshot = {
  id: string;
  kind: "phase" | "agent" | "reviewer" | "plan-review" | "task" | "artifact" | "diagnostic";
  label: string;
  status: string;
  startedAt?: string;
  updatedAt?: string;
  output?: string;
};

export type ArtifactSnapshot = {
  kind: VersionedArtifactRef["kind"];
  version: number;
  path: string;
  checksum: string;
  createdAt?: string;
  status?: string;
};

export type AgentRunSnapshot = {
  agentRunId: string;
  role?: AgentRole;
  status: AgentRunStatus | "started" | "output" | "retrying" | "running";
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  attempt?: number;
  outputBytes?: number;
  outputPath?: string;
  summary?: string;
};

export type ReviewerRunSnapshot = {
  reviewRunId: string;
  target: Extract<ReviewTarget, "design" | "plan">;
  reviewerId: string;
  status: ReviewerProgressStatus;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  findingCount?: number;
  failureReason?: string;
  outputPath?: string;
};

export type TaskProgressSnapshot = {
  taskId: string;
  title?: string;
  status: "started" | "running" | "completed" | "blocked" | "failed";
  activity?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  evidencePath?: string;
  outputPath?: string;
};

export type GateCardSnapshot = {
  id: string;
  gate: "design-review-decision" | "design-approval" | "plan-review-decision" | "plan-approval" | "blocked" | "failed" | "done";
  title: string;
  status: WorkflowLivePhaseStatus;
  artifacts: ArtifactSnapshot[];
  message?: string;
  safeCommands: string[];
  stale?: boolean;
  staleReason?: string;
  opaqueContext?: unknown;
};

export type DiagnosticSnapshot = {
  level: "info" | "warning" | "error";
  message: string;
  code?: string;
  at?: string;
  details?: unknown;
};

export type WorkflowLiveSnapshot = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  phaseStatus: WorkflowLivePhaseStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  stale: boolean;
  staleReason?: string;
  fallbackText: string;
  timeline: WorkflowPhaseSnapshot[];
  currentActivity?: WorkflowActivitySnapshot;
  artifacts: ArtifactSnapshot[];
  agents: AgentRunSnapshot[];
  reviewers: ReviewerRunSnapshot[];
  tasks: TaskProgressSnapshot[];
  gates: GateCardSnapshot[];
  diagnostics: DiagnosticSnapshot[];
};

export type WorkflowProgressEventClassification =
  | { valid: true; event: WorkflowProgressEvent }
  | { valid: false; reason: "not-object" | "missing-type" | "missing-topic" | "missing-run-id" | "missing-phase" | "missing-timestamp" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasStringField(value: Record<string, unknown>, field: string): boolean {
  return typeof value[field] === "string" && value[field].length > 0;
}

export function classifyWorkflowProgressEvent(value: unknown): WorkflowProgressEventClassification {
  if (!isRecord(value)) {
    return { valid: false, reason: "not-object" };
  }
  if (!hasStringField(value, "type")) {
    return { valid: false, reason: "missing-type" };
  }
  if (!hasStringField(value, "topic")) {
    return { valid: false, reason: "missing-topic" };
  }
  if (!hasStringField(value, "runId")) {
    return { valid: false, reason: "missing-run-id" };
  }
  if (!hasStringField(value, "phase")) {
    return { valid: false, reason: "missing-phase" };
  }
  if (!hasStringField(value, "at")) {
    return { valid: false, reason: "missing-timestamp" };
  }
  return { valid: true, event: value as WorkflowProgressEvent };
}

export function isWorkflowProgressEventForRun(value: unknown, topic: string, runId: string): value is WorkflowProgressEvent {
  const classified = classifyWorkflowProgressEvent(value);
  return classified.valid && classified.event.topic === topic && classified.event.runId === runId;
}

export function progressEventTimestamp(event: WorkflowProgressEvent): string {
  return event.at;
}

export function progressEventKey(event: WorkflowProgressEvent): string {
  switch (event.type) {
    case "agent.progress":
      return `${event.topic}:${event.runId}:${event.phase}:${event.type}:${event.agentRunId}:${event.status}:${event.at}`;
    case "reviewer.progress":
      return `${event.topic}:${event.runId}:${event.phase}:${event.type}:${event.reviewRunId}:${event.reviewerId}:${event.status}:${event.at}`;
    case "plan-review.progress":
      return `${event.topic}:${event.runId}:${event.phase}:${event.type}:${event.reviewRunId}:${event.reviewerId ?? "aggregate"}:${event.status}:${event.at}`;
    case "task.progress":
      return `${event.topic}:${event.runId}:${event.phase}:${event.type}:${event.taskId}:${event.status}:${event.at}`;
    case "artifact.progress":
      return `${event.topic}:${event.runId}:${event.phase}:${event.type}:${event.artifact.kind}:${event.artifact.version}:${event.status}:${event.at}`;
    case "phase.started":
    case "phase.activity":
    case "phase.completed":
      return `${event.topic}:${event.runId}:${event.phase}:${event.type}:${event.status ?? "running"}:${event.at}`;
  }
}
