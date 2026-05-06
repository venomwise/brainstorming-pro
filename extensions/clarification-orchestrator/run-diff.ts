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
  const design1 = await readLatestDesign(dir1);
  const design2 = await readLatestDesign(dir2);
  const issues1 = await readReviewIds(dir1, "triage", "issues");
  const issues2 = await readReviewIds(dir2, "triage", "issues");
  const decisions1 = await readReviewIds(dir1, "decisions", "decisions", "issueId");
  const decisions2 = await readReviewIds(dir2, "decisions", "decisions", "issueId");

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

async function readLatestDesign(runDir: string): Promise<string> {
  const metadata = await readJsonOptional(path.join(runDir, "metadata.json"));
  const latestVersion = typeof metadata?.latestVersion === "number" ? metadata.latestVersion : undefined;
  if (latestVersion !== undefined) {
    const versioned = await readOptional(path.join(runDir, "versions", `v${latestVersion}`, "design.md"));
    if (versioned !== undefined) return versioned;
  }
  return await readOptional(path.join(runDir, "design.md")) ?? (await readOptional(path.join(runDir, "02-design-v1.md"))) ?? "";
}

async function readReviewIds(runDir: string, baseName: string, arrayKey: string, idKey = "id"): Promise<string[]> {
  const latest = await latestReviewRoundDir(runDir);
  if (latest) {
    const ids = await readIds(path.join(latest, `${baseName}.json`), arrayKey, idKey);
    if (ids.length) return ids;
  }
  return readIds(path.join(runDir, `${baseName}-r1.json`), arrayKey, idKey);
}

async function latestReviewRoundDir(runDir: string): Promise<string | undefined> {
  try {
    const reviewsDir = path.join(runDir, "reviews");
    const entries = await fs.readdir(reviewsDir, { withFileTypes: true });
    const rounds = entries
      .filter((entry) => entry.isDirectory() && /^round-\d+$/u.test(entry.name))
      .map((entry) => ({ name: entry.name, round: Number(entry.name.slice("round-".length)) }))
      .sort((a, b) => b.round - a.round);
    return rounds[0] ? path.join(reviewsDir, rounds[0].name) : undefined;
  } catch {
    return undefined;
  }
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

async function readJsonOptional(file: string): Promise<any | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return undefined;
  }
}

async function readOptional(file: string): Promise<string | undefined> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return undefined;
  }
}
