import type { AgentRunErrorKind, AgentRunLimits } from "./types.ts";

const RETRYABLE_ERROR_KINDS = new Set<AgentRunErrorKind>([
  "spawn-error",
  "timeout",
]);

export function isRetryableAgentError(kind: AgentRunErrorKind | undefined): boolean {
  return kind !== undefined && RETRYABLE_ERROR_KINDS.has(kind);
}

export function shouldRetryAgentRun(input: { attempt: number; limits: AgentRunLimits; errorKind?: AgentRunErrorKind }): boolean {
  return input.attempt <= input.limits.maxRetries && isRetryableAgentError(input.errorKind);
}
