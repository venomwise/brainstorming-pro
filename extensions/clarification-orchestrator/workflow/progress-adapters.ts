import type { AgentProgressEvent, AgentRole } from "../runtime/agent-execution/types.ts";
import type { VersionedArtifactRef, WorkflowPhase } from "./types.ts";
import type {
  ArtifactProgressEvent,
  DiagnosticSnapshot,
  ExecutionTaskProgressEvent,
  PhaseProgressEvent,
  PlanReviewProgressEvent,
  ReviewerProgressEvent,
  WorkflowProgressEvent,
} from "./progress-types.ts";

type WorkflowProgressEmitter = (event: WorkflowProgressEvent) => void | Promise<void>;

type WorkflowProgressAdapterContext = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  now?: () => string;
};

export type WorkflowProgressEmitResult =
  | { ok: true }
  | { ok: false; diagnostic: DiagnosticSnapshot };

function timestamp(context: WorkflowProgressAdapterContext): string {
  return context.now ? context.now() : new Date().toISOString();
}

export function agentProgressToWorkflowProgress(
  event: AgentProgressEvent,
  context: WorkflowProgressAdapterContext & { role?: AgentRole },
): WorkflowProgressEvent {
  switch (event.type) {
    case "agent.started":
      return {
        type: "agent.progress",
        topic: context.topic,
        runId: context.runId,
        phase: context.phase,
        at: event.at,
        agentRunId: event.agentRunId,
        role: event.role,
        status: "started",
        source: event,
      };
    case "agent.output":
      return {
        type: "agent.progress",
        topic: context.topic,
        runId: context.runId,
        phase: context.phase,
        at: event.at,
        agentRunId: event.agentRunId,
        role: context.role,
        status: "output",
        outputBytes: event.bytes,
        outputStream: event.stream,
        source: event,
      };
    case "agent.retrying":
      return {
        type: "agent.progress",
        topic: context.topic,
        runId: context.runId,
        phase: context.phase,
        at: event.at,
        agentRunId: event.agentRunId,
        role: context.role,
        status: "retrying",
        attempt: event.attempt,
        reason: event.reason,
        source: event,
      };
    case "agent.completed":
      return {
        type: "agent.progress",
        topic: context.topic,
        runId: context.runId,
        phase: context.phase,
        at: event.at,
        agentRunId: event.agentRunId,
        role: context.role,
        status: event.status,
        source: event,
      };
    case "agent.failed":
      return {
        type: "agent.progress",
        topic: context.topic,
        runId: context.runId,
        phase: context.phase,
        at: event.at,
        agentRunId: event.agentRunId,
        role: context.role,
        status: "failed",
        reason: event.error.message,
        source: event,
      };
  }
}

export function createSafeWorkflowProgressEmitter(emit: WorkflowProgressEmitter, now: () => string = () => new Date().toISOString()): (event: WorkflowProgressEvent) => Promise<WorkflowProgressEmitResult> {
  return async (event: WorkflowProgressEvent): Promise<WorkflowProgressEmitResult> => {
    try {
      await emit(event);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        diagnostic: {
          level: "warning",
          code: "workflow-progress-emit-failed",
          message: `Workflow progress callback failed: ${error instanceof Error ? error.message : String(error)}`,
          at: now(),
        },
      };
    }
  };
}

export function phaseProgress(
  context: WorkflowProgressAdapterContext,
  input: Omit<PhaseProgressEvent, "topic" | "runId" | "phase" | "at"> & { at?: string },
): PhaseProgressEvent {
  return { ...input, topic: context.topic, runId: context.runId, phase: context.phase, at: input.at ?? timestamp(context) } as PhaseProgressEvent;
}

export function reviewerProgress(
  context: WorkflowProgressAdapterContext,
  input: Omit<ReviewerProgressEvent, "type" | "topic" | "runId" | "phase" | "at"> & { at?: string },
): ReviewerProgressEvent {
  return { ...input, type: "reviewer.progress", topic: context.topic, runId: context.runId, phase: context.phase, at: input.at ?? timestamp(context) };
}

export function planReviewProgress(
  context: WorkflowProgressAdapterContext,
  input: Omit<PlanReviewProgressEvent, "type" | "topic" | "runId" | "phase" | "target" | "at"> & { at?: string },
): PlanReviewProgressEvent {
  return { ...input, type: "plan-review.progress", target: "plan", topic: context.topic, runId: context.runId, phase: context.phase, at: input.at ?? timestamp(context) };
}

export function taskProgress(
  context: WorkflowProgressAdapterContext,
  input: Omit<ExecutionTaskProgressEvent, "type" | "topic" | "runId" | "phase" | "at"> & { at?: string },
): ExecutionTaskProgressEvent {
  return { ...input, type: "task.progress", topic: context.topic, runId: context.runId, phase: context.phase, at: input.at ?? timestamp(context) };
}

export function artifactProgress(
  context: WorkflowProgressAdapterContext,
  artifact: VersionedArtifactRef,
  input: Omit<ArtifactProgressEvent, "type" | "topic" | "runId" | "phase" | "artifact" | "at"> & { at?: string },
): ArtifactProgressEvent {
  return { ...input, type: "artifact.progress", topic: context.topic, runId: context.runId, phase: context.phase, artifact, at: input.at ?? timestamp(context) };
}
