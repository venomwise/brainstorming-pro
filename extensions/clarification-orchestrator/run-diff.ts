import fs from "node:fs/promises";
import path from "node:path";
import type { TopicInfo } from "./types.ts";

export type RunDiffSummary = {
  topic: string;
  run1: string;
  run2: string;
  designChanged: boolean;
  issues: { added: string[]; removed: string[]; common: string[] };
  decisions: { added: string[]; removed: string[]; common: string[] };
};

export async function listRuns(topic: TopicInfo): Promise<string[]> {
  try {
    const entries = await fs.readdir(topic.clarificationDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name.startsWith("run-")).map((entry) => entry.name).sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function compareRuns(topic: TopicInfo, run1?: string, run2?: string): Promise<RunDiffSummary> {
  const runs = await listRuns(topic);
  if (!run1 || !run2) {
    if (runs.length < 2) throw new Error("Need at least two runs to compare.");
    run1 = runs[runs.length - 2];
    run2 = runs[runs.length - 1];
  }
  if (!runs.includes(run1) || !runs.includes(run2)) throw new Error(`Run not found. Available runs: ${runs.join(", ")}`);

  const dir1 = path.join(topic.clarificationDir, run1);
  const dir2 = path.join(topic.clarificationDir, run2);
  const design1 = await readOptional(path.join(dir1, "design.md")) ?? (await readOptional(path.join(dir1, "02-design-v1.md"))) ?? "";
  const design2 = await readOptional(path.join(dir2, "design.md")) ?? (await readOptional(path.join(dir2, "02-design-v1.md"))) ?? "";
  const issues1 = await readIds(path.join(dir1, "triage-r1.json"), "issues");
  const issues2 = await readIds(path.join(dir2, "triage-r1.json"), "issues");
  const decisions1 = await readIds(path.join(dir1, "decisions-r1.json"), "decisions", "issueId");
  const decisions2 = await readIds(path.join(dir2, "decisions-r1.json"), "decisions", "issueId");

  return {
    topic: topic.displayName,
    run1,
    run2,
    designChanged: design1 !== design2,
    issues: diffIds(issues1, issues2),
    decisions: diffIds(decisions1, decisions2),
  };
}

function diffIds(left: string[], right: string[]) {
  const a = new Set(left);
  const b = new Set(right);
  return {
    added: right.filter((id) => !a.has(id)),
    removed: left.filter((id) => !b.has(id)),
    common: right.filter((id) => a.has(id)),
  };
}

async function readIds(file: string, arrayKey: string, idKey = "id"): Promise<string[]> {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    const array = Array.isArray(data) ? data : data[arrayKey];
    if (!Array.isArray(array)) return [];
    return array.map((item) => item?.[idKey]).filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
