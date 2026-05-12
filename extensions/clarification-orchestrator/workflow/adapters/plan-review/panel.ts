import { createAgentRunError } from "../../../runtime/agent-execution/types.ts";
import { createWorkflowLayout } from "../../artifact-store.ts";
import { bindPlanReviewArtifacts } from "./artifact-binding.ts";
import { aggregatePlanReview } from "./aggregation.ts";
import { normalizePlanReviewFindings } from "./finding-normalizer.ts";
import { runFixedPlanReviewers } from "./parallel-runner.ts";
import { evaluatePlanApprovalReadiness } from "./readiness.ts";
import { completePlanReviewRun, createPlanReviewRunId, initializePlanReviewRun, writePlanReviewerResult } from "./review-run-store.ts";
import { validatePlanShape } from "./shape-validator.ts";
import type { PlanReviewPanelRequest, PlanReviewPanelResult, PlanReviewerResult } from "./types.ts";

export async function runPlanReviewPanel(request: PlanReviewPanelRequest): Promise<PlanReviewPanelResult> {
  const layout = await createWorkflowLayout(request.projectRoot, request.topic);
  const reviewRunId = createPlanReviewRunId();
  const bindingResult = await bindPlanReviewArtifacts(layout, request.state as never);
  if (!bindingResult.ok) {
    return { reviewRunId, status: "failed", readiness: { status: "failed", blockingFindingIds: [], summary: bindingResult.diagnostics.join(" ") }, ledgerPath: ".workflow/reviews/plan", error: createAgentRunError("schema-validation-failed", bindingResult.diagnostics.join(" ")) };
  }

  await initializePlanReviewRun(layout, { reviewRunId, topic: request.topic, workflowRunId: request.workflowRunId, binding: bindingResult.binding });
  const ledgerPath = `.workflow/reviews/plan/${reviewRunId}`;
  const shape = validatePlanShape({ requirementsContent: bindingResult.contents.requirements, tasksContent: bindingResult.contents.tasks, binding: bindingResult.binding });
  if (!shape.ok) {
    const findings = normalizePlanReviewFindings({ reviewRunId, reviewerRole: "shape-validator", binding: bindingResult.binding, drafts: shape.findings });
    const aggregate = aggregatePlanReview({ reviewRunId, artifactBinding: bindingResult.binding, findings, reviewerResults: [] });
    const readiness = { status: "failed" as const, blockingFindingIds: findings.map((finding) => finding.id), summary: shape.diagnostics.join(" ") };
    await completePlanReviewRun(layout, reviewRunId, aggregate, readiness);
    return { reviewRunId, status: "failed", readiness, aggregate, ledgerPath, artifactBinding: bindingResult.binding, error: createAgentRunError("schema-validation-failed", readiness.summary) };
  }

  const shapeFindings = normalizePlanReviewFindings({ reviewRunId, reviewerRole: "shape-validator", binding: bindingResult.binding, drafts: shape.findings });
  const runner = await runFixedPlanReviewers({
    topic: request.topic,
    workflowRunId: request.workflowRunId,
    projectRoot: request.projectRoot,
    topicDir: request.topicDir,
    model: request.model,
    binding: bindingResult.binding,
    contents: bindingResult.contents,
    artifacts: request.state.artifacts,
    state: request.state as never,
  });

  const reviewerResults: PlanReviewerResult[] = runner.results.map(({ role, result }) => ({
    reviewRunId,
    reviewerRole: role,
    status: result.status === "succeeded" && result.output ? "succeeded" : "failed",
    summary: result.output?.summary,
    findings: result.output ? normalizePlanReviewFindings({ reviewRunId, reviewerRole: role, binding: bindingResult.binding, drafts: result.output.findings }) : [],
    rawOutput: result.output,
    error: result.error,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  }));
  for (const result of reviewerResults) await writePlanReviewerResult(layout, reviewRunId, result);
  const findings = [...shapeFindings, ...reviewerResults.flatMap((result) => result.findings)];
  const aggregate = aggregatePlanReview({ reviewRunId, artifactBinding: bindingResult.binding, findings, reviewerResults: reviewerResults.map((result) => ({ reviewerRole: result.reviewerRole, status: result.status, ...(result.error ? { error: result.error } : {}) })) });
  const readiness = evaluatePlanApprovalReadiness({ aggregate, failed: !runner.ok });
  await completePlanReviewRun(layout, reviewRunId, aggregate, readiness);
  return { reviewRunId, status: readiness.status === "ready-for-plan-approval" ? "passed" : readiness.status === "failed" ? "failed" : "blocked", readiness, aggregate, ledgerPath, artifactBinding: bindingResult.binding, ...(runner.ok ? {} : { error: createAgentRunError("unexpected-error", runner.reason) }) };
}

export const PlanReviewPanel = { run: runPlanReviewPanel };
