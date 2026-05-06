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
    "## Approval artifacts",
    "",
    `Approved design path: ${paths.designPath}`,
    `Clarification artifact path: ${paths.runDir}`,
    `Final approval path: ${paths.runDir}/final-approval.md`,
    "",
    "## Issue decision summary",
    "",
    `Accepted issues: ${state.acceptedIssueIds.length ? state.acceptedIssueIds.join(", ") : "none"}`,
    `Rejected issues: ${state.rejectedIssueIds.length ? state.rejectedIssueIds.join(", ") : "none"}`,
    `Deferred issues: ${state.deferredIssueIds.length ? state.deferredIssueIds.join(", ") : "none"}`,
    "",
    "## Recommended lifecycle methodology versions",
    "",
    `Spec planning: ${state.metadata.methodologyVersions.specPlan ?? "spec-plan-pro-v1"}`,
    `Spec execution: ${state.metadata.methodologyVersions.specExec ?? "spec-exec-pro-v1"}`,
    "",
    "## Next step",
    "",
    `Run /spec-plan ${state.metadata.topic.slug}`,
    `Target directory: ${state.metadata.topic.specDir}`,
    "Brainstorming Pro does not auto-invoke /spec-plan.",
    "",
  ]
    .filter((line) => line !== "")
    .join("\n");
}
