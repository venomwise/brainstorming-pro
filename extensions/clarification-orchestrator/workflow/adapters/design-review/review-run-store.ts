import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { assertWorkflowPath } from "../../artifact-store.ts";
import { writeWorkflowAtomicJson } from "../../atomic-json.ts";
import type { AcceptIncompleteDesignReviewDecision, DesignApprovalReadiness, DesignReviewAggregateResult, DesignReviewCoverage, DesignReviewerResult, DesignReviewMode, DesignReviewRun } from "./types.ts";
import type { VersionedArtifactRef } from "../../types.ts";
export { writeDesignReviewAttempt, writeAttemptReviewerResult } from "./review-attempt-store.ts";

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

export async function writeCoverage(layout: WorkflowLayout, run: DesignReviewRun, coverage: DesignReviewCoverage): Promise<void> {
  await writeWorkflowAtomicJson(path.join(ledgerDir(layout, run), "coverage.json"), coverage);
}

export async function writeAcceptIncompleteDecision(layout: WorkflowLayout, run: DesignReviewRun, decision: AcceptIncompleteDesignReviewDecision): Promise<void> {
  await writeWorkflowAtomicJson(path.join(ledgerDir(layout, run), "accept-incomplete-decision.json"), decision);
}

export async function readDesignReviewRun(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignReviewRun> {
  return await readLedgerJson<DesignReviewRun>(layout, run, "review-run.json");
}

export async function readCoverage(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignReviewCoverage> {
  return await readLedgerJson<DesignReviewCoverage>(layout, run, "coverage.json");
}

export async function readAggregatedFindings(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignReviewAggregateResult> {
  return await readLedgerJson<DesignReviewAggregateResult>(layout, run, "aggregated-findings.json");
}

export async function readReadiness(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignApprovalReadiness> {
  return await readLedgerJson<DesignApprovalReadiness>(layout, run, "readiness.json");
}

export async function readReviewerResults(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignReviewerResult[]> {
  const directory = path.join(ledgerDir(layout, run), "reviewer-results");
  assertWorkflowPath(layout, directory);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const results = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
    const resultPath = path.join(directory, entry.name);
    assertWorkflowPath(layout, resultPath);
    return JSON.parse(await fs.readFile(resultPath, "utf8")) as DesignReviewerResult;
  }));
  return results.sort((left, right) => left.reviewerRole.localeCompare(right.reviewerRole));
}

export async function validateReviewLedgerConsistency(layout: WorkflowLayout, run: DesignReviewRun): Promise<void> {
  const persistedRun = await readDesignReviewRun(layout, run);
  if (persistedRun.reviewRunId !== run.reviewRunId) throw new Error("Review ledger run id mismatch.");
  const coverage = await readCoverage(layout, run);
  const aggregate = await readAggregatedFindings(layout, run);
  const readiness = await readReadiness(layout, run);
  if (aggregate.reviewRunId !== run.reviewRunId) throw new Error("Review aggregate run id mismatch.");
  if (aggregate.designRef.checksum !== run.designRef.checksum || aggregate.designRef.version !== run.designRef.version) throw new Error("Review aggregate design ref mismatch.");
  if (JSON.stringify(aggregate.coverage) !== JSON.stringify(coverage)) throw new Error("Review aggregate coverage does not match coverage ledger.");
  if (aggregate.readiness.status !== readiness.status) throw new Error("Review readiness does not match aggregate readiness.");
}

async function readLedgerJson<T>(layout: WorkflowLayout, run: DesignReviewRun, name: string): Promise<T> {
  const filePath = path.join(ledgerDir(layout, run), name);
  assertWorkflowPath(layout, filePath);
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch (error) {
    throw new Error(`Review ledger is missing, corrupted, or inconsistent: ${name}`, { cause: error });
  }
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
  await fs.mkdir(path.join(dir, "attempts"), { recursive: true });
}
