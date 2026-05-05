import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Type } from "typebox";
import { buildPiProcessArgs, computeBackoffDelay, runSubagent, resolveAgentModel, type PiProcessResult } from "../../extensions/clarification-orchestrator/runner.ts";
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
  models: { default: "preferred", fallback: ["fallback-model"] },
  retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 5, retryableErrors: ["subagent", "rate-limit", "timeout"] },
  security: { allowProjectAgents: false, allowProjectToolExpansion: false, debugArtifacts: "disabled" },
  artifacts: { retention: { maxRuns: 5, maxAgeDays: 30 } },
  ui: { verbose: false, progress: true },
};

test("buildPiProcessArgs sets subagent env and tool flags", () => {
  const args = buildPiProcessArgs({ prompt: "hello", model: "m", tools: ["read", "grep"], env: { EXTRA: "1" } });
  assert.equal(args.command, "pi");
  assert.deepEqual(args.args, ["--mode", "json", "--no-session", "--model", "m", "--tools", "read,grep", "hello"]);
  assert.equal(args.env.BRAINSTORMING_PRO_SUBAGENT, "1");
  assert.equal(args.env.EXTRA, "1");
});

test("resolveAgentModel falls back to an available configured model", async () => {
  const resolved = await resolveAgentModel({ agent, config, requestedModel: "missing", availableModels: ["fallback-model"] });
  assert.equal(resolved.requestedModel, "missing");
  assert.equal(resolved.actualModel, "fallback-model");
  assert.deepEqual(resolved.fallbackPath, ["missing", "fallback-model"]);
});

test("runSubagent returns success and captures stderr from the child process", async () => {
  const result = await runSubagent({
    agent,
    cwd: process.cwd(),
    prompt: "return json",
    config,
    availableModels: ["preferred"],
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
  assert.equal(result.actualModel, "preferred");
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
    availableModels: ["preferred"],
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
    availableModels: ["preferred"],
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
    availableModels: ["preferred"],
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
    availableModels: ["preferred"],
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
    availableModels: ["preferred"],
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
    availableModels: ["preferred"],
    artifactPaths: {
      specDir: topic.specDir,
      designPath: topic.designPath,
      clarificationDir: topic.clarificationDir,
      runDir: path.join(topic.clarificationDir, "run-test"),
      debugDir: path.join(topic.clarificationDir, "run-test", "debug"),
      currentJsonPath: path.join(topic.clarificationDir, "current.json"),
      currentSymlinkPath: path.join(topic.clarificationDir, "current"),
      statePath: path.join(topic.clarificationDir, "run-test", "state.json"),
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
