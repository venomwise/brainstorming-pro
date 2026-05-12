import { runAgent } from "../../runtime/agent-execution/run-agent.ts";
import type { AgentProgressEvent, AgentRunRequest, AgentRunResult } from "../../runtime/agent-execution/types.ts";
import { agentProgressToWorkflowProgress } from "../progress-adapters.ts";
import type { WorkflowProgressEvent } from "../progress-types.ts";
import type { WorkflowState, WorkflowPhase } from "../types.ts";

export type RunAgentFunction = <TOutput>(request: AgentRunRequest<TOutput>) => Promise<AgentRunResult<TOutput>>;

export type AgentBackedAdapterOptions = {
  projectRoot: string;
  model: string;
  runAgent?: RunAgentFunction;
  onWorkflowProgress?: (event: WorkflowProgressEvent) => void | Promise<void>;
};

export function resolveRunAgent(options: AgentBackedAdapterOptions): RunAgentFunction {
  return options.runAgent ?? runAgent;
}

export function workflowAgentProgressCallback(options: AgentBackedAdapterOptions, state: WorkflowState, phase: WorkflowPhase = state.phase): ((event: AgentProgressEvent) => void | Promise<void>) | undefined {
  if (!options.onWorkflowProgress) {
    return undefined;
  }
  return async (event: AgentProgressEvent): Promise<void> => {
    try {
      await options.onWorkflowProgress?.(agentProgressToWorkflowProgress(event, { topic: state.topic, runId: state.runId, phase }));
    } catch {
      // Progress emission is presentation-only; agent execution must not fail because UI progress failed.
    }
  };
}

export function agentFailureResult(result: AgentRunResult<unknown>) {
  return {
    kind: "failed" as const,
    error: result.error ?? {
      kind: result.status,
      message: `Agent run ${result.status}.`,
      retryable: result.status === "timed-out" || result.status === "failed",
    },
  };
}
