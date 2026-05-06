import fs from "node:fs/promises";
import path from "node:path";
import type { TopicInfo } from "./types.ts";

export type ApprovedDesignContext = {
  designPath: string;
  finalApprovalPath: string;
};

export type PlanningArtifacts = {
  requirementsPath: string;
  tasksPath: string;
};

export async function findApprovedDesignContext(topic: TopicInfo): Promise<ApprovedDesignContext | undefined> {
  const designExists = await exists(topic.designPath);
  if (!designExists) return undefined;
  const approval = await findLatestFinalApproval(topic);
  if (!approval) return undefined;
  const text = await fs.readFile(approval, "utf8");
  if (!/Final Approval Summary/u.test(text) || !/Run \/spec-plan/u.test(text)) return undefined;
  return { designPath: topic.designPath, finalApprovalPath: approval };
}

export async function findPlanningArtifacts(topic: TopicInfo): Promise<PlanningArtifacts | undefined> {
  const requirementsPath = path.join(topic.specDir, "requirements.md");
  const tasksPath = path.join(topic.specDir, "tasks.md");
  if (!(await exists(requirementsPath)) || !(await exists(tasksPath))) return undefined;
  return { requirementsPath, tasksPath };
}

async function findLatestFinalApproval(topic: TopicInfo): Promise<string | undefined> {
  let runIds: string[];
  try {
    runIds = await fs.readdir(topic.clarificationDir);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  for (const runId of runIds.filter((id) => id.startsWith("run-")).sort().reverse()) {
    const approval = path.join(topic.clarificationDir, runId, "final-approval.md");
    if (await exists(approval)) return approval;
  }
  return undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
