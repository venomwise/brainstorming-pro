import fs from "node:fs/promises";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { assertWorkflowPath, checksum, resolveWorkflowPath } from "../../artifact-store.ts";
import type { DesignReviewAggregateResult, DesignReviewCoverage, DesignReviewRun, DesignReviewTriageEngineInput, DesignReviewTriageSourceRefs, DesignReviewTriageReviewerResultRef } from "./types.ts";
import { validateDesignReviewTriageReport } from "./triage-schemas.ts";

export type BoundDesignReviewTriageSources = {
  sources: DesignReviewTriageSourceRefs;
  aggregate: DesignReviewAggregateResult;
  coverage?: DesignReviewCoverage;
  reviewerResults: DesignReviewTriageReviewerResultRef[];
  designContent: string;
};

export async function bindDesignReviewTriageSources(layout: WorkflowLayout, input: DesignReviewTriageEngineInput): Promise<BoundDesignReviewTriageSources> {
  const aggregatePath = resolveWorkflowPath(layout, input.sources.aggregate.path);
  const aggregateContent = await fs.readFile(aggregatePath, "utf8");
  const aggregateChecksum = checksum(aggregateContent);
  if (aggregateChecksum !== input.sources.aggregate.checksum) throw new Error("Triage source aggregate checksum mismatch.");
  const aggregate = JSON.parse(aggregateContent) as DesignReviewAggregateResult;
  if (aggregate.reviewRunId !== input.reviewRun.reviewRunId) throw new Error("Triage source aggregate run id mismatch.");
  if (aggregate.designRef.checksum !== input.reviewRun.designRef.checksum || aggregate.designRef.version !== input.reviewRun.designRef.version) throw new Error("Triage source aggregate design ref mismatch.");

  const designAbsolutePath = resolveWorkflowPath(layout, input.reviewRun.designRef.path);
  const designContent = await fs.readFile(designAbsolutePath, "utf8");
  if (checksum(designContent) !== input.reviewRun.designRef.checksum) throw new Error("Triage source design checksum mismatch.");

  const coverage = input.sources.coverage ? await readCoverage(layout, input.sources.coverage.path, input.sources.coverage.checksum) : undefined;
  const reviewerResults = await readReviewerResults(layout, input.sources.reviewerResults);
  const sourceCheck = {
    reviewRunId: input.reviewRun.reviewRunId,
    designRef: input.reviewRun.designRef,
    aggregate: { path: input.sources.aggregate.path, checksum: aggregateChecksum },
    ...(coverage ? { coverage: input.sources.coverage } : {}),
    reviewerResults,
    ...(input.sources.reviewDecisionRef ? { reviewDecisionRef: input.sources.reviewDecisionRef } : {}),
  } satisfies DesignReviewTriageSourceRefs;
  validateDesignReviewTriageReport({
    reviewRunId: input.reviewRun.reviewRunId,
    designRef: input.reviewRun.designRef,
    status: "fresh",
    generatedAt: new Date().toISOString(),
    sources: sourceCheck,
    findings: [],
    clusters: [],
    conflicts: [],
    unresolvedQuestions: [],
    coverage: { availableReviewers: [], selectedReviewers: [], unselectedReviewers: [], succeededReviewers: [], failedReviewers: [], pendingRetryReviewers: [], status: "unavailable", hasIncompleteCoverage: false },
    readiness: { status: "not-ready", sourceReadiness: { status: "not-ready", blockingFindingIds: [], unresolvedUserQuestions: [], summary: "" }, recommendedNextAction: "review-summary", blockingFindingIds: [], blockingConflictIds: [], blockingQuestionIds: [], summary: "" },
    summary: "",
  });
  return { sources: sourceCheck, aggregate, coverage, reviewerResults, designContent };
}

export async function validateTriageSourceBinding(layout: WorkflowLayout, input: DesignReviewTriageEngineInput): Promise<void> {
  const bound = await bindDesignReviewTriageSources(layout, input);
  if (bound.aggregate.reviewRunId !== input.reviewRun.reviewRunId) throw new Error("Triage source binding failed review run validation.");
  if (bound.sources.designRef.checksum !== input.reviewRun.designRef.checksum) throw new Error("Triage source binding failed design validation.");
  if (input.currentReadiness && bound.aggregate.readiness.status !== input.currentReadiness.status) throw new Error("Triage source binding readiness mismatch.");
}

async function readCoverage(layout: WorkflowLayout, pathRef: string, expectedChecksum: string): Promise<DesignReviewCoverage> {
  const coveragePath = resolveWorkflowPath(layout, pathRef);
  const content = await fs.readFile(coveragePath, "utf8");
  const actual = checksum(content);
  if (actual !== expectedChecksum) throw new Error("Triage source coverage checksum mismatch.");
  return JSON.parse(content) as DesignReviewCoverage;
}

async function readReviewerResults(layout: WorkflowLayout, refs: DesignReviewTriageReviewerResultRef[]): Promise<DesignReviewTriageReviewerResultRef[]> {
  const results: DesignReviewTriageReviewerResultRef[] = [];
  for (const ref of refs) {
    const resultPath = resolveWorkflowPath(layout, ref.path);
    const content = await fs.readFile(resultPath, "utf8");
    if (checksum(content) !== ref.checksum) throw new Error(`Triage source reviewer result checksum mismatch: ${ref.reviewerRole}`);
    const parsed = JSON.parse(content) as { reviewRunId: string; reviewerRole: string; status: "succeeded" | "failed" };
    if (parsed.reviewerRole !== ref.reviewerRole) throw new Error(`Triage source reviewer result role mismatch: ${ref.reviewerRole}`);
    results.push(ref);
  }
  return results;
}
