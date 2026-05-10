import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { assertWorkflowPath } from "../../artifact-store.ts";
import { writeWorkflowAtomicJson } from "../../atomic-json.ts";
import type { FullDesignReviewerRole, VersionedArtifactRef } from "../../types.ts";
import { ledgerDir } from "./review-run-store.ts";
import type { DesignReviewAttempt, DesignReviewerResult, DesignReviewRun } from "./types.ts";

export async function createDesignReviewAttempt(input: {
  layout: WorkflowLayout;
  reviewRun: DesignReviewRun;
  designRef: VersionedArtifactRef;
  reviewerRoles: readonly FullDesignReviewerRole[];
  reason: DesignReviewAttempt["reason"];
  startedAt?: string;
}): Promise<DesignReviewAttempt> {
  const attempt: DesignReviewAttempt = {
    attemptId: await nextAttemptId(input.layout, input.reviewRun),
    reviewRunId: input.reviewRun.reviewRunId,
    designRef: input.designRef,
    reviewerRoles: [...input.reviewerRoles],
    reason: input.reason,
    status: "started",
    startedAt: input.startedAt ?? new Date().toISOString(),
    succeededReviewers: [],
    failedReviewers: [],
  };
  await writeDesignReviewAttempt(input.layout, input.reviewRun, attempt);
  return attempt;
}

export async function completeDesignReviewAttempt(layout: WorkflowLayout, run: DesignReviewRun, attempt: DesignReviewAttempt, input: {
  succeededReviewers: readonly FullDesignReviewerRole[];
  failedReviewers: readonly FullDesignReviewerRole[];
  completedAt?: string;
}): Promise<DesignReviewAttempt> {
  const completed: DesignReviewAttempt = {
    ...attempt,
    status: "completed",
    completedAt: input.completedAt ?? new Date().toISOString(),
    succeededReviewers: [...input.succeededReviewers],
    failedReviewers: [...input.failedReviewers],
  };
  await writeDesignReviewAttempt(layout, run, completed);
  return completed;
}

export async function writeDesignReviewAttempt(layout: WorkflowLayout, run: DesignReviewRun, attempt: DesignReviewAttempt): Promise<void> {
  await writeWorkflowAtomicJson(attemptPath(layout, run, attempt), attempt);
}

export async function writeAttemptReviewerResult(layout: WorkflowLayout, run: DesignReviewRun, attempt: DesignReviewAttempt, result: DesignReviewerResult): Promise<void> {
  const resultPath = path.join(attemptDir(layout, run, attempt), "reviewer-results", `${result.reviewerRole}.json`);
  assertWorkflowPath(layout, resultPath);
  await writeWorkflowAtomicJson(resultPath, result);
}

export async function readDesignReviewAttempts(layout: WorkflowLayout, run: DesignReviewRun): Promise<DesignReviewAttempt[]> {
  const directory = attemptsDir(layout, run);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const attempts = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const attemptFile = path.join(directory, entry.name, "attempt.json");
      assertWorkflowPath(layout, attemptFile);
      return JSON.parse(await fs.readFile(attemptFile, "utf8")) as DesignReviewAttempt;
    }));
    return attempts.sort((left, right) => left.attemptId.localeCompare(right.attemptId));
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
}

export async function readDesignReviewAttemptReviewerResults(layout: WorkflowLayout, run: DesignReviewRun, attempt: DesignReviewAttempt): Promise<DesignReviewerResult[]> {
  const directory = path.join(attemptDir(layout, run, attempt), "reviewer-results");
  assertWorkflowPath(layout, directory);
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const results = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map(async (entry) => {
      const resultFile = path.join(directory, entry.name);
      assertWorkflowPath(layout, resultFile);
      return JSON.parse(await fs.readFile(resultFile, "utf8")) as DesignReviewerResult;
    }));
    return results.sort((left, right) => left.reviewerRole.localeCompare(right.reviewerRole));
  } catch (error: unknown) {
    if (isMissing(error)) return [];
    throw error;
  }
}

function attemptPath(layout: WorkflowLayout, run: DesignReviewRun, attempt: DesignReviewAttempt): string {
  return path.join(attemptDir(layout, run, attempt), "attempt.json");
}

function attemptDir(layout: WorkflowLayout, run: DesignReviewRun, attempt: DesignReviewAttempt): string {
  const directory = path.join(attemptsDir(layout, run), attempt.attemptId);
  assertWorkflowPath(layout, directory);
  return directory;
}

function attemptsDir(layout: WorkflowLayout, run: DesignReviewRun): string {
  const directory = path.join(ledgerDir(layout, run), "attempts");
  assertWorkflowPath(layout, directory);
  return directory;
}

async function nextAttemptId(layout: WorkflowLayout, run: DesignReviewRun): Promise<string> {
  const existing = await readDesignReviewAttempts(layout, run);
  const highest = existing.reduce((max, attempt) => {
    const match = /^attempt-(\d+)$/u.exec(attempt.attemptId);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0);
  return `attempt-${String(highest + 1).padStart(3, "0")}`;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
