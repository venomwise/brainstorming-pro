import { runAgent } from "../../runtime/agent-execution/run-agent.ts";
import type { AgentRunRequest, AgentRunResult } from "../../runtime/agent-execution/types.ts";

export type RunAgentFunction = <TOutput>(request: AgentRunRequest<TOutput>) => Promise<AgentRunResult<TOutput>>;

export type AgentBackedAdapterOptions = {
  projectRoot: string;
  model: string;
  runAgent?: RunAgentFunction;
};

export function resolveRunAgent(options: AgentBackedAdapterOptions): RunAgentFunction {
  return options.runAgent ?? runAgent;
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
