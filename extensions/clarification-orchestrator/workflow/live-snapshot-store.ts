import type { WorkflowRuntimeStatus } from "./runtime.ts";
import type { WorkflowState } from "./types.ts";
import {
  classifyWorkflowProgressEvent,
  progressEventKey,
  type ArtifactSnapshot,
  type DiagnosticSnapshot,
  type GateCardSnapshot,
  type WorkflowActivitySnapshot,
  type WorkflowLivePhaseStatus,
  type WorkflowLiveSnapshot,
  type WorkflowPhaseSnapshot,
  type WorkflowProgressEvent,
} from "./progress-types.ts";

type WorkflowSnapshotInput = WorkflowState | WorkflowRuntimeStatus;

type WorkflowProgressListener = (snapshot: WorkflowLiveSnapshot) => void;

export type WorkflowProgressControllerOptions = {
  topic: string;
  runId: string;
  throttleMs?: number;
  now?: () => string;
};

export class WorkflowProgressController {
  private readonly topic: string;
  private readonly runId: string;
  private readonly throttleMs: number;
  private readonly now: () => string;
  private readonly events: WorkflowProgressEvent[] = [];
  private readonly diagnostics: DiagnosticSnapshot[] = [];
  private readonly listeners = new Set<WorkflowProgressListener>();
  private closed = false;
  private version = 0;
  private lastSnapshot?: WorkflowLiveSnapshot;
  private notifyTimer?: NodeJS.Timeout;

  constructor(options: WorkflowProgressControllerOptions) {
    this.topic = options.topic;
    this.runId = options.runId;
    this.throttleMs = options.throttleMs ?? 100;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  emit(value: unknown): boolean {
    const classified = classifyWorkflowProgressEvent(value);
    if (!classified.valid) {
      this.recordDiagnostic("warning", `Ignored malformed workflow progress event: ${classified.reason}`, "malformed-progress");
      return false;
    }

    const event = classified.event;
    if (event.topic !== this.topic || event.runId !== this.runId) {
      this.recordDiagnostic("warning", "Ignored workflow progress event for a different topic or run.", "stale-progress-context");
      return false;
    }

    if (this.closed) {
      this.recordDiagnostic("warning", "Ignored workflow progress event emitted after controller close.", "late-progress-after-close");
      return false;
    }

    const previous = this.events.at(-1);
    const previousKey = previous ? progressEventKey(previous) : undefined;
    const nextKey = progressEventKey(event);
    if (previousKey === nextKey) {
      return true;
    }
    if (previous && shouldCoalesceProgressEvent(previous, event)) {
      this.events[this.events.length - 1] = coalesceProgressEvent(previous, event);
      this.version += 1;
      this.scheduleNotify();
      return true;
    }

    this.events.push(event);
    this.version += 1;
    this.scheduleNotify();
    return true;
  }

  getSnapshot(runtimeStateOrStatus: WorkflowSnapshotInput): WorkflowLiveSnapshot {
    const snapshot = buildWorkflowLiveSnapshot(runtimeStateOrStatus, {
      version: this.version,
      now: this.now(),
      events: this.events,
      diagnostics: this.diagnostics,
      closed: this.closed,
      expectedTopic: this.topic,
      expectedRunId: this.runId,
    });
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  subscribe(listener: WorkflowProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.closed = true;
    if (this.notifyTimer) {
      clearTimeout(this.notifyTimer);
      this.notifyTimer = undefined;
    }
    this.notifyListeners();
  }

  dispose(): void {
    this.close();
    this.listeners.clear();
    this.events.length = 0;
  }

  private scheduleNotify(): void {
    if (this.throttleMs <= 0) {
      this.notifyListeners();
      return;
    }
    if (this.notifyTimer) {
      return;
    }
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined;
      this.notifyListeners();
    }, this.throttleMs);
  }

  private notifyListeners(): void {
    if (!this.lastSnapshot) {
      return;
    }
    for (const listener of this.listeners) {
      try {
        listener(this.lastSnapshot);
      } catch (error) {
        this.recordDiagnostic("warning", `Workflow progress listener failed: ${error instanceof Error ? error.message : String(error)}`, "progress-listener-failed");
      }
    }
  }

  private recordDiagnostic(level: DiagnosticSnapshot["level"], message: string, code: string): void {
    this.diagnostics.push({ level, message, code, at: this.now() });
    this.version += 1;
  }
}

function shouldCoalesceProgressEvent(previous: WorkflowProgressEvent, next: WorkflowProgressEvent): boolean {
  if (previous.topic !== next.topic || previous.runId !== next.runId || previous.phase !== next.phase) {
    return false;
  }
  if (previous.type === "agent.progress" && next.type === "agent.progress") {
    return previous.agentRunId === next.agentRunId && previous.status === "output" && next.status === "output" && previous.outputStream === next.outputStream;
  }
  if (previous.type === "phase.activity" && next.type === "phase.activity") {
    return true;
  }
  if (previous.type === "task.progress" && next.type === "task.progress") {
    return previous.taskId === next.taskId && previous.status === "running" && next.status === "running";
  }
  return false;
}

function coalesceProgressEvent(previous: WorkflowProgressEvent, next: WorkflowProgressEvent): WorkflowProgressEvent {
  if (previous.type === "agent.progress" && next.type === "agent.progress") {
    return {
      ...next,
      outputBytes: (previous.outputBytes ?? 0) + (next.outputBytes ?? 0),
      output: next.output ?? previous.output,
    };
  }
  return next;
}

function buildWorkflowLiveSnapshot(
  input: WorkflowSnapshotInput,
  context: {
    version: number;
    now: string;
    events: readonly WorkflowProgressEvent[];
    diagnostics: readonly DiagnosticSnapshot[];
    closed: boolean;
    expectedTopic: string;
    expectedRunId: string;
  },
): WorkflowLiveSnapshot {
  const staleReasons: string[] = [];
  const diagnostics = [...context.diagnostics];
  if (input.topic !== context.expectedTopic || input.runId !== context.expectedRunId) {
    staleReasons.push("Snapshot context does not match controller topic/run.");
    diagnostics.push({
      level: "warning",
      code: "snapshot-context-mismatch",
      message: "Durable workflow state does not match this live progress controller context.",
      at: context.now,
    });
  }
  for (const event of context.events) {
    if (event.phase !== input.phase && event.type !== "phase.completed") {
      diagnostics.push({
        level: "info",
        code: "live-progress-phase-differs-from-durable-state",
        message: `Live progress for ${event.phase} did not override durable phase ${input.phase}.`,
        at: context.now,
      });
      break;
    }
  }

  const artifacts = artifactSnapshotsFromInput(input, context.events);
  if (pendingDecisionHasStaleArtifactBinding(input, artifacts)) {
    staleReasons.push("Pending decision references artifact bindings that are not present in the durable artifact summary.");
    diagnostics.push({
      level: "warning",
      code: "stale-gate-artifact-binding",
      message: "Snapshot gate data was marked stale because artifact bindings could not be verified from durable state.",
      at: context.now,
    });
  }
  const stale = staleReasons.length > 0;

  const phaseStatus = phaseStatusFromInput(input.phase);
  const timeline = timelineFromInput(input, context.events, phaseStatus);
  const gates = gateCardsFromInput(input, artifacts);
  const liveDetails = liveDetailSnapshots(context.events);
  const currentActivity = currentActivityFromEvents(context.events) ?? {
    id: `phase:${input.phase}`,
    kind: "phase" as const,
    label: latestActivity(context.events) ?? `Workflow phase: ${input.phase}`,
    status: phaseStatus,
    updatedAt: "updatedAt" in input ? input.updatedAt : context.now,
  };

  return {
    topic: input.topic,
    runId: input.runId,
    phase: input.phase,
    phaseStatus,
    version: context.version,
    createdAt: "createdAt" in input ? input.createdAt : context.now,
    updatedAt: "updatedAt" in input ? input.updatedAt : context.now,
    stale,
    ...(stale ? { staleReason: staleReasons.join(" ") } : {}),
    fallbackText: `Workflow ${input.topic} is ${input.phase}.`,
    timeline,
    currentActivity,
    artifacts,
    agents: liveDetails.agents,
    reviewers: liveDetails.reviewers,
    tasks: liveDetails.tasks,
    gates,
    diagnostics,
  };
}

function phaseStatusFromInput(phase: WorkflowSnapshotInput["phase"]): WorkflowLivePhaseStatus {
  if (phase === "done") {
    return "done";
  }
  if (phase === "blocked") {
    return "blocked";
  }
  if (phase === "failed") {
    return "failed";
  }
  if (phase.startsWith("awaiting-")) {
    return "awaiting-user";
  }
  return "running";
}

function artifactSnapshotsFromInput(input: WorkflowSnapshotInput, events: readonly WorkflowProgressEvent[]): ArtifactSnapshot[] {
  const snapshots = new Map<string, ArtifactSnapshot>();
  for (const artifact of Object.values(input.artifacts).filter((value): value is NonNullable<typeof value> => value !== undefined)) {
    snapshots.set(`${artifact.kind}:${artifact.version}`, {
      kind: artifact.kind,
      version: artifact.version,
      path: artifact.path,
      checksum: artifact.checksum,
      createdAt: artifact.createdAt,
      status: "durable",
    });
  }
  for (const event of events) {
    if (event.type !== "artifact.progress") {
      continue;
    }
    const key = `${event.artifact.kind}:${event.artifact.version}`;
    if (!snapshots.has(key)) {
      snapshots.set(key, {
        kind: event.artifact.kind,
        version: event.artifact.version,
        path: event.artifact.path,
        checksum: event.artifact.checksum,
        createdAt: event.artifact.createdAt,
        status: event.status,
      });
    }
  }
  return [...snapshots.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.version - right.version);
}

function timelineFromInput(input: WorkflowSnapshotInput, events: readonly WorkflowProgressEvent[], phaseStatus: WorkflowLivePhaseStatus): WorkflowPhaseSnapshot[] {
  const snapshots = new Map<string, WorkflowPhaseSnapshot>();
  for (const event of events) {
    if (!event.type.startsWith("phase.")) {
      continue;
    }
    const existing = snapshots.get(event.phase) ?? { phase: event.phase, status: "pending" as const };
    if (event.type === "phase.started") {
      snapshots.set(event.phase, { ...existing, status: "running", startedAt: existing.startedAt ?? event.at, activity: event.activity ?? existing.activity });
    } else if (event.type === "phase.activity") {
      snapshots.set(event.phase, { ...existing, status: "running", activity: event.activity });
    } else if (event.type === "phase.completed") {
      snapshots.set(event.phase, { ...existing, status: event.status, completedAt: event.at, activity: event.output ?? event.evidence ?? existing.activity });
    }
  }
  snapshots.set(input.phase, {
    ...(snapshots.get(input.phase) ?? { phase: input.phase }),
    phase: input.phase,
    status: phaseStatus,
    activity: latestActivity(events),
  });
  return [...snapshots.values()];
}

function liveDetailSnapshots(events: readonly WorkflowProgressEvent[]): Pick<WorkflowLiveSnapshot, "agents" | "reviewers" | "tasks"> {
  const agents = new Map<string, WorkflowLiveSnapshot["agents"][number]>();
  const reviewers = new Map<string, WorkflowLiveSnapshot["reviewers"][number]>();
  const tasks = new Map<string, WorkflowLiveSnapshot["tasks"][number]>();

  for (const event of events) {
    if (event.type === "agent.progress") {
      const existing = agents.get(event.agentRunId);
      agents.set(event.agentRunId, {
        agentRunId: event.agentRunId,
        role: event.role ?? existing?.role,
        status: event.status,
        startedAt: existing?.startedAt ?? event.at,
        updatedAt: event.at,
        completedAt: event.status === "succeeded" || event.status === "failed" || event.status === "timed-out" || event.status === "invalid-output" ? event.at : existing?.completedAt,
        attempt: event.attempt ?? existing?.attempt,
        outputBytes: (existing?.outputBytes ?? 0) + (event.outputBytes ?? 0),
        summary: event.reason ?? event.output ?? existing?.summary,
      });
    } else if (event.type === "reviewer.progress" || event.type === "plan-review.progress") {
      const reviewerId = event.type === "plan-review.progress" ? event.reviewerId ?? "plan-review-aggregate" : event.reviewerId;
      const key = `${event.reviewRunId}:${reviewerId}`;
      const existing = reviewers.get(key);
      reviewers.set(key, {
        reviewRunId: event.reviewRunId,
        target: event.target,
        reviewerId,
        status: event.status === "aggregating" ? "running" : event.status,
        startedAt: existing?.startedAt ?? event.at,
        updatedAt: event.at,
        completedAt: ["passed", "blocked", "failed", "invalid-output", "timed-out"].includes(event.status) ? event.at : existing?.completedAt,
        findingCount: event.findingCount ?? existing?.findingCount,
        failureReason: event.failureReason ?? existing?.failureReason,
        outputPath: "outputPath" in event ? event.outputPath ?? existing?.outputPath : existing?.outputPath,
      });
    } else if (event.type === "task.progress") {
      const existing = tasks.get(event.taskId);
      tasks.set(event.taskId, {
        taskId: event.taskId,
        title: event.title ?? existing?.title,
        status: event.status,
        activity: event.activity ?? existing?.activity,
        startedAt: existing?.startedAt ?? event.at,
        updatedAt: event.at,
        completedAt: event.status === "completed" || event.status === "blocked" || event.status === "failed" ? event.at : existing?.completedAt,
        evidencePath: event.evidencePath ?? existing?.evidencePath,
        outputPath: event.outputPath ?? existing?.outputPath,
      });
    }
  }

  return { agents: [...agents.values()], reviewers: [...reviewers.values()], tasks: [...tasks.values()] };
}

function latestActivity(events: readonly WorkflowProgressEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (!event) continue;
    if ("activity" in event && typeof event.activity === "string") {
      return event.activity;
    }
    if (event.type === "phase.completed") {
      return event.output ?? event.evidence;
    }
  }
  return undefined;
}

function currentActivityFromEvents(events: readonly WorkflowProgressEvent[]): WorkflowActivitySnapshot | undefined {
  const event = events.at(-1);
  if (!event) {
    return undefined;
  }
  return {
    id: progressEventKey(event),
    kind: event.type.startsWith("agent.") ? "agent" : event.type.startsWith("reviewer.") ? "reviewer" : event.type.startsWith("task.") ? "task" : event.type.startsWith("artifact.") ? "artifact" : event.type.startsWith("plan-review.") ? "plan-review" : "phase",
    label: "activity" in event && typeof event.activity === "string" ? event.activity : event.type,
    status: "status" in event && typeof event.status === "string" ? event.status : "running",
    updatedAt: event.at,
    output: "output" in event && typeof event.output === "string" ? event.output : undefined,
  };
}

function pendingDecisionHasStaleArtifactBinding(input: WorkflowSnapshotInput, artifacts: readonly ArtifactSnapshot[]): boolean {
  if (!input.pendingDecision) {
    return false;
  }
  const durableKeys = new Set(artifacts.map((artifact) => `${artifact.kind}:${artifact.version}:${artifact.checksum}`));
  return input.pendingDecision.artifacts.some((artifact) => !durableKeys.has(`${artifact.kind}:${artifact.version}:${artifact.checksum}`));
}

function gateCardsFromInput(input: WorkflowSnapshotInput, artifacts: ArtifactSnapshot[]): GateCardSnapshot[] {
  if (input.phase === "done") {
    return [{ id: "done", gate: "done", title: "Workflow complete", status: "done", artifacts, safeCommands: [] }];
  }
  if (input.phase === "blocked" || input.phase === "failed") {
    return [{
      id: input.phase,
      gate: input.phase,
      title: input.phase === "blocked" ? "Workflow blocked" : "Workflow failed",
      status: input.phase,
      artifacts,
      message: input.lastError?.message,
      safeCommands: [`/brainstorm-pro --resume ${input.topic}`],
    }];
  }
  if (!input.pendingDecision) {
    return [];
  }
  const gate = input.pendingDecision.type === "review-decision"
    ? input.pendingDecision.target === "design" ? "design-review-decision" : "plan-review-decision"
    : input.pendingDecision.gate === "design" ? "design-approval" : "plan-approval";
  return [{
    id: gate,
    gate,
    title: input.pendingDecision.type === "review-decision" ? `${input.pendingDecision.target} review decision required` : `${input.pendingDecision.gate} approval required`,
    status: "awaiting-user",
    artifacts,
    safeCommands: [`/brainstorm-pro --resume ${input.topic}`],
  }];
}
