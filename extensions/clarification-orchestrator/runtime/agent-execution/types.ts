import type { ArtifactKind, VersionedArtifactRef, WorkflowPhase, WorkflowState } from "../../workflow/types.ts";

export type AgentRole =
  | "design-author"
  | "design-reviser"
  | "plan-author"
  | "task-executor"
  | "minimal-reviewer"
  | "product-reviewer"
  | "architecture-reviewer"
  | "risk-security-reviewer"
  | "testing-reviewer"
  | "scope-simplicity-reviewer";

export type AgentResultKind = "artifact-draft" | "review-findings" | "execution-report";

export type ProviderQualifiedModel = string;

export type AgentWorkflowContext = {
  topic: string;
  runId: string;
  phase: WorkflowPhase;
  projectRoot: string;
  topicDir: string;
  artifacts: Partial<Record<ArtifactKind, VersionedArtifactRef>>;
  state?: WorkflowState;
};

export type AgentRunLimits = {
  timeoutMs: number;
  maxRetries: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  maxOutputBytes: number;
};

export type AgentOutputSchema<TOutput> = {
  name: string;
  parse(raw: string): unknown;
  validate(value: unknown): TOutput;
};

export type AgentRunStatus = "succeeded" | "failed" | "timed-out" | "invalid-output";

export type AgentRunErrorKind =
  | "pi-command-not-found"
  | "unsafe-launch-spec"
  | "spawn-error"
  | "non-zero-exit"
  | "signal"
  | "timeout"
  | "output-limit-exceeded"
  | "invalid-output"
  | "schema-validation-failed"
  | "role-not-allowed"
  | "model-policy-violation"
  | "recursion-depth-exceeded"
  | "progress-callback-failed"
  | "unexpected-error";

export type AgentRunError = {
  kind: AgentRunErrorKind;
  message: string;
  retryable: boolean;
  details?: unknown;
};

export type AgentRunPaths = {
  agentRunDir: string;
  promptPath?: string;
  systemPromptPath?: string;
  stdoutPath?: string;
  stderrPath?: string;
  rawOutputPath?: string;
  resultPath?: string;
  metadataPath?: string;
};

export type AgentOutputCaptureSummary = {
  stdoutBytes: number;
  stderrBytes: number;
  rawOutputBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  rawOutputTruncated: boolean;
};

export type AgentRunAttempt = {
  attempt: number;
  startedAt: string;
  completedAt?: string;
  status: AgentRunStatus;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  error?: AgentRunError;
  outputCapture?: AgentOutputCaptureSummary;
};

export type AgentProgressEvent =
  | { type: "agent.started"; agentRunId: string; role: AgentRole; at: string }
  | { type: "agent.output"; agentRunId: string; stream: "stdout" | "stderr"; bytes: number; at: string }
  | { type: "agent.retrying"; agentRunId: string; attempt: number; reason: string; at: string }
  | { type: "agent.completed"; agentRunId: string; status: AgentRunStatus; at: string }
  | { type: "agent.failed"; agentRunId: string; error: AgentRunError; at: string };

export type AgentRunRequest<TOutput> = {
  role: AgentRole;
  purpose: string;
  prompt: string;
  systemPrompt: string;
  model: ProviderQualifiedModel;
  workflow: AgentWorkflowContext;
  outputSchema: AgentOutputSchema<TOutput>;
  limits?: Partial<AgentRunLimits>;
  onProgress?: (event: AgentProgressEvent) => void | Promise<void>;
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
};

export type AgentRunResult<TOutput> = {
  agentRunId: string;
  role: AgentRole;
  status: AgentRunStatus;
  output?: TOutput;
  paths: AgentRunPaths;
  startedAt: string;
  completedAt: string;
  attempts: number;
  attemptRecords: AgentRunAttempt[];
  error?: AgentRunError;
  outputCapture: AgentOutputCaptureSummary;
  diagnostics?: string[];
};

export function emptyOutputCaptureSummary(): AgentOutputCaptureSummary {
  return {
    stdoutBytes: 0,
    stderrBytes: 0,
    rawOutputBytes: 0,
    stdoutTruncated: false,
    stderrTruncated: false,
    rawOutputTruncated: false,
  };
}

export function createAgentRunError(
  kind: AgentRunErrorKind,
  message: string,
  options: { retryable?: boolean; details?: unknown } = {},
): AgentRunError {
  return {
    kind,
    message,
    retryable: options.retryable ?? false,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}

export function createFailedAgentRunResult<TOutput>(input: {
  agentRunId: string;
  role: AgentRole;
  status?: AgentRunStatus;
  startedAt: string;
  completedAt?: string;
  paths: AgentRunPaths;
  attempts?: number;
  attemptRecords?: AgentRunAttempt[];
  error: AgentRunError;
  outputCapture?: AgentOutputCaptureSummary;
  diagnostics?: string[];
}): AgentRunResult<TOutput> {
  return {
    agentRunId: input.agentRunId,
    role: input.role,
    status: input.status ?? "failed",
    paths: input.paths,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? new Date().toISOString(),
    attempts: input.attempts ?? 0,
    attemptRecords: input.attemptRecords ?? [],
    error: input.error,
    outputCapture: input.outputCapture ?? emptyOutputCaptureSummary(),
    ...(input.diagnostics ? { diagnostics: input.diagnostics } : {}),
  };
}
