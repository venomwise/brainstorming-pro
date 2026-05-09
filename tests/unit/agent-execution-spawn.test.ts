import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { buildAgentLaunchSpec } from "../../extensions/clarification-orchestrator/runtime/agent-execution/launch-spec.ts";
import { writeAgentPromptFiles } from "../../extensions/clarification-orchestrator/runtime/agent-execution/prompt-files.ts";
import { shouldRetryAgentRun } from "../../extensions/clarification-orchestrator/runtime/agent-execution/retry.ts";
import { spawnAgentProcess } from "../../extensions/clarification-orchestrator/runtime/agent-execution/spawn.ts";
import type { AgentRunLimits } from "../../extensions/clarification-orchestrator/runtime/agent-execution/types.ts";

const limits: AgentRunLimits = {
  timeoutMs: 50,
  maxRetries: 1,
  maxStdoutBytes: 5,
  maxStderrBytes: 4,
  maxOutputBytes: 6,
};

async function withSpec<T>(fn: (spec: ReturnType<typeof buildAgentLaunchSpec>, paths: Awaited<ReturnType<typeof writeAgentPromptFiles>>) => Promise<T>): Promise<T> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-exec-spawn-"));
  try {
    const paths = await writeAgentPromptFiles({
      projectRoot,
      topic: "topic",
      workflowRunId: "run-1",
      agentRunId: "agent-1",
      prompt: "prompt",
      systemPrompt: "system",
    });
    const spec = buildAgentLaunchSpec({
      invocation: { command: "pi", argsPrefix: [], source: "path" },
      role: "design-author",
      model: "openai/gpt-5-mini",
      promptFilePath: paths.promptPath!,
      systemPromptFilePath: paths.systemPromptPath!,
      outputDirectory: paths.agentRunDir,
      cwd: projectRoot,
      env: {},
    });
    return await fn(spec, paths);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

function fakeChild(): ChildProcess & { stdout: PassThrough; stderr: PassThrough; killedByParent: boolean } {
  const child = new EventEmitter() as ChildProcess & { stdout: PassThrough; stderr: PassThrough; killedByParent: boolean };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killedByParent = false;
  child.kill = (() => {
    child.killedByParent = true;
    setImmediate(() => child.emit("close", null, "SIGTERM"));
    return true;
  }) as ChildProcess["kill"];
  return child;
}

test("spawnAgentProcess succeeds and captures bounded output with shell false", async () => {
  await withSpec(async (spec, paths) => {
    let optionsSeen: SpawnOptions | undefined;
    const spawnFn = ((_command: string, _args: readonly string[], options: SpawnOptions) => {
      optionsSeen = options;
      const child = fakeChild();
      setImmediate(() => {
        child.stdout.write(Buffer.from("hello world"));
        child.stderr.write(Buffer.from("error text"));
        child.emit("close", 0, null);
      });
      return child;
    }) as any;

    const result = await spawnAgentProcess(spec, limits, paths, { spawnFn });
    assert.equal(result.status, "succeeded");
    assert.equal(optionsSeen?.shell, false);
    assert.equal(optionsSeen?.detached, false);
    assert.deepEqual(optionsSeen?.stdio, ["ignore", "pipe", "pipe"]);
    assert.equal(result.output.summary.stdoutTruncated, true);
    assert.equal(result.output.summary.stderrTruncated, true);
    assert.equal(result.output.summary.rawOutputTruncated, true);
    assert.equal(await fs.readFile(paths.stdoutPath!, "utf8"), "hello");
    assert.equal(await fs.readFile(paths.stderrPath!, "utf8"), "erro");
    assert.equal(await fs.readFile(paths.rawOutputPath!, "utf8"), "hello ");
  });
});

test("spawnAgentProcess maps non-zero exit, signal, spawn error, and timeout", async () => {
  await withSpec(async (spec, paths) => {
    const nonZero = await spawnAgentProcess(spec, limits, paths, {
      spawnFn: (() => {
        const child = fakeChild();
        setImmediate(() => child.emit("close", 2, null));
        return child;
      }) as any,
    });
    assert.equal(nonZero.status, "failed");
    assert.equal(nonZero.error?.kind, "non-zero-exit");

    const signaled = await spawnAgentProcess(spec, limits, paths, {
      spawnFn: (() => {
        const child = fakeChild();
        setImmediate(() => child.emit("close", null, "SIGINT"));
        return child;
      }) as any,
    });
    assert.equal(signaled.status, "failed");
    assert.equal(signaled.error?.kind, "signal");

    const spawnError = await spawnAgentProcess(spec, limits, paths, {
      spawnFn: (() => {
        throw new Error("spawn pi ENOENT");
      }) as any,
    });
    assert.equal(spawnError.status, "failed");
    assert.equal(spawnError.error?.kind, "spawn-error");

    const timeout = await spawnAgentProcess(spec, { ...limits, timeoutMs: 5 }, paths, {
      spawnFn: (() => fakeChild()) as any,
    });
    assert.equal(timeout.status, "timed-out");
    assert.equal(timeout.error?.kind, "timeout");
  });
});

test("retry helper only retries configured retryable errors within limit", () => {
  assert.equal(shouldRetryAgentRun({ attempt: 1, limits, errorKind: "timeout" }), true);
  assert.equal(shouldRetryAgentRun({ attempt: 2, limits, errorKind: "timeout" }), false);
  assert.equal(shouldRetryAgentRun({ attempt: 1, limits, errorKind: "non-zero-exit" }), false);
});
