import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createExecutionLogger } from "../../extensions/clarification-orchestrator/execution-log.ts";
import { createProgressReporter } from "../../extensions/clarification-orchestrator/progress.ts";
import { hashPrompt, writeDebugInput, writeDebugRawOutput } from "../../extensions/clarification-orchestrator/debug-artifacts.ts";
import { createRun } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import { bundledDefaults } from "../../extensions/clarification-orchestrator/config.ts";

async function setup() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-observe-"));
  const topic = resolveSpecPaths(cwd, "Observe Topic");
  return createRun(topic, parseClarifyArgs("Observe Topic"), cwd);
}

test("progress reporter emits summaries and reviewer events", async () => {
  const messages: string[] = [];
  const reporter = createProgressReporter({ notify: (message) => messages.push(message) });
  reporter.setPhaseProgress("REVIEW", "running");
  reporter.setReviewerStatus("reviewer-product", "complete", 2);
  const run = await setup();
  const summary = reporter.renderProgressSummary(run.state);
  assert.match(summary, /Phase: INIT/);
  assert.ok(messages.some((message) => message.includes("REVIEW")));
});

test("execution logger writes json and text logs", async () => {
  const run = await setup();
  const logger = createExecutionLogger(run.paths);
  await logger.log({ type: "phase", phase: "INIT", message: "started" });
  const json = await fs.readFile(path.join(run.paths.runDir, "execution.log.json"), "utf8");
  const text = await fs.readFile(path.join(run.paths.runDir, "execution.log.txt"), "utf8");
  assert.match(json, /started/);
  assert.match(text, /INIT phase/);
});

test("debug artifacts redact or disable sensitive content and hash prompts", async () => {
  const run = await setup();
  const redacted = { ...bundledDefaults, security: { ...bundledDefaults.security, debugArtifacts: "redacted" as const } };
  await writeDebugInput(run.paths, redacted, "secret", { token: "abc", nested: { email: "a@example.com" } });
  await writeDebugRawOutput(run.paths, redacted, "raw", "password=123");
  const input = await fs.readFile(path.join(run.paths.runDir, "debug", "secret-input.json"), "utf8");
  const raw = await fs.readFile(path.join(run.paths.runDir, "debug", "raw-raw-output.md"), "utf8");
  assert.match(input, /\[REDACTED\]/);
  assert.match(input, /\[REDACTED_EMAIL\]/);
  assert.match(raw, /password=\[REDACTED\]/);
  assert.equal(hashPrompt("abc").length, 64);

  const disabled = { ...bundledDefaults, security: { ...bundledDefaults.security, debugArtifacts: "disabled" as const } };
  const skipped = await writeDebugInput(run.paths, disabled, "disabled", { token: "abc" });
  assert.equal(skipped, undefined);
});
