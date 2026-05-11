import fs from "node:fs/promises";
import path from "node:path";

import { assertWorkflowPath, type WorkflowLayout } from "../../artifact-store.ts";
import { validateDesignRevisionRecord } from "./schemas.ts";
import { DEFAULT_MAX_TOTAL_DESIGN_REVISION_ROUNDS, DEFAULT_MAX_TOTAL_POST_REVISION_REVIEW_ROUNDS } from "./constants.ts";
import type { DesignRevisionRoundPolicy } from "./types.ts";

export type RevisionRoundPolicyResult =
  | { status: "allowed"; policy: DesignRevisionRoundPolicy }
  | { status: "revision-exhausted"; policy: DesignRevisionRoundPolicy; reason: string };

export async function evaluateRevisionRoundPolicy(layout: WorkflowLayout, limits: Partial<Pick<DesignRevisionRoundPolicy, "maxTotalRevisionRounds" | "maxTotalPostRevisionReviewRounds">> = {}): Promise<RevisionRoundPolicyResult> {
  const policy = await buildRevisionRoundPolicy(layout, limits);
  if (policy.usedRevisionRounds >= policy.maxTotalRevisionRounds) {
    return { status: "revision-exhausted", policy, reason: "Maximum total design revision rounds exhausted." };
  }
  if (policy.usedPostRevisionReviewRounds >= policy.maxTotalPostRevisionReviewRounds) {
    return { status: "revision-exhausted", policy, reason: "Maximum total post-revision review rounds exhausted." };
  }
  return { status: "allowed", policy };
}

export async function buildRevisionRoundPolicy(layout: WorkflowLayout, limits: Partial<Pick<DesignRevisionRoundPolicy, "maxTotalRevisionRounds" | "maxTotalPostRevisionReviewRounds">> = {}): Promise<DesignRevisionRoundPolicy> {
  const records = await readRevisionRecords(layout);
  return {
    maxTotalRevisionRounds: limits.maxTotalRevisionRounds ?? DEFAULT_MAX_TOTAL_DESIGN_REVISION_ROUNDS,
    maxTotalPostRevisionReviewRounds: limits.maxTotalPostRevisionReviewRounds ?? DEFAULT_MAX_TOTAL_POST_REVISION_REVIEW_ROUNDS,
    usedRevisionRounds: records.filter((record) => record.status === "committed").length,
    usedPostRevisionReviewRounds: records.filter((record) => Boolean(record.postRevisionReviewRunId)).length,
  };
}

export async function readRevisionRecords(layout: WorkflowLayout): Promise<ReturnType<typeof validateDesignRevisionRecord>[]> {
  const root = path.join(layout.workflowDir, "revisions", "design");
  assertWorkflowPath(layout, root);
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    const recordPath = path.join(root, entry, "record.json");
    assertWorkflowPath(layout, recordPath);
    try {
      records.push(validateDesignRevisionRecord(JSON.parse(await fs.readFile(recordPath, "utf8"))));
    } catch (error: unknown) {
      if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") continue;
      throw new Error(`Revision round policy cannot read revision record: ${entry}`, { cause: error });
    }
  }
  return records;
}
