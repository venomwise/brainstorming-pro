import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { assertWorkflowPath } from "../../artifact-store.ts";
import { writeWorkflowAtomicJson } from "../../atomic-json.ts";
import type { DesignApprovalReadiness, DesignReviewAggregateResult, DesignReviewerResult, DesignReviewMode, DesignReviewRun } from "./types.ts";
import type { VersionedArtifactRef } from "../../types.ts";

export function createDesignReviewRun(input: {
  layout: WorkflowLayout;
  workflowRunId: string;
  mode: DesignReviewMode;
  designRef: VersionedArtifactRef;
  reviewDecisionRef: string;
  date?: Date;
}): DesignReviewRun {
  const startedAt = (input.date ?? new Date()).toISOString();
  const reviewRunId = `design-review-${startedAt.replace(/[:.]/gu, "")}-${randomUUID().slice(0, 8)}`;
  const ledgerDir = path.join(input.layout.workflowDir, "reviews", "design", reviewRunId);
  assertWorkflowPath(input.layout, ledgerDir);
  return {
    reviewRunId,
    topic: input.layout.topic,
    workflowRunId: input.workflowRunId,
    mode: input.mode,
    status: "created",
    designRef: input.designRef,
    reviewDecisionRef: input.reviewDecisionRef,
    ledgerPath: path.relative(input.layout.topicDir, ledgerDir),
    startedAt,
    reviewerResults: [],
  };
}

export async function writeDesignReviewRun(layout: WorkflowLayout, run: DesignReviewRun): Promise<void> {
  await writeWorkflowAtomicJson(path.join(ledgerDir(layout, run), "review-run.json"), run);
}

export async function writeReviewerResult(layout: WorkflowLayout, run: DesignReviewRun, result: DesignReviewerResult): Promise<DesignReviewRun> {
  const resultPath = path.join(ledgerDir(layout, run), "reviewer-results", `${result.reviewerRole}.json`);
  assertWorkflowPath(layout, resultPath);
  await writeWorkflowAtomicJson(resultPath, result);
  const relativePath = path.relative(layout.topicDir, resultPath);
  const reviewerResults = run.reviewerResults.filter((entry) => entry.reviewerRole !== result.reviewerRole);
  return { ...run, reviewerResults: [...reviewerResults, { reviewerRole: result.reviewerRole, path: relativePath, status: result.status }] };
}

export async function writeAggregatedFindings(layout: WorkflowLayout, run: DesignReviewRun, aggregate: DesignReviewAggregateResult): Promise<DesignReviewRun> {
  await writeWorkflowAtomicJson(path.join(ledgerDir(layout, run), "aggregated-findings.json"), aggregate);
  return { ...run, aggregateResult: aggregate, status: aggregate.status };
}

export async function writeReadiness(layout: WorkflowLayout, run: DesignReviewRun, readiness: DesignApprovalReadiness): Promise<DesignReviewRun> {
  await writeWorkflowAtomicJson(path.join(ledgerDir(layout, run), "readiness.json"), readiness);
  return { ...run, readiness };
}

export function ledgerDir(layout: WorkflowLayout, run: DesignReviewRun): string {
  const dir = path.resolve(layout.topicDir, run.ledgerPath);
  assertWorkflowPath(layout, dir);
  return dir;
}

export async function ensureReviewLedger(run: DesignReviewRun, layout: WorkflowLayout): Promise<void> {
  const dir = ledgerDir(layout, run);
  assertWorkflowPath(layout, dir);
  await fs.mkdir(path.join(dir, "reviewer-results"), { recursive: true });
}
