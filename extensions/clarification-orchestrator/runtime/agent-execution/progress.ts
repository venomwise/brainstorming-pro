import type { AgentProgressEvent, AgentRunError, AgentRunStatus, AgentRole } from "./types.ts";
import { createAgentRunError } from "./types.ts";

export type AgentProgressCallback = (event: AgentProgressEvent) => void | Promise<void>;

export function agentStarted(agentRunId: string, role: AgentRole, at = new Date().toISOString()): AgentProgressEvent {
  return { type: "agent.started", agentRunId, role, at };
}

export function agentOutput(agentRunId: string, stream: "stdout" | "stderr", bytes: number, at = new Date().toISOString()): AgentProgressEvent {
  return { type: "agent.output", agentRunId, stream, bytes, at };
}

export function agentRetrying(agentRunId: string, attempt: number, reason: string, at = new Date().toISOString()): AgentProgressEvent {
  return { type: "agent.retrying", agentRunId, attempt, reason, at };
}

export function agentCompleted(agentRunId: string, status: AgentRunStatus, at = new Date().toISOString()): AgentProgressEvent {
  return { type: "agent.completed", agentRunId, status, at };
}

export function agentFailed(agentRunId: string, error: AgentRunError, at = new Date().toISOString()): AgentProgressEvent {
  return { type: "agent.failed", agentRunId, error, at };
}

export async function emitAgentProgress(
  callback: AgentProgressCallback | undefined,
  event: AgentProgressEvent,
  diagnostics: string[] = [],
): Promise<void> {
  if (!callback) return;
  try {
    await callback(event);
  } catch (error) {
    const failure = createAgentRunError(
      "progress-callback-failed",
      `Agent progress callback failed for ${event.type}: ${error instanceof Error ? error.message : String(error)}`,
    );
    diagnostics.push(failure.message);
  }
}
