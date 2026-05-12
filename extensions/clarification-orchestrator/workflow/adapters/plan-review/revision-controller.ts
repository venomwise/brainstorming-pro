import { writeVersionedArtifact, type WorkflowLayout } from "../../artifact-store.ts";
import type { VersionedArtifactRef, WorkflowState } from "../../types.ts";
import type { PlanApprovalReadiness, PlanReviewAggregate, PlanRevisionAgentOutput, PlanRevisionPolicy, PlanReviewPanelRequest, PlanReviewPanelResult } from "./types.ts";
import { validatePlanRevisionAgentOutput } from "./schemas.ts";
import { runPlanReviewPanel } from "./panel.ts";

export function createPlanRevisionPolicy(input: { revisionId: string; aggregate: PlanReviewAggregate; readiness: PlanApprovalReadiness; alreadyUsed: boolean }): PlanRevisionPolicy {
  if (input.alreadyUsed) return { revisionId: input.revisionId, sourceReviewRunId: input.aggregate.reviewRunId, usedForPlanCycle: true, eligible: false, reason: "automatic-plan-revision-already-used" };
  if (input.readiness.status !== "blocked-needs-plan-revision") return { revisionId: input.revisionId, sourceReviewRunId: input.aggregate.reviewRunId, usedForPlanCycle: false, eligible: false, reason: "readiness-not-plan-revision-blocked" };
  if (input.aggregate.findings.some((finding) => finding.requiresDesignRevision)) return { revisionId: input.revisionId, sourceReviewRunId: input.aggregate.reviewRunId, usedForPlanCycle: false, eligible: false, reason: "requires-design-revision" };
  return { revisionId: input.revisionId, sourceReviewRunId: input.aggregate.reviewRunId, usedForPlanCycle: false, eligible: true };
}

export function buildPlanRevisionRequest(input: { state: WorkflowState; aggregate: PlanReviewAggregate; readiness: PlanApprovalReadiness; contents: { design: string; requirements: string; tasks: string } }): Record<string, unknown> {
  return { approvedDesignRef: input.aggregate.artifactBinding.approvedDesignRef, requirementsRef: input.aggregate.artifactBinding.requirements, tasksRef: input.aggregate.artifactBinding.tasks, aggregate: input.aggregate, readiness: input.readiness, contents: input.contents, artifacts: input.state.artifacts };
}

export async function commitPlanRevisionArtifacts(layout: WorkflowLayout, outputValue: unknown): Promise<{ requirementsRef: VersionedArtifactRef; tasksRef: VersionedArtifactRef; output: PlanRevisionAgentOutput }> {
  const output = validatePlanRevisionAgentOutput(outputValue);
  if (output.status !== "revised" || !output.revisedRequirements || !output.revisedTasks) throw new Error("Plan revision did not produce revised artifacts.");
  const requirementsRef = await writeVersionedArtifact(layout, "requirements", output.revisedRequirements);
  const tasksRef = await writeVersionedArtifact(layout, "tasks", output.revisedTasks);
  return { requirementsRef, tasksRef, output };
}

export async function runPostRevisionPlanReview(request: PlanReviewPanelRequest, committed: { requirementsRef: VersionedArtifactRef; tasksRef: VersionedArtifactRef }): Promise<PlanReviewPanelResult> {
  return runPlanReviewPanel({ ...request, state: { ...request.state, artifacts: { ...request.state.artifacts, requirements: committed.requirementsRef, tasks: committed.tasksRef } } });
}
