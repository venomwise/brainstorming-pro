import type { WorkflowState, WorkflowPhase, ArtifactKind } from "../types.ts";

export type PhaseAdapterResult = {
  statePatch?: Partial<WorkflowState>;
};

export type PhaseAdapter<Input = unknown, Output = unknown> = {
  name: string;
  phase: WorkflowPhase;
  allowedFrom: WorkflowPhase[];
  requiredArtifacts: ArtifactKind[];
  run(input: Input, state: WorkflowState): Promise<Output> | Output;
  validate(output: Output, state: WorkflowState): Promise<void> | void;
  commit(output: Output, state: WorkflowState): Promise<Partial<WorkflowState>> | Partial<WorkflowState>;
};

export type AdapterRegistry = Partial<Record<WorkflowPhase, PhaseAdapter>>;

export function createAdapterRegistry(adapters: PhaseAdapter[]): AdapterRegistry {
  return Object.fromEntries(adapters.map((adapter) => [adapter.phase, adapter])) as AdapterRegistry;
}
