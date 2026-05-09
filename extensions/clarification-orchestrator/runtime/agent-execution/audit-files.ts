import { writeWorkflowAtomicJson } from "../../workflow/atomic-json.ts";
import type { AgentOutputCaptureSummary, AgentRole, AgentRunAttempt, AgentRunError, AgentRunPaths, AgentRunStatus } from "./types.ts";

const SENSITIVE_ENV_PATTERN = /(?:KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL|COOKIE)/iu;

export type AgentRunMetadata = {
  agentRunId: string;
  role: AgentRole;
  phase: string;
  purpose?: string;
  status: AgentRunStatus;
  startedAt: string;
  completedAt: string;
  attempts: number;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  outputCapture?: AgentOutputCaptureSummary;
  attemptRecords?: AgentRunAttempt[];
  error?: AgentRunError;
  diagnostics?: string[];
};

export function redactEnvForMetadata(env: NodeJS.ProcessEnv, allowlist: string[]): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const key of allowlist) {
    const value = env[key];
    if (value === undefined) continue;
    redacted[key] = SENSITIVE_ENV_PATTERN.test(key) ? "[REDACTED]" : value;
  }
  return redacted;
}

export async function writeAgentMetadata(paths: AgentRunPaths, metadata: AgentRunMetadata): Promise<void> {
  if (!paths.metadataPath) throw new Error("Cannot write agent metadata without metadataPath.");
  await writeWorkflowAtomicJson(paths.metadataPath, metadata);
}

export async function writeAgentResult(paths: AgentRunPaths, result: object): Promise<void> {
  if (!paths.resultPath) throw new Error("Cannot write agent result without resultPath.");
  await writeWorkflowAtomicJson(paths.resultPath, result);
}
