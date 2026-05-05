import fs from "node:fs/promises";
import path from "node:path";
import type { ClarifyOptions, RunMetadata, TopicInfo, WorkflowError, WorkflowPhase, WorkflowState } from "./types.ts";
import { assertUnderSpecRoot } from "./path-guard.ts";

export type RunPaths = {
  specDir: string;
  designPath: string;
  clarificationDir: string;
  runDir: string;
  debugDir: string;
  currentJsonPath: string;
  currentSymlinkPath: string;
  statePath: string;
};

export type CurrentRunFile = {
  runId: string;
  runDir: string;
  updatedAt: string;
};

export function createRunId(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `run-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function getRunPaths(topic: TopicInfo, runId: string): RunPaths {
  const runDir = path.join(topic.clarificationDir, runId);
  return {
    specDir: topic.specDir,
    designPath: topic.designPath,
    clarificationDir: topic.clarificationDir,
    runDir,
    debugDir: path.join(runDir, "debug"),
    currentJsonPath: path.join(topic.clarificationDir, "current.json"),
    currentSymlinkPath: path.join(topic.clarificationDir, "current"),
    statePath: path.join(runDir, "state.json"),
  };
}

export async function createRun(topic: TopicInfo, options: ClarifyOptions, cwd: string, date = new Date()): Promise<{ metadata: RunMetadata; paths: RunPaths; state: WorkflowState }> {
  const runId = createRunId(date);
  const paths = getRunPaths(topic, runId);
  await fs.mkdir(paths.debugDir, { recursive: true });
  await updateCurrentRun(topic, runId, paths.runDir);
  const now = date.toISOString();
  const metadata: RunMetadata = { runId, topic, createdAt: now, updatedAt: now, cwd };
  const state = createInitialState(metadata, options);
  await saveState(paths, state);
  return { metadata, paths, state };
}

export function createInitialState(metadata: RunMetadata, options: ClarifyOptions): WorkflowState {
  const now = metadata.createdAt;
  return {
    version: 1,
    metadata,
    phase: "INIT",
    options,
    round: 1,
    refinementAttempts: 0,
    completedArtifacts: [],
    pendingDecisions: [],
    acceptedIssueIds: [],
    rejectedIssueIds: [],
    deferredIssueIds: [],
    verification: { verified: false, results: [], unresolvedP0P1: [] },
    reviewers: options.reviewers.map((name) => ({ name, status: "pending" })),
    errors: [],
    execution: { status: "running", startedAt: now, agentRuns: 0, failedAgentRuns: 0 },
  };
}

export async function updateCurrentRun(topic: TopicInfo, runId: string, runDir: string): Promise<void> {
  await fs.mkdir(topic.clarificationDir, { recursive: true });
  const current: CurrentRunFile = { runId, runDir, updatedAt: new Date().toISOString() };
  await writeJsonFile(path.join(topic.clarificationDir, "current.json"), current, topic.specDir);
  const link = path.join(topic.clarificationDir, "current");
  try {
    await fs.rm(link, { force: true, recursive: true });
    await fs.symlink(path.basename(runDir), link, "dir");
  } catch {
    // Portable fallback is current.json; symlink failure is non-fatal.
  }
}

export async function resolveCurrentRun(topic: TopicInfo): Promise<CurrentRunFile | undefined> {
  try {
    const text = await fs.readFile(path.join(topic.clarificationDir, "current.json"), "utf8");
    return JSON.parse(text) as CurrentRunFile;
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function writeMarkdownArtifact(paths: RunPaths, relativePath: string, content: string): Promise<string> {
  assertSafeRelativeArtifactPath(relativePath);
  const target = path.join(paths.runDir, relativePath);
  assertArtifactPathAllowed(paths, target);
  await writeTextFile(target, content, paths.specDir);
  return target;
}

export async function writeJsonArtifact(paths: RunPaths, relativePath: string, value: unknown): Promise<string> {
  assertSafeRelativeArtifactPath(relativePath);
  const target = path.join(paths.runDir, relativePath);
  assertArtifactPathAllowed(paths, target);
  await writeJsonFile(target, value, paths.specDir);
  return target;
}

export async function writeDesignFile(paths: RunPaths, content: string): Promise<string> {
  assertArtifactPathAllowed(paths, paths.designPath);
  await writeTextFile(paths.designPath, content, paths.specDir);
  return paths.designPath;
}

export function assertSafeRelativeArtifactPath(relativePath: string): void {
  if (path.isAbsolute(relativePath)) throw new Error(`Artifact relative path must not be absolute: ${relativePath}`);
  const parts = relativePath.split(/[\\/]+/);
  if (parts.includes("..")) throw new Error(`Artifact relative path must not contain '..': ${relativePath}`);
}

export function assertArtifactPathAllowed(paths: RunPaths, targetPath: string): void {
  const target = path.resolve(targetPath);
  const runDir = path.resolve(paths.runDir);
  const specDir = path.resolve(paths.specDir);
  if (target === path.resolve(paths.designPath)) return;
  if (target === runDir || target.startsWith(`${runDir}${path.sep}`)) return;
  const relativeToSpec = path.relative(specDir, target);
  if (relativeToSpec && !relativeToSpec.includes(path.sep) && !relativeToSpec.startsWith("..") && !path.isAbsolute(relativeToSpec)) return;
  throw new Error(`Artifact path is outside allowed clarification/spec directory: ${target}`);
}

export async function readJsonArtifact<T>(paths: RunPaths, relativePath: string): Promise<T> {
  const target = path.join(paths.runDir, relativePath);
  assertUnderSpecRoot(target, path.join(paths.specDir, ".."));
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

export async function loadState(paths: RunPaths): Promise<WorkflowState> {
  return JSON.parse(await fs.readFile(paths.statePath, "utf8")) as WorkflowState;
}

export async function saveState(paths: RunPaths, state: WorkflowState): Promise<void> {
  state.metadata.updatedAt = new Date().toISOString();
  await writeJsonFile(paths.statePath, state, paths.specDir);
}

export async function updateStatePhase(paths: RunPaths, phase: WorkflowPhase): Promise<WorkflowState> {
  const state = await loadState(paths);
  state.phase = phase;
  await saveState(paths, state);
  return state;
}

export async function appendStateError(paths: RunPaths, error: WorkflowError): Promise<WorkflowState> {
  const state = await loadState(paths);
  state.errors.push(error);
  await saveState(paths, state);
  return state;
}

export async function recordCompletedArtifact(paths: RunPaths, artifactPath: string): Promise<WorkflowState> {
  const state = await loadState(paths);
  if (!state.completedArtifacts.includes(artifactPath)) state.completedArtifacts.push(artifactPath);
  await saveState(paths, state);
  return state;
}

export async function writeInterruptedArtifact(paths: RunPaths, contentOrDetails: string | {
  phase?: WorkflowPhase;
  activeSubagents?: Array<{ agentName: string; pid?: number; startedAt?: string }>;
  errors?: WorkflowError[];
  completedArtifacts?: string[];
  resumeInstructions?: string;
}): Promise<string> {
  const content = typeof contentOrDetails === "string" ? contentOrDetails : renderInterruptedArtifact(contentOrDetails);
  return writeMarkdownArtifact(paths, "interrupted.md", content);
}

export async function inspectExistingSpec(topic: TopicInfo): Promise<{ designExists: boolean; currentRun?: CurrentRunFile; stateExists: boolean }> {
  const designExists = await exists(topic.designPath);
  const currentRun = await resolveCurrentRun(topic);
  const stateExists = currentRun ? await exists(path.join(currentRun.runDir, "state.json")) : false;
  return { designExists, currentRun, stateExists };
}

export function resolveExistingDesignConflict(existing: { designExists: boolean; currentRun?: CurrentRunFile; stateExists: boolean }): string[] {
  if (existing.currentRun && existing.stateExists) return ["resume", "new-run", "overwrite", "abort"];
  if (existing.designExists) return ["use-existing-design", "new-run", "overwrite", "abort"];
  if (existing.currentRun && !existing.stateExists) return ["new-run", "manual-repair", "abort"];
  return ["new-run"];
}

export async function prepareRunForClarify(topic: TopicInfo, options: ClarifyOptions, cwd: string): Promise<{ metadata: RunMetadata; paths: RunPaths; state: WorkflowState }> {
  return createRun(topic, options, cwd);
}

function renderInterruptedArtifact(details: {
  phase?: WorkflowPhase;
  activeSubagents?: Array<{ agentName: string; pid?: number; startedAt?: string }>;
  errors?: WorkflowError[];
  completedArtifacts?: string[];
  resumeInstructions?: string;
}): string {
  return [
    "# Brainstorming Pro interrupted",
    "",
    `Phase: ${details.phase ?? "unknown"}`,
    "",
    "## Completed artifacts",
    ...(details.completedArtifacts?.length ? details.completedArtifacts.map((item) => `- ${item}`) : ["None recorded."]),
    "",
    "## Active subagents",
    ...(details.activeSubagents?.length ? details.activeSubagents.map((item) => `- ${item.agentName} pid=${item.pid ?? "unknown"} started=${item.startedAt ?? "unknown"}`) : ["None recorded."]),
    "",
    "## Errors",
    ...(details.errors?.length ? details.errors.map((item) => `- ${item.type}: ${item.message}`) : ["None recorded."]),
    "",
    details.resumeInstructions ?? "Resume with `/clarify <topic> --resume`.",
    "",
  ].join("\n");
}

async function writeTextFile(file: string, content: string, specDir: string): Promise<void> {
  assertUnderSpecRoot(file, path.join(specDir, ".."));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, "utf8");
}

async function writeJsonFile(file: string, value: unknown, specDir: string): Promise<void> {
  await writeTextFile(file, `${JSON.stringify(value, null, 2)}\n`, specDir);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
