import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { redactEnvForMetadata, writeAgentMetadata, writeAgentResult } from "../../extensions/clarification-orchestrator/runtime/agent-execution/audit-files.ts";
import { resolveAgentRunDirectory, writeAgentPromptFiles } from "../../extensions/clarification-orchestrator/runtime/agent-execution/prompt-files.ts";

async function withTempProject<T>(fn: (projectRoot: string) => Promise<T>): Promise<T> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-exec-files-"));
  try {
    return await fn(projectRoot);
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
  }
}

test("prompt and audit file paths stay under topic workflow directory", async () => {
  await withTempProject(async (projectRoot) => {
    const paths = await writeAgentPromptFiles({
      projectRoot,
      topic: "agent-execution-runtime",
      workflowRunId: "run-1",
      agentRunId: "agent-1",
      prompt: "Do the task",
      systemPrompt: "You are controlled",
    });

    const expectedDir = path.join(projectRoot, "specs", "agent-execution-runtime", ".workflow", "runs", "run-1", "agents", "agent-1");
    assert.equal(paths.agentRunDir, expectedDir);
    for (const filePath of Object.values(paths)) {
      assert.ok(filePath.startsWith(expectedDir));
    }
    assert.equal(await fs.readFile(paths.promptPath!, "utf8"), "Do the task");
    assert.equal(await fs.readFile(paths.systemPromptPath!, "utf8"), "You are controlled");
  });
});

test("path traversal identifiers are rejected", () => {
  assert.throws(() => resolveAgentRunDirectory({
    projectRoot: "/repo",
    topic: "../escape",
    workflowRunId: "run-1",
    agentRunId: "agent-1",
  }), /Unsafe topic/u);

  assert.throws(() => resolveAgentRunDirectory({
    projectRoot: "/repo",
    topic: "safe-topic",
    workflowRunId: "run-1",
    agentRunId: "../agent",
  }), /Unsafe agent run id/u);
});

test("metadata and result writers use redacted env data", async () => {
  await withTempProject(async (projectRoot) => {
    const paths = await writeAgentPromptFiles({
      projectRoot,
      topic: "agent-execution-runtime",
      workflowRunId: "run-1",
      agentRunId: "agent-1",
      prompt: "prompt",
      systemPrompt: "system",
    });
    const env = redactEnvForMetadata(
      { BRAINSTORMING_PRO_CHILD: "1", SECRET_TOKEN: "secret", NORMAL_VALUE: "ok" },
      ["BRAINSTORMING_PRO_CHILD", "SECRET_TOKEN", "NORMAL_VALUE"],
    );

    await writeAgentMetadata(paths, {
      agentRunId: "agent-1",
      role: "design-author",
      phase: "designing",
      status: "failed",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      attempts: 0,
      env,
      diagnostics: ["pre-spawn failure"],
    });
    await writeAgentResult(paths, { status: "failed" });

    const metadata = JSON.parse(await fs.readFile(paths.metadataPath!, "utf8"));
    assert.equal(metadata.env.BRAINSTORMING_PRO_CHILD, "1");
    assert.equal(metadata.env.SECRET_TOKEN, "[REDACTED]");
    assert.equal(metadata.env.NORMAL_VALUE, "ok");
    assert.deepEqual(metadata.diagnostics, ["pre-spawn failure"]);

    const result = JSON.parse(await fs.readFile(paths.resultPath!, "utf8"));
    assert.equal(result.status, "failed");
  });
});
