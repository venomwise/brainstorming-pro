import fs from "node:fs/promises";
import path from "node:path";
import type { ClarifyOptions, ResumeStatus, RunMetadata, TopicCandidate, TopicInfo, WorkflowError, WorkflowPhase, WorkflowState } from "./types.ts";
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
  metadataPath: string;
  versionsDir: string;
  reviewsDir: string;
};

export type CurrentRunFile = {
  runId: string;
  runDir: string;
  updatedAt: string;
};

export type ResumableRun = {
  metadata: RunMetadata;
  paths: RunPaths;
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
    metadataPath: path.join(runDir, "metadata.json"),
    versionsDir: path.join(runDir, "versions"),
    reviewsDir: path.join(runDir, "reviews"),
  };
}

export type TopicProposalArtifact = {
  request: string;
  candidates: TopicCandidate[];
  proposedTopic?: string;
  confirmedTopic: string;
  existingTopics?: string[];
  createdAt: string;
};

export type CreateRunArtifacts = {
  topicProposal?: Omit<TopicProposalArtifact, "request" | "confirmedTopic" | "createdAt"> & Partial<Pick<TopicProposalArtifact, "createdAt">>;
};

export async function createRun(topic: TopicInfo, options: ClarifyOptions, cwd: string, date = new Date(), artifacts: CreateRunArtifacts = {}): Promise<{ metadata: RunMetadata; paths: RunPaths; state: WorkflowState }> {
  const runId = createRunId(date);
  const paths = getRunPaths(topic, runId);
  await fs.mkdir(paths.debugDir, { recursive: true });
  await updateCurrentRun(topic, runId, paths.runDir);
  const now = date.toISOString();
  const metadata: RunMetadata = {
    runId,
    topic,
    request: options.request,
    requestSummary: summarizeRequest(options.request),
    proposedTopic: options.proposedTopic,
    confirmedTopic: options.confirmedTopic ?? topic.slug,
    resumeStatus: "awaiting-design-gate-decision",
    currentPhase: "INIT",
    latestVersion: 0,
    activeRound: 0,
    pendingDecisionIds: [],
    resumeHint: "Resume with `/clarify --resume`.",
    methodologyVersions: { brainstorming: "brainstorming-pro-v1", specPlan: "spec-plan-pro-v1", specExec: "spec-exec-pro-v1" },
    createdAt: now,
    updatedAt: now,
    cwd,
  };
  const state = createInitialState(metadata, options);
  await saveState(paths, state);
  if (options.request && options.confirmedTopic) {
    const requestPath = await writeRequestArtifact(paths, metadata);
    state.completedArtifacts.push(requestPath);
  }
  if (artifacts.topicProposal) {
    const proposalPath = await writeTopicProposalArtifact(paths, {
      request: options.request,
      candidates: artifacts.topicProposal.candidates,
      proposedTopic: artifacts.topicProposal.proposedTopic ?? options.proposedTopic,
      confirmedTopic: options.confirmedTopic ?? topic.slug,
      existingTopics: artifacts.topicProposal.existingTopics,
      createdAt: artifacts.topicProposal.createdAt ?? now,
    });
    state.completedArtifacts.push(proposalPath);
  }
  if (state.completedArtifacts.length) await saveState(paths, state);
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
    reviewers: [],
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

export async function discoverResumableRuns(cwd: string): Promise<ResumableRun[]> {
  const specsRoot = path.join(cwd, "specs");
  const runs: ResumableRun[] = [];
  let topics: string[];
  try {
    topics = await fs.readdir(specsRoot);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  for (const topicSlug of topics) {
    const topicDir = path.join(specsRoot, topicSlug);
    const stat = await fs.stat(topicDir).catch(() => undefined);
    if (!stat?.isDirectory()) continue;
    const topic: TopicInfo = {
      displayName: topicSlug,
      slug: topicSlug,
      specDir: topicDir,
      designPath: path.join(topicDir, "design.md"),
      clarificationDir: path.join(topicDir, "clarification"),
    };
    const runIds = await fs.readdir(topic.clarificationDir).catch((error: any) => error?.code === "ENOENT" ? [] : Promise.reject(error));
    for (const runId of runIds) {
      if (!runId.startsWith("run-")) continue;
      const paths = getRunPaths(topic, runId);
      const metadata = await loadRunMetadata(paths).catch(() => undefined);
      if (!metadata || metadata.resumeStatus === "completed") continue;
      runs.push({ metadata, paths });
    }
  }

  return runs.sort((a, b) => b.metadata.updatedAt.localeCompare(a.metadata.updatedAt));
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

export async function writeVersionedDesign(paths: RunPaths, version: number, content: string): Promise<{ versionPath: string; designPath: string }> {
  assertSafeVersionNumber(version);
  const versionPath = await writeMarkdownArtifact(paths, path.posix.join("versions", `v${version}`, "design.md"), content);
  const designPath = await writeDesignFile(paths, content);
  return { versionPath, designPath };
}

export async function writeDesignGateDecision(paths: RunPaths, version: number, decision: unknown): Promise<string> {
  assertSafeVersionNumber(version);
  return writeJsonArtifact(paths, path.posix.join("versions", `v${version}`, "design-gate.json"), decision);
}

export async function writeReviewRoundArtifact(paths: RunPaths, round: number, name: string, value: unknown): Promise<string> {
  assertSafeRoundNumber(round);
  assertSafeReviewArtifactName(name);
  const relativePath = path.posix.join("reviews", `round-${round}`, name);
  return name.endsWith(".md") && typeof value === "string" ? writeMarkdownArtifact(paths, relativePath, value) : writeJsonArtifact(paths, relativePath, value);
}

export async function writeRequestArtifact(paths: RunPaths, metadata: RunMetadata): Promise<string> {
  const content = [
    "# Clarification Request",
    "",
    `Topic: ${metadata.confirmedTopic ?? metadata.topic.slug}`,
    metadata.proposedTopic ? `Proposed topic: ${metadata.proposedTopic}` : undefined,
    `Captured at: ${metadata.createdAt}`,
    "",
    "## Original request",
    "",
    metadata.request ?? "",
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
  return writeMarkdownArtifact(paths, "request.md", content);
}

export async function writeTopicProposalArtifact(paths: RunPaths, proposal: TopicProposalArtifact): Promise<string> {
  return writeJsonArtifact(paths, "topic-proposal.json", proposal);
}

export function assertSafeRelativeArtifactPath(relativePath: string): void {
  if (path.isAbsolute(relativePath)) throw new Error(`Artifact relative path must not be absolute: ${relativePath}`);
  const parts = relativePath.split(/[\\/]+/);
  if (parts.includes("..")) throw new Error(`Artifact relative path must not contain '..': ${relativePath}`);
}

function assertSafeVersionNumber(version: number): void {
  if (!Number.isInteger(version) || version < 0) throw new Error(`Design version must be a non-negative integer: ${version}`);
}

function assertSafeRoundNumber(round: number): void {
  if (!Number.isInteger(round) || round < 1) throw new Error(`Review round must be a positive integer: ${round}`);
}

function assertSafeReviewArtifactName(name: string): void {
  assertSafeRelativeArtifactPath(name);
  if (name.includes("/") || name.includes("\\")) throw new Error(`Review artifact name must not contain path separators: ${name}`);
  if (!/^[a-z0-9][a-z0-9._-]*\.(json|md)$/u.test(name)) throw new Error(`Review artifact name must be a safe .json or .md filename: ${name}`);
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
  const raw = JSON.parse(await fs.readFile(paths.statePath, "utf8")) as WorkflowState;
  return normalizeLoadedState(raw);
}

export async function loadRunMetadata(paths: RunPaths): Promise<RunMetadata> {
  try {
    return normalizeRunMetadata(JSON.parse(await fs.readFile(paths.metadataPath, "utf8")) as RunMetadata);
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
    const state = await loadState(paths);
    await saveState(paths, state);
    return state.metadata;
  }
}

export async function saveState(paths: RunPaths, state: WorkflowState): Promise<void> {
  normalizeLoadedState(state);
  state.metadata.updatedAt = new Date().toISOString();
  await writeJsonFile(paths.statePath, state, paths.specDir);
  await writeJsonFile(paths.metadataPath, state.metadata, paths.specDir);
}

export async function updateStatePhase(paths: RunPaths, phase: WorkflowPhase): Promise<WorkflowState> {
  const state = await loadState(paths);
  state.phase = phase;
  state.metadata.currentPhase = phase;
  state.metadata.resumeStatus = resumeStatusForPhase(phase, state.metadata.resumeStatus);
  state.metadata.resumeHint = resumeHintForStatus(state.metadata.resumeStatus);
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

export async function prepareRunForClarify(topic: TopicInfo, options: ClarifyOptions, cwd: string, artifacts: CreateRunArtifacts = {}): Promise<{ metadata: RunMetadata; paths: RunPaths; state: WorkflowState }> {
  return createRun(topic, options, cwd, new Date(), artifacts);
}

function summarizeRequest(request: string): string {
  const normalized = request.replace(/\s+/g, " ").trim();
  if (normalized.length <= 120) return normalized;
  return `${normalized.slice(0, 117)}...`;
}

function normalizeLoadedState(state: WorkflowState): WorkflowState {
  state.metadata.currentPhase = state.phase;
  state.metadata.resumeStatus = resumeStatusForPhase(state.phase, state.metadata.resumeStatus);
  state.metadata = normalizeRunMetadata(state.metadata, state.phase);
  state.metadata.pendingDecisionIds = state.pendingDecisions ?? state.metadata.pendingDecisionIds;
  if (state.designVersions?.length) state.metadata.latestVersion = Math.max(state.metadata.latestVersion, ...state.designVersions.map((item) => item.version));
  state.metadata.activeRound = state.round ?? state.metadata.activeRound;
  return state;
}

function normalizeRunMetadata(metadata: RunMetadata, phase: WorkflowPhase = metadata.currentPhase ?? "INIT"): RunMetadata {
  const currentPhase = metadata.currentPhase ?? phase;
  const resumeStatus = metadata.resumeStatus ?? resumeStatusForPhase(currentPhase);
  metadata.requestSummary ??= metadata.request ? summarizeRequest(metadata.request) : metadata.topic.displayName;
  metadata.confirmedTopic ??= metadata.topic.slug;
  metadata.resumeStatus = resumeStatus;
  metadata.currentPhase = currentPhase;
  metadata.latestVersion ??= 0;
  metadata.activeRound ??= 0;
  metadata.pendingDecisionIds ??= [];
  metadata.resumeHint ??= resumeHintForStatus(resumeStatus);
  metadata.methodologyVersions ??= { brainstorming: "brainstorming-pro-v1", specPlan: "spec-plan-pro-v1", specExec: "spec-exec-pro-v1" };
  return metadata;
}

function resumeStatusForPhase(phase: WorkflowPhase, fallback: ResumeStatus = "awaiting-design-gate-decision"): ResumeStatus {
  switch (phase) {
    case "TOPIC_PROPOSAL":
    case "TOPIC_CONFIRMATION":
      return "awaiting-topic-confirmation";
    case "DESIGN_REVIEW_GATE":
    case "CONVERSATIONAL_REVISION":
    case "V0_BRAINSTORMING":
      return "awaiting-design-gate-decision";
    case "REVIEW":
      return "in-cross-review";
    case "TRIAGE":
    case "USER_DECISION":
    case "ISSUE_DECISION_GATE":
      return "awaiting-issue-decisions";
    case "ABORTED":
    case "INTERRUPTED":
      return "recoverable-failure";
    case "COMPLETE":
      return "completed";
    default:
      return fallback;
  }
}

function resumeHintForStatus(status: ResumeStatus): string {
  switch (status) {
    case "awaiting-topic-confirmation":
      return "Resume with `/clarify --resume` to confirm the topic.";
    case "awaiting-design-gate-decision":
      return "Resume with `/clarify --resume` to return to the design review gate.";
    case "awaiting-issue-decisions":
      return "Resume with `/clarify --resume` to decide pending review issues.";
    case "in-cross-review":
      return "Resume with `/clarify --resume` to inspect cross-review progress and recovery choices.";
    case "recoverable-failure":
      return "Resume with `/clarify --resume` to inspect the failure and recovery choices.";
    case "completed":
      return "Clarification is complete; use the final approval handoff paths.";
  }
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
