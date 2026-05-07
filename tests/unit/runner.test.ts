import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { buildPiProcessArgs, computeBackoffDelay, isProviderQualifiedModel, normalizeModelCandidate, runSubagent, resolveAgentModel, type PiProcessResult } from "../../extensions/clarification-orchestrator/runner.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import type { AgentDefinition, BrainstormingProConfig } from "../../extensions/clarification-orchestrator/types.ts";

const agent: AgentDefinition = {
  name: "reviewer-product",
  role: "reviewer",
  description: "",
  path: "",
  source: "bundled",
  tools: ["read"],
  prompt: "",
};

const config: BrainstormingProConfig = {
  version: 1,
  defaults: { mode: "hybrid", maxRounds: 2, threshold: "P1" },
  reviewers: { enabled: ["product"], disabled: [], custom: [], concurrency: 2 },
  agents: {
    "reviewer-product": { timeoutMs: 1000, maxOutputBytes: 1000 },
  },
  models: { default: "anthropic/preferred", fallback: ["openai/fallback-model"] },
  retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5, retryableErrors: ["subagent", "rate-limit", "timeout"] },
  security: { allowProjectAgents: false, allowProjectToolExpansion: false, debugArtifacts: "disabled" },
  artifacts: { retention: { maxRuns: 5, maxAgeDays: 30 } },
  ui: { verbose: false, progress: true },
};

test("buildPiProcessArgs sets subagent env and tool flags", () => {
  const args = buildPiProcessArgs({ prompt: "hello", model: " openai/m ", tools: ["read", "grep"], env: { EXTRA: "1" } });
  assert.ok(args.command === "pi" || args.command.endsWith(`${path.sep}pi`) || args.command.endsWith(`${path.sep}pi.cmd`));
  assert.deepEqual(args.args, ["--print", "--mode", "json", "--no-session", "--model", "openai/m", "--tools", "read,grep", "hello"]);
  assert.equal(args.env.BRAINSTORMING_PRO_SUBAGENT, "1");
  assert.equal(args.env.EXTRA, "1");
});

test("buildPiProcessArgs omits model and preserves no-tools flag", () => {
  const args = buildPiProcessArgs({ prompt: "hello", model: "   ", tools: [] });
  assert.deepEqual(args.args.slice(-6), ["--print", "--mode", "json", "--no-session", "--no-tools", "hello"]);
});

test("buildPiProcessArgs honors explicit piCommand override", () => {
  const args = buildPiProcessArgs({ prompt: "hello", piCommand: "/custom/pi" });
  assert.equal(args.command, "/custom/pi");
  assert.deepEqual(args.args, ["--print", "--mode", "json", "--no-session", "hello"]);
});

test("resolveAgentModel falls back to an available configured model", async () => {
  const resolved = await resolveAgentModel({ agent, config, requestedModel: "anthropic/missing", availableModels: ["openai/fallback-model"] });
  assert.equal(resolved.requestedModel, "anthropic/missing");
  assert.equal(resolved.actualModel, "openai/fallback-model");
  assert.deepEqual(resolved.fallbackPath, ["anthropic/missing", "openai/fallback-model"]);
});

test("resolveAgentModel rejects ambiguous model names", async () => {
  for (const requestedModel of ["gpt-4o", "/gpt-4o", "openai/"]) {
    await assert.rejects(
      resolveAgentModel({ agent, config, requestedModel, availableModels: [requestedModel] }),
      (error: any) => error?.type === "model-unavailable" && /Ambiguous model configuration.*provider\/model-id/.test(error.message),
    );
  }
  assert.equal(isProviderQualifiedModel(" openai/gpt-4o "), true);
  assert.equal(isProviderQualifiedModel("gpt-4o"), false);
  assert.equal(isProviderQualifiedModel("/gpt-4o"), false);
  assert.equal(isProviderQualifiedModel("openai/"), false);
  assert.equal(isProviderQualifiedModel("openai/group/gpt-4o"), true);
  assert.equal(normalizeModelCandidate(" openai/gpt-4o "), "openai/gpt-4o");
  assert.equal(normalizeModelCandidate("   "), undefined);
});

test("resolveAgentModel trims ignores empty values and preserves fallback order", async () => {
  const sparseConfig: BrainstormingProConfig = {
    ...config,
    models: { default: "   ", fallback: [" openai/first ", "", "anthropic/second", "openai/first"] },
  };
  const resolved = await resolveAgentModel({ agent, config: sparseConfig, availableModels: ["anthropic/second"] });
  assert.equal(resolved.requestedModel, undefined);
  assert.equal(resolved.actualModel, "anthropic/second");
  assert.deepEqual(resolved.fallbackPath, ["openai/first", "anthropic/second"]);
});

test("resolveAgentModel allows additional slashes in model id", async () => {
  const resolved = await resolveAgentModel({ agent, config, requestedModel: "gateway/group/gpt-4o", availableModels: ["gateway/group/gpt-4o"] });
  assert.equal(resolved.actualModel, "gateway/group/gpt-4o");
});

test("runSubagent returns success and captures stderr from the child process", async () => {
  const result = await runSubagent({
    agent,
    cwd: process.cwd(),
    prompt: "return json",
    config,
    availableModels: ["anthropic/preferred"],
    spawnProcess: async () => ({
      exitCode: 0,
      signal: null,
      stdout: '{"ok":true}\n',
      stderr: "warning text",
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: false,
      durationMs: 5,
    }),
  });
  assert.equal(result.status, "success");
  assert.equal(result.stderr, "warning text");
  assert.equal(result.actualModel, "anthropic/preferred");
  assert.deepEqual(result.parsedOutput, { ok: true });
});

test("runSubagent retries rate-limit errors with exponential backoff", async () => {
  const delays: number[] = [];
  let calls = 0;
  const result = await runSubagent({
    agent,
    cwd: process.cwd(),
    prompt: "retry me",
    config,
    availableModels: ["anthropic/preferred"],
    sleep: async (ms) => {
      delays.push(ms);
    },
    spawnProcess: async (): Promise<PiProcessResult> => {
      calls += 1;
      if (calls === 1) {
        return {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "429 rate limit exceeded",
          timedOut: false,
          cancelled: false,
          outputLimitExceeded: false,
          durationMs: 1,
        };
      }
      return {
        exitCode: 0,
        signal: null,
        stdout: '{"ok":true}\n',
        stderr: "",
        timedOut: false,
        cancelled: false,
        outputLimitExceeded: false,
        durationMs: 1,
      };
    },
  });
  assert.equal(result.status, "success");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [1]);
});

test("runSubagent surfaces timeout cancellation output limit and repair pass", async () => {
  const timeout = await runSubagent({
    agent,
    cwd: process.cwd(),
    prompt: "timeout",
    config,
    availableModels: ["anthropic/preferred"],
    spawnProcess: async () => ({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: true,
      cancelled: false,
      outputLimitExceeded: false,
      durationMs: 1,
    }),
  });
  assert.equal(timeout.status, "timeout");
  assert.equal(timeout.error?.type, "timeout");

  const cancelled = await runSubagent({
    agent,
    cwd: process.cwd(),
    prompt: "cancel",
    config,
    availableModels: ["anthropic/preferred"],
    spawnProcess: async () => ({
      exitCode: null,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      cancelled: true,
      outputLimitExceeded: false,
      durationMs: 1,
    }),
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.error?.type, "cancelled");

  const outputLimit = await runSubagent({
    agent,
    cwd: process.cwd(),
    prompt: "limit",
    config,
    availableModels: ["anthropic/preferred"],
    spawnProcess: async () => ({
      exitCode: 0,
      signal: null,
      stdout: "x".repeat(10),
      stderr: "",
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: true,
      durationMs: 1,
    }),
  });
  assert.equal(outputLimit.status, "failed");
  assert.equal(outputLimit.error?.type, "subagent");

  const repair = await runSubagent<{ ok: boolean }>({
    agent,
    cwd: process.cwd(),
    prompt: "repair",
    config,
    availableModels: ["anthropic/preferred"],
    expectedSchema: Type.Object({ ok: Type.Boolean() }),
    repair: {
      enabled: true,
      runRepairPrompt: async (promptText) => {
        assert.match(promptText, /Validation errors:/);
        return '{"ok":true}';
      },
    },
    spawnProcess: async () => ({
      exitCode: 0,
      signal: null,
      stdout: "not json\n",
      stderr: "",
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: false,
      durationMs: 1,
    }),
  });
  assert.equal(repair.status, "success");
  assert.deepEqual(repair.parsedOutput, { ok: true });
});

test("runSubagent writes debug artifacts when enabled", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-runner-debug-"));
  const topic = resolveSpecPaths(cwd, "Debug Topic");
  const result = await runSubagent({
    agent,
    cwd,
    prompt: "debug",
    config: { ...config, security: { ...config.security, debugArtifacts: "redacted" } },
    availableModels: ["anthropic/preferred"],
    artifactPaths: {
      specDir: topic.specDir,
      designPath: topic.designPath,
      clarificationDir: topic.clarificationDir,
      runDir: path.join(topic.clarificationDir, "run-test"),
      debugDir: path.join(topic.clarificationDir, "run-test", "debug"),
      currentJsonPath: path.join(topic.clarificationDir, "current.json"),
      currentSymlinkPath: path.join(topic.clarificationDir, "current"),
      statePath: path.join(topic.clarificationDir, "run-test", "state.json"),
      metadataPath: path.join(topic.clarificationDir, "run-test", "metadata.json"),
      versionsDir: path.join(topic.clarificationDir, "run-test", "versions"),
      reviewsDir: path.join(topic.clarificationDir, "run-test", "reviews"),
    },
    spawnProcess: async () => ({
      exitCode: 0,
      signal: null,
      stdout: '{"ok":true}\n',
      stderr: "",
      timedOut: false,
      cancelled: false,
      outputLimitExceeded: false,
      durationMs: 1,
    }),
  });
  assert.equal(result.status, "success");
  const rawPath = path.join(topic.clarificationDir, "run-test", "debug", "reviewer-product-attempt-1-raw.md");
  const raw = await fs.readFile(rawPath, "utf8");
  assert.match(raw, /\{"ok":true\}/);
});
