import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { runAgent } from "../../extensions/clarification-orchestrator/runtime/agent-execution/run-agent.ts";
import type { AgentOutputSchema, AgentWorkflowContext } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const schema: AgentOutputSchema<{ ok: true }> = {
  name: "ok",
  parse: (raw) => JSON.parse(raw) as unknown,
  validate(value) {
    if ((value as { ok?: unknown }).ok !== true) throw new Error("not ok");
    return { ok: true };
  },
};

async function withWorkflow<T>(fn: (workflow: AgentWorkflowContext) => Promise<T>): Promise<T> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-exec-run-"));
  try {
    const workflow: AgentWorkflowContext = {
      topic: "agent-execution-runtime",
      runId: "run-1",
      phase: "designing",
      projectRoot,
      topicDir: path.join(projectRoot, "specs", "agent-execution-runtime"),
      artifacts: {},
    };
    return await fn(workflow);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

function childWithOutput(output: string, closeCode = 0): ChildProcess & { stdout: PassThrough; stderr: PassThrough } {
  const child = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = (() => true) as ChildProcess["kill"];
  setImmediate(() => {
    child.stdout.write(output);
    child.emit("close", closeCode, null);
  });
  return child;
}

test("runAgent returns validated output without mutating workflow context", async () => {
  await withWorkflow(async (workflow) => {
    const before = JSON.stringify(workflow);
    const events: string[] = [];
    const result = await runAgent({
      role: "design-author",
      purpose: "test",
      prompt: "prompt",
      systemPrompt: "system",
      model: "openai/gpt-5-mini",
      workflow,
      outputSchema: schema,
      env: {},
      onProgress: (event) => {
        events.push(event.type);
      },
    }, {
      spawnFn: (() => childWithOutput('{"ok":true}')) as any,
    });

    assert.equal(result.status, "succeeded");
    assert.deepEqual(result.output, { ok: true });
    assert.equal(JSON.stringify(workflow), before);
    assert.ok(events.includes("agent.started"));
    assert.ok(events.includes("agent.completed"));
    assert.ok(result.paths.resultPath);
    const persisted = JSON.parse(await fs.readFile(result.paths.resultPath!, "utf8"));
    assert.equal(persisted.status, "succeeded");
  });
});

test("runAgent rejects role, model, recursion, and validation failures as typed results", async () => {
  await withWorkflow(async (workflow) => {
    const role = await runAgent({
      role: "plan-author",
      purpose: "test",
      prompt: "prompt",
      systemPrompt: "system",
      model: "openai/gpt-5-mini",
      workflow,
      outputSchema: schema,
      env: {},
    });
    assert.equal(role.status, "failed");
    assert.equal(role.error?.kind, "role-not-allowed");

    const model = await runAgent({
      role: "design-author",
      purpose: "test",
      prompt: "prompt",
      systemPrompt: "system",
      model: "gpt-5-mini",
      workflow,
      outputSchema: schema,
      env: {},
    });
    assert.equal(model.error?.kind, "model-policy-violation");

    const recursion = await runAgent({
      role: "design-author",
      purpose: "test",
      prompt: "prompt",
      systemPrompt: "system",
      model: "openai/gpt-5-mini",
      workflow,
      outputSchema: schema,
      env: { BRAINSTORMING_PRO_CHILD: "1" },
    });
    assert.equal(recursion.error?.kind, "recursion-depth-exceeded");

    const validation = await runAgent({
      role: "design-author",
      purpose: "test",
      prompt: "prompt",
      systemPrompt: "system",
      model: "openai/gpt-5-mini",
      workflow,
      outputSchema: schema,
      env: {},
    }, {
      spawnFn: (() => childWithOutput('{"ok":false}')) as any,
    });
    assert.equal(validation.status, "invalid-output");
    assert.equal(validation.error?.kind, "schema-validation-failed");
  });
});
