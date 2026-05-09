import type { WorkflowState, WorkflowPhase, ArtifactKind } from "../types.ts";

export type ArtifactCommitItem = {
  kind: ArtifactKind;
  content: string;
  summary?: string;
};

export type ArtifactCommitRequest = {
  kind: "artifact-commit-request";
  artifacts: ArtifactCommitItem[];
  metadata?: Record<string, unknown>;
};

export type AdapterBlockedResult = {
  kind: "blocked";
  reason: string;
  diagnostics?: Record<string, unknown>;
};

export type AdapterFailedResult = {
  kind: "failed";
  error: {
    kind: string;
    message: string;
    retryable: boolean;
    details?: unknown;
  };
};

export type AdapterPhaseResult = ArtifactCommitRequest | AdapterBlockedResult | AdapterFailedResult;

export type PhaseAdapterResult = AdapterPhaseResult | {
  statePatch?: Partial<WorkflowState>;
};

export type PhaseAdapter<Input = unknown, Output = unknown> = {
  name: string;
  phase: WorkflowPhase;
  allowedFrom: WorkflowPhase[];
  requiredArtifacts: ArtifactKind[];
  run(input: Input, state: WorkflowState): Promise<Output> | Output;
  validate(output: Output, state: WorkflowState): Promise<void> | void;
  commit(output: Output, state: WorkflowState): Promise<Partial<WorkflowState> | AdapterPhaseResult> | Partial<WorkflowState> | AdapterPhaseResult;
};

export type AdapterRegistry = Partial<Record<WorkflowPhase, PhaseAdapter<unknown, unknown>>>;

export function createAdapterRegistry(adapters: PhaseAdapter<unknown, unknown>[]): AdapterRegistry {
  return Object.fromEntries(adapters.map((adapter) => [adapter.phase, adapter])) as AdapterRegistry;
}

export function isAdapterPhaseResult(value: unknown): value is AdapterPhaseResult {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  const kind = (value as { kind: unknown }).kind;
  return kind === "artifact-commit-request" || kind === "blocked" || kind === "failed";
}
