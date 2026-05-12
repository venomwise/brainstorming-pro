import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runAgent } from "../../extensions/clarification-orchestrator/runtime/agent-execution/run-agent.ts";
import type { AgentOutputSchema, AgentWorkflowContext } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const fixture = path.resolve("tests/fixtures/agent-execution/fake-child.mjs");

type Output = { ok: true; argv?: string[]; env?: Record<string, string> };
const schema: AgentOutputSchema<Output> = {
  name: "fixture-output",
  parse: (raw) => JSON.parse(raw) as unknown,
  validate(value) {
    if ((value as { ok?: unknown }).ok !== true) throw new Error("not ok");
    return value as Output;
  },
};

async function withWorkflow<T>(mode: string, fn: (workflow: AgentWorkflowContext, env: NodeJS.ProcessEnv) => Promise<T>): Promise<T> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-exec-integration-"));
  return fn({
    topic: "agent-execution-runtime",
    runId: `run-${mode}`,
    phase: "designing",
    projectRoot,
    topicDir: path.join(projectRoot, "specs", "agent-execution-runtime"),
    artifacts: {},
  }, { AGENT_EXECUTION_FAKE_MODE: mode });
}

async function runFixture(mode: string, limits = {}) {
  return withWorkflow(mode, (workflow, env) => runAgent({
    role: "design-author",
    purpose: `fixture ${mode}`,
    prompt: "prompt",
    systemPrompt: "system",
    model: "openai/gpt-5-mini",
    workflow,
    outputSchema: schema,
    piCommand: process.execPath,
    env,
    limits: { timeoutMs: 1000, maxStdoutBytes: 4096, maxStderrBytes: 64, maxOutputBytes: 4096, ...limits },
  }, {
    spawnFn: ((command: string, args: readonly string[], options: any) => spawn(command, [fixture, ...args], options)) as any,
  }).then((result) => result));
}

test("runAgent succeeds against valid fake child and passes env/args", async () => {
  const result = await runFixture("valid");
  assert.equal(result.status, "succeeded");
  assert.equal(result.output?.ok, true);
  assert.equal(result.output?.env?.BRAINSTORMING_PRO_CHILD, "1");
  assert.equal(result.output?.env?.BRAINSTORMING_PRO_AGENT_ROLE, "design-author");
  assert.ok(result.output?.argv?.includes("--no-session"));
  assert.ok(result.output?.argv?.includes("--no-skills"));
  assert.ok(await fs.stat(result.paths.promptPath!).then(() => true));
});

test("runAgent handles non-zero, timeout, huge output, malformed, and schema-invalid fake children", async () => {
  const nonZero = await runFixture("non-zero");
  assert.equal(nonZero.status, "failed");
  assert.equal(nonZero.error?.kind, "non-zero-exit");

  const timeout = await runFixture("timeout", { timeoutMs: 10 });
  assert.equal(timeout.status, "timed-out");

  const huge = await runFixture("huge", { maxStdoutBytes: 8, maxOutputBytes: 8 });
  assert.equal(huge.status, "invalid-output");
  assert.equal(huge.attemptRecords[0]?.outputCapture?.stdoutTruncated, true);

  const malformed = await runFixture("malformed");
  assert.equal(malformed.status, "invalid-output");
  assert.equal(malformed.error?.kind, "invalid-output");

  const schemaInvalid = await runFixture("schema");
  assert.equal(schemaInvalid.status, "invalid-output");
  assert.equal(schemaInvalid.error?.kind, "schema-validation-failed");
});
