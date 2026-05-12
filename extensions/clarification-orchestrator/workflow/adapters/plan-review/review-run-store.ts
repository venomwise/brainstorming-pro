import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import type { PlanApprovalReadiness, PlanReviewAggregate, PlanReviewArtifactBinding, PlanReviewerResult, PlanReviewerRole, PlanReviewRun } from "./types.ts";

export function createPlanReviewRunId(): string {
  return `plan-review-${randomUUID()}`;
}

export function planReviewRunDir(layout: WorkflowLayout, reviewRunId: string): string {
  const dir = path.join(layout.workflowDir, "reviews", "plan", reviewRunId);
  assertWorkflowPath(layout, dir);
  return dir;
}

export async function initializePlanReviewRun(layout: WorkflowLayout, input: { reviewRunId: string; topic: string; workflowRunId: string; binding: PlanReviewArtifactBinding; date?: Date }): Promise<PlanReviewRun> {
  const dir = planReviewRunDir(layout, input.reviewRunId);
  await fs.mkdir(path.join(dir, "reviewer-results"), { recursive: true });
  const run: PlanReviewRun = {
    reviewRunId: input.reviewRunId,
    topic: input.topic,
    workflowRunId: input.workflowRunId,
    status: "created",
    artifactBinding: input.binding,
    ledgerPath: path.relative(layout.topicDir, dir),
    startedAt: (input.date ?? new Date()).toISOString(),
    reviewerResults: [],
  };
  await writeJson(path.join(dir, "metadata.json"), run);
  await writeJson(path.join(dir, "artifact-binding.json"), input.binding);
  await appendPlanReviewEvent(layout, input.reviewRunId, { type: "plan-review.started", reviewRunId: input.reviewRunId, at: run.startedAt });
  return run;
}

export async function writePlanReviewerResult(layout: WorkflowLayout, reviewRunId: string, result: PlanReviewerResult): Promise<string> {
  const file = path.join(planReviewRunDir(layout, reviewRunId), "reviewer-results", `${result.reviewerRole}.json`);
  await writeJson(file, result);
  await appendPlanReviewEvent(layout, reviewRunId, { type: "plan-review.reviewer-completed", reviewRunId, reviewerRole: result.reviewerRole, status: result.status, at: result.completedAt });
  return path.relative(layout.topicDir, file);
}

export async function completePlanReviewRun(layout: WorkflowLayout, reviewRunId: string, aggregate: PlanReviewAggregate, readiness: PlanApprovalReadiness): Promise<void> {
  const dir = planReviewRunDir(layout, reviewRunId);
  await writeJson(path.join(dir, "findings.json"), aggregate.findings);
  await writeJson(path.join(dir, "aggregate.json"), aggregate);
  await writeJson(path.join(dir, "readiness.json"), readiness);
  await appendPlanReviewEvent(layout, reviewRunId, { type: "plan-review.readiness", reviewRunId, status: readiness.status, at: new Date().toISOString() });
}

export async function readLatestPlanReviewRun(layout: WorkflowLayout): Promise<{ reviewRunId: string; readiness?: PlanApprovalReadiness; ledgerPath: string } | undefined> {
  const root = path.join(layout.workflowDir, "reviews", "plan");
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const reviewRunId = dirs.at(-1);
    if (!reviewRunId) return undefined;
    const dir = planReviewRunDir(layout, reviewRunId);
    let readiness: PlanApprovalReadiness | undefined;
    try { readiness = JSON.parse(await fs.readFile(path.join(dir, "readiness.json"), "utf8")) as PlanApprovalReadiness; } catch {}
    return { reviewRunId, readiness, ledgerPath: path.relative(layout.topicDir, dir) };
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function appendPlanReviewEvent(layout: WorkflowLayout, reviewRunId: string, event: Record<string, unknown>): Promise<void> {
  const eventsPath = path.join(planReviewRunDir(layout, reviewRunId), "events.jsonl");
  await fs.appendFile(eventsPath, `${JSON.stringify(event)}\n`);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
