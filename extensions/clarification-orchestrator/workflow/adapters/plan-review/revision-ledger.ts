import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import type { VersionedArtifactRef } from "../../types.ts";
import type { PlanReviewAggregate, PlanRevisionAgentOutput, PlanRevisionPolicy } from "./types.ts";

export function createPlanRevisionId(): string { return `plan-revision-${randomUUID()}`; }

export function planRevisionDir(layout: WorkflowLayout, revisionId: string): string {
  const dir = path.join(layout.workflowDir, "revisions", "plan", revisionId);
  assertWorkflowPath(layout, dir);
  return dir;
}

export async function writePlanRevisionLedger(layout: WorkflowLayout, input: {
  revisionId: string;
  policy: PlanRevisionPolicy;
  sourceReviewRunId: string;
  aggregate: PlanReviewAggregate;
  reviserOutput: PlanRevisionAgentOutput;
  committedArtifacts?: { requirementsRef: VersionedArtifactRef; tasksRef: VersionedArtifactRef };
  postRevisionReviewRunId?: string;
}): Promise<string> {
  const dir = planRevisionDir(layout, input.revisionId);
  await fs.mkdir(dir, { recursive: true });
  await writeJson(path.join(dir, "policy.json"), input.policy);
  await writeJson(path.join(dir, "source-review.json"), { reviewRunId: input.sourceReviewRunId });
  await writeJson(path.join(dir, "source-artifacts.json"), input.aggregate.artifactBinding);
  await writeJson(path.join(dir, "aggregate-findings.json"), input.aggregate.findings);
  await writeJson(path.join(dir, "reviser-output.json"), input.reviserOutput);
  if (input.committedArtifacts) await writeJson(path.join(dir, "committed-artifacts.json"), input.committedArtifacts);
  if (input.postRevisionReviewRunId) await writeJson(path.join(dir, "post-revision-review.json"), { reviewRunId: input.postRevisionReviewRunId });
  return path.relative(layout.topicDir, dir);
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}
