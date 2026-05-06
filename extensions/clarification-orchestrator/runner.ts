import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { Buffer } from "node:buffer";
import type { AgentDefinition, AgentRunResult, AgentRunStatus, AgentUsage, BrainstormingProConfig, WorkflowError } from "./types.ts";
import type { RunPaths } from "./artifact-store.ts";
import { writeJsonArtifact, writeMarkdownArtifact } from "./artifact-store.ts";
import { buildRepairPrompt, formatValidationError, parseJsonOutput, validateOrThrow, type SchemaLike } from "./validation.ts";

export type RunSubagentParams<T = unknown> = {
  agent: AgentDefinition;
  cwd: string;
  prompt: string;
  config: BrainstormingProConfig;
  model?: string;
  currentModel?: string;
  availableModels?: string[];
  tools?: string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  expectedSchema?: SchemaLike;
  schemaName?: string;
  artifactPaths?: RunPaths;
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
  repair?: {
    enabled: boolean;
    runRepairPrompt?: (prompt: string) => Promise<string>;
  };
  modelAvailability?: (model: string) => boolean | Promise<boolean>;
  spawnProcess?: typeof spawnPiProcess;
  sleep?: (ms: number) => Promise<void>;
};

export type PiProcessArgs = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

export type SpawnPiProcessParams = {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  registry?: ChildProcessRegistry;
  agentName?: string;
};

export type PiProcessResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
  outputLimitExceeded: boolean;
  durationMs: number;
};

export type ParsedSubagentResult = {
  rawOutput: string;
  usage?: AgentUsage;
};

export type ActiveSubagentProcess = {
  id: string;
  agentName: string;
  pid?: number;
  startedAt: string;
};

export class ChildProcessRegistry {
  private readonly processes = new Map<number, { child: ChildProcessWithoutNullStreams; agentName: string; startedAt: string }>();

  register(child: ChildProcessWithoutNullStreams, agentName = "unknown"): void {
    if (!child.pid) return;
    this.processes.set(child.pid, { child, agentName, startedAt: new Date().toISOString() });
    child.once("close", () => {
      if (child.pid) this.processes.delete(child.pid);
    });
  }

  unregister(pid: number | undefined): void {
    if (pid) this.processes.delete(pid);
  }

  list(): ActiveSubagentProcess[] {
    return Array.from(this.processes.entries()).map(([pid, entry]) => ({
      id: String(pid),
      agentName: entry.agentName,
      pid,
      startedAt: entry.startedAt,
    }));
  }

  terminateAll(signal: NodeJS.Signals = "SIGTERM"): void {
    for (const { child } of this.processes.values()) killChild(child, signal);
  }

  clear(): void {
    this.processes.clear();
  }
}

export const globalChildProcessRegistry = new ChildProcessRegistry();

export async function runSubagent<T = unknown>(params: RunSubagentParams<T>): Promise<AgentRunResult<T>> {
  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const maxAttempts = Math.max(1, params.config.retry.maxAttempts);
  let lastResult: AgentRunResult<T> | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runSubagentAttempt<T>(params, attempt, startedAtDate, startedAt);
    if (result.status === "success" || !isRetryableAgentResult(result, params.config) || attempt === maxAttempts) return result;
    lastResult = result;
    const delayMs = computeBackoffDelay(attempt, params.config.retry.initialDelayMs, params.config.retry.maxDelayMs);
    await (params.sleep ?? sleep)(delayMs);
  }

  return lastResult ?? runSubagentAttempt<T>(params, 1, startedAtDate, startedAt);
}

async function runSubagentAttempt<T = unknown>(params: RunSubagentParams<T>, attempt: number, startedAtDate: Date, startedAt: string): Promise<AgentRunResult<T>> {
  const agentConfig = params.config.agents[params.agent.name] ?? {};
  const timeoutMs = params.timeoutMs ?? agentConfig.timeoutMs ?? 300_000;
  const maxOutputBytes = params.maxOutputBytes ?? agentConfig.maxOutputBytes ?? 1_000_000;
  const modelResolution = await resolveAgentModel({
    agent: params.agent,
    config: params.config,
    requestedModel: params.model,
    currentModel: params.currentModel,
    availableModels: params.availableModels,
    modelAvailability: params.modelAvailability,
  });
  const requestedModel = modelResolution.requestedModel;
  const tools = params.tools ?? agentConfig.tools ?? params.agent.tools;
  const pi = buildPiProcessArgs({
    prompt: params.prompt,
    model: modelResolution.actualModel,
    tools,
    piCommand: params.piCommand,
    env: params.env,
  });

  let processResult: PiProcessResult | undefined;
  let parsed: ParsedSubagentResult | undefined;
  let parsedOutput: T | undefined;
  let status: AgentRunStatus = "success";
  let error: WorkflowError | undefined;

  try {
    const spawnProcess = params.spawnProcess ?? spawnPiProcess;
    processResult = await spawnProcess({
      command: pi.command,
      args: pi.args,
      cwd: params.cwd,
      env: pi.env,
      timeoutMs,
      maxOutputBytes,
      registry: globalChildProcessRegistry,
      agentName: params.agent.name,
    });

    if (processResult.cancelled) {
      status = "cancelled";
      error = workflowError("cancelled", "Subagent execution was cancelled.", false, { signal: processResult.signal });
    } else if (processResult.timedOut) {
      status = "timeout";
      error = workflowError("timeout", `Subagent exceeded timeout of ${timeoutMs}ms.`, true);
    } else if (processResult.outputLimitExceeded) {
      status = "failed";
      error = workflowError("subagent", `Subagent output exceeded limit of ${maxOutputBytes} bytes.`, true);
    } else if (processResult.exitCode !== 0) {
      status = "failed";
      error = workflowError(classifyProcessError(processResult), `Subagent exited with code ${processResult.exitCode}.`, true, safeStderr(processResult.stderr));
    } else {
      parsed = parseSubagentResult(processResult.stdout);
      await writeDebugRawOutputIfEnabled(params, parsed.rawOutput, attempt);
      if (params.expectedSchema) {
        try {
          parsedOutput = validateOrThrow<T>(params.expectedSchema, parseJsonOutput(parsed.rawOutput), params.schemaName ?? `${params.agent.name} output`);
        } catch (validationError) {
          if (params.repair?.enabled && params.repair.runRepairPrompt) {
            const repairPrompt = buildRepairPrompt({
              schemaName: params.schemaName ?? `${params.agent.name} output`,
              validationError: formatValidationError(validationError),
              rawOutput: parsed.rawOutput,
              expectedSchema: JSON.stringify(params.expectedSchema, null, 2),
            });
            await writeParseFailureIfEnabled(params, parsed.rawOutput, validationError, attempt);
            const repairedRaw = await params.repair.runRepairPrompt(repairPrompt);
            await writeRepairedOutputIfEnabled(params, repairedRaw, attempt);
            parsedOutput = validateOrThrow<T>(params.expectedSchema, parseJsonOutput(repairedRaw), `${params.schemaName ?? params.agent.name} repaired output`);
            parsed.rawOutput = repairedRaw;
          } else {
            await writeParseFailureIfEnabled(params, parsed.rawOutput, validationError, attempt);
            status = "invalid-output";
            error = workflowError("validation", formatValidationError(validationError), true);
          }
        }
      } else {
        parsedOutput = parseJsonOutput(parsed.rawOutput) as T;
      }
    }
  } catch (caught) {
    status = "failed";
    error = workflowError("unknown", caught instanceof Error ? caught.message : String(caught), true);
  }

  const endedAtDate = new Date();
  return {
    agentName: params.agent.name,
    role: params.agent.role,
    status,
    attempt,
    requestedModel,
    actualModel: modelResolution.actualModel,
    startedAt,
    endedAt: endedAtDate.toISOString(),
    durationMs: processResult?.durationMs ?? endedAtDate.getTime() - startedAtDate.getTime(),
    stdout: processResult?.stdout,
    stderr: processResult?.stderr,
    rawOutput: parsed?.rawOutput,
    parsedOutput,
    usage: parsed?.usage,
    error,
  };
}

export type ModelResolution = {
  requestedModel?: string;
  actualModel?: string;
  fallbackPath: string[];
};

export async function resolveAgentModel(params: {
  agent: AgentDefinition;
  config: BrainstormingProConfig;
  requestedModel?: string;
  currentModel?: string;
  availableModels?: string[];
  modelAvailability?: (model: string) => boolean | Promise<boolean>;
}): Promise<ModelResolution> {
  const agentConfig = params.config.agents[params.agent.name] ?? {};
  const requestedModel = normalizeModelCandidate(params.requestedModel ?? agentConfig.model ?? params.agent.model ?? params.currentModel ?? params.config.models.default);
  const candidates = normalizeModelCandidates([requestedModel, ...params.config.models.fallback]);

  if (candidates.length === 0) return { requestedModel, actualModel: undefined, fallbackPath: [] };
  assertProviderQualifiedModels(candidates, params.agent.name);

  for (const candidate of candidates) {
    const available = await isModelAvailable(candidate, params.availableModels, params.modelAvailability);
    if (available) return { requestedModel, actualModel: candidate, fallbackPath: candidates.slice(0, candidates.indexOf(candidate) + 1) };
  }

  throw workflowError("model-unavailable", `No configured model can run agent ${params.agent.name}. Tried: ${candidates.join(", ")}.`, true, { candidates });
}

export function normalizeModelCandidate(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeModelCandidates(models: Array<string | undefined>): string[] {
  const normalized: string[] = [];
  for (const model of models) {
    const candidate = normalizeModelCandidate(model);
    if (candidate && !normalized.includes(candidate)) normalized.push(candidate);
  }
  return normalized;
}

export function isProviderQualifiedModel(model: string): boolean {
  const normalized = normalizeModelCandidate(model);
  if (!normalized) return false;
  const slash = normalized.indexOf("/");
  return slash > 0 && slash < normalized.length - 1;
}

function assertProviderQualifiedModels(models: string[], agentName: string): void {
  const ambiguous = models.filter((model) => !isProviderQualifiedModel(model));
  if (ambiguous.length === 0) return;
  throw workflowError(
    "model-unavailable",
    `Ambiguous model configuration for agent ${agentName}: ${ambiguous.join(", ")}. Use provider-qualified model IDs in provider/model-id format such as openai/gpt-4o-mini or anthropic/claude-sonnet-4.`,
    true,
    { models, ambiguous, requiredFormat: "provider/model-id" },
  );
}

export function buildPiProcessArgs(params: {
  prompt: string;
  model?: string;
  tools?: string[];
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
}): PiProcessArgs {
  const args = ["--print", "--mode", "json", "--no-session"];
  const model = normalizeModelCandidate(params.model);
  if (model) args.push("--model", model);
  if (params.tools) {
    if (params.tools.length === 0) args.push("--no-tools");
    else args.push("--tools", params.tools.join(","));
  }
  args.push(params.prompt);

  return {
    command: params.piCommand ?? process.env.PI_COMMAND ?? "pi",
    args,
    env: {
      ...process.env,
      ...params.env,
      BRAINSTORMING_PRO_SUBAGENT: "1",
    },
  };
}

export function spawnPiProcess(params: SpawnPiProcessParams): Promise<PiProcessResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cancelled = false;
    let outputLimitExceeded = false;
    let settled = false;

    const options: SpawnOptionsWithoutStdio = {
      cwd: params.cwd,
      env: params.env,
      detached: process.platform !== "win32",
    };
    const child = spawn(params.command, params.args, options);
    params.registry?.register(child, params.agentName);

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      params.signal?.removeEventListener("abort", onAbort);
      params.registry?.unregister(child.pid);
      resolve({
        exitCode,
        signal,
        stdout,
        stderr,
        timedOut,
        cancelled,
        outputLimitExceeded,
        durationMs: Date.now() - startedAt,
      });
    };

    const terminate = (reason: "timeout" | "cancelled" | "output-limit") => {
      if (reason === "timeout") timedOut = true;
      if (reason === "cancelled") cancelled = true;
      if (reason === "output-limit") outputLimitExceeded = true;
      killChild(child);
      setTimeout(() => killChild(child, "SIGKILL"), 1_000).unref?.();
    };

    const append = (stream: "stdout" | "stderr", chunk: Buffer) => {
      if (stream === "stdout") stdout += chunk.toString("utf8");
      else stderr += chunk.toString("utf8");
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > params.maxOutputBytes && !outputLimitExceeded) {
        terminate("output-limit");
      }
    };

    const timeout = setTimeout(() => terminate("timeout"), params.timeoutMs);
    const onAbort = () => terminate("cancelled");
    params.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.on("error", (err) => {
      stderr += err.message;
      finish(1, null);
    });
    child.on("close", (exitCode, signal) => {
      if (outputLimitExceeded || timedOut || cancelled) {
        finish(exitCode, signal);
        return;
      }
      finish(exitCode, signal);
    });
  });
}

export function parseSubagentResult(stdout: string): ParsedSubagentResult {
  const rawLines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let lastAssistantText = "";
  let usage: AgentUsage | undefined;

  for (const line of rawLines) {
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event.usage && typeof event.usage === "object") usage = normalizeUsage(event.usage);
    const message = event.message;
    if ((event.type === "message_end" || event.type === "turn_end") && message?.role === "assistant") {
      const text = extractMessageText(message);
      if (text.trim()) lastAssistantText = text.trim();
      if (message.usage) usage = normalizeUsage(message.usage);
    }
  }

  return { rawOutput: lastAssistantText || stdout.trim(), usage };
}

async function isModelAvailable(
  model: string,
  availableModels?: string[],
  modelAvailability?: (model: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  if (modelAvailability) return Boolean(await modelAvailability(model));
  if (availableModels) return availableModels.includes(model);
  return true;
}

function extractMessageText(message: any): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part: any) => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.content === "string") return part.content;
      return "";
    })
    .join("");
}

function normalizeUsage(value: any): AgentUsage {
  return {
    inputTokens: value.inputTokens ?? value.input_tokens ?? value.prompt_tokens,
    outputTokens: value.outputTokens ?? value.output_tokens ?? value.completion_tokens,
    cacheReadTokens: value.cacheReadTokens ?? value.cache_read_tokens,
    cacheWriteTokens: value.cacheWriteTokens ?? value.cache_write_tokens,
    costUsd: value.costUsd ?? value.cost_usd,
    contextTokens: value.contextTokens ?? value.context_tokens,
  };
}

export function classifyProcessError(result: PiProcessResult): WorkflowError["type"] {
  const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
  if (result.cancelled) return "cancelled";
  if (result.timedOut) return "timeout";
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) return "rate-limit";
  return "subagent";
}

export function isRetryableAgentResult(result: AgentRunResult, config: BrainstormingProConfig): boolean {
  if (result.status === "cancelled" || result.status === "invalid-output") return false;
  if (!result.error) return false;
  return config.retry.retryableErrors.includes(result.error.type);
}

export function computeBackoffDelay(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const delay = initialDelayMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeDebugRawOutputIfEnabled(params: RunSubagentParams, rawOutput: string, attempt: number): Promise<void> {
  if (!params.artifactPaths || params.config.security.debugArtifacts === "disabled") return;
  await writeMarkdownArtifact(params.artifactPaths, `debug/${params.agent.name}-attempt-${attempt}-raw.md`, redactIfNeeded(rawOutput, params.config));
}

async function writeParseFailureIfEnabled(params: RunSubagentParams, rawOutput: string, error: unknown, attempt: number): Promise<void> {
  if (!params.artifactPaths || params.config.security.debugArtifacts === "disabled") return;
  await writeJsonArtifact(params.artifactPaths, `debug/${params.agent.name}-attempt-${attempt}-parse-failure.json`, {
    agent: params.agent.name,
    attempt,
    validationError: formatValidationError(error),
    rawOutput: redactIfNeeded(rawOutput, params.config),
    occurredAt: new Date().toISOString(),
  });
}

async function writeRepairedOutputIfEnabled(params: RunSubagentParams, repairedRaw: string, attempt: number): Promise<void> {
  if (!params.artifactPaths || params.config.security.debugArtifacts === "disabled") return;
  await writeMarkdownArtifact(params.artifactPaths, `debug/${params.agent.name}-attempt-${attempt}-repaired.md`, redactIfNeeded(repairedRaw, params.config));
}

function redactIfNeeded(content: string, config: BrainstormingProConfig): string {
  if (config.security.debugArtifacts !== "redacted") return content;
  return content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,}\]]+/gi, "$1=[REDACTED]");
}

function workflowError(type: WorkflowError["type"], message: string, recoverable: boolean, details?: unknown): WorkflowError {
  return { type, message, recoverable, details, occurredAt: new Date().toISOString() };
}

function safeStderr(stderr: string): { stderr: string } | undefined {
  const trimmed = stderr.trim();
  if (!trimmed) return undefined;
  return { stderr: trimmed.length > 4_000 ? `${trimmed.slice(0, 4_000)}...` : trimmed };
}

function killChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals = "SIGTERM"): void {
  if (child.killed) return;
  try {
    if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Already exited or inaccessible.
    }
  }
}
