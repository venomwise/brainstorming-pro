import type { RunPaths } from "../artifact-store.ts";
import { loadState, saveState, updateStatePhase, writeMarkdownArtifact } from "../artifact-store.ts";
import type { WorkflowState } from "../types.ts";

export type FinalApprovalParams = {
  paths: RunPaths;
  approved: boolean;
  skippedPhases?: string[];
  unresolvedRisks?: string[];
};

export async function runFinalApprovalPhase(params: FinalApprovalParams): Promise<WorkflowState> {
  await updateStatePhase(params.paths, "FINAL_APPROVAL");
  const state = await loadState(params.paths);
  const summary = renderFinalApprovalSummary(state, params.paths, params.skippedPhases ?? [], params.unresolvedRisks ?? []);
  const summaryPath = await writeMarkdownArtifact(params.paths, "final-approval.md", summary);
  if (!state.completedArtifacts.includes(summaryPath)) state.completedArtifacts.push(summaryPath);

  if (params.approved) {
    state.phase = "COMPLETE";
    state.execution.status = "complete";
    state.execution.endedAt = new Date().toISOString();
    state.execution.durationMs = Date.parse(state.execution.endedAt) - Date.parse(state.execution.startedAt);
  }

  await saveState(params.paths, state);
  return state;
}

export function renderFinalApprovalSummary(state: WorkflowState, paths: RunPaths, skippedPhases: string[] = [], unresolvedRisks: string[] = []): string {
  return [
    "# Final Approval Summary",
    "",
    `Design path: ${paths.designPath}`,
    `Verification: ${state.verification.verified ? "verified" : "not verified"}`,
    `Unresolved P0/P1: ${state.verification.unresolvedP0P1.length === 0 ? "none" : state.verification.unresolvedP0P1.join(", ")}`,
    `Skipped phases: ${skippedPhases.length === 0 ? "none" : skippedPhases.join(", ")}`,
    `Unresolved risks: ${unresolvedRisks.length === 0 ? "none" : unresolvedRisks.join("; ")}`,
    state.verification.unreviewed ? "Warning: design is marked unreviewed." : "",
    state.verification.unverifiedReason ? `Unverified reason: ${state.verification.unverifiedReason}` : "",
    "",
    "## Next step",
    "",
    "Run `spec-plan` using the approved design and clarification artifacts as context.",
    `Target directory: ${state.metadata.topic.specDir}`,
    "Brainstorming Pro does not auto-invoke spec-plan.",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
