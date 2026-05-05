import fs from "node:fs/promises";
import path from "node:path";
import type { BrainstormingProConfig, TopicInfo } from "./types.ts";
import { assertUnderSpecRoot } from "./path-guard.ts";
import { listRuns } from "./run-diff.ts";

export type CleanupPlan = {
  topic: string;
  protectedRuns: string[];
  deleteRuns: string[];
};

export async function buildCleanupPlan(topic: TopicInfo, config: BrainstormingProConfig, keepOverride?: number): Promise<CleanupPlan> {
  const runs = await listRuns(topic);
  const keep = Math.max(keepOverride ?? config.artifacts.retention.maxRuns, 2);
  const protectedRuns = runs.slice(-Math.max(keep, 2));
  const deleteRuns = runs.slice(0, Math.max(0, runs.length - keep)).filter((run) => !protectedRuns.includes(run));
  return { topic: topic.displayName, protectedRuns, deleteRuns };
}

export async function executeCleanupPlan(topic: TopicInfo, plan: CleanupPlan, dryRun: boolean): Promise<{ deleted: string[]; failed: Array<{ run: string; error: string }> }> {
  const deleted: string[] = [];
  const failed: Array<{ run: string; error: string }> = [];
  if (dryRun) return { deleted, failed };

  for (const run of plan.deleteRuns) {
    const target = path.join(topic.clarificationDir, run);
    try {
      assertDeletionAllowed(topic, target);
      await fs.rm(target, { recursive: true, force: true });
      deleted.push(run);
    } catch (error) {
      failed.push({ run, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { deleted, failed };
}

export function assertDeletionAllowed(topic: TopicInfo, targetPath: string): void {
  const target = path.resolve(targetPath);
  const clarificationDir = path.resolve(topic.clarificationDir);
  assertUnderSpecRoot(target, path.join(topic.specDir, ".."));
  const relative = path.relative(clarificationDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Deletion outside clarification directory is not allowed: ${target}`);
  if (!path.basename(target).startsWith("run-")) throw new Error(`Deletion is limited to run directories: ${target}`);
}
