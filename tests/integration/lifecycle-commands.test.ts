import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRun, writeVersionedDesign } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { handleSpecExecCommand } from "../../extensions/clarification-orchestrator/commands/spec-exec.ts";
import { handleSpecPlanCommand } from "../../extensions/clarification-orchestrator/commands/spec-plan.ts";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { runFinalApprovalPhase } from "../../extensions/clarification-orchestrator/phases/final-approval.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";

function ctx(cwd: string) {
  const messages: Array<{ message: string; type?: string }> = [];
  return { messages, ctx: { cwd, ui: { notify: (message: string, type?: string) => messages.push({ message, type }) } } as any };
}

test("final approval prints /spec-plan topic and does not auto invoke", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-life-"));
  const topic = resolveSpecPaths(cwd, "Life Topic");
  const run = await createRun(topic, parseClarifyArgs("Life Topic"), cwd);
  await writeVersionedDesign(run.paths, 0, "# Design");
  await runFinalApprovalPhase({ paths: run.paths, approved: true });
  const text = await fs.readFile(path.join(run.paths.runDir, "final-approval.md"), "utf8");
  assert.match(text, /Run \/spec-plan life-topic/);
  assert.match(text, /does not auto-invoke \/spec-plan/);
});

test("/spec-plan fails clearly without approved design context", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-life-"));
  const harness = ctx(cwd);
  await handleSpecPlanCommand("missing-topic", harness.ctx);
  assert.equal(harness.messages.at(-1)?.type, "error");
  assert.match(harness.messages.at(-1)?.message ?? "", /approved design context not found/);
});

test("/spec-exec refuses without approved requirements and tasks", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-life-"));
  const topic = resolveSpecPaths(cwd, "Exec Topic");
  await fs.mkdir(topic.specDir, { recursive: true });
  const harness = ctx(cwd);
  await handleSpecExecCommand("exec-topic", harness.ctx);
  assert.equal(harness.messages.at(-1)?.type, "error");
  assert.match(harness.messages.at(-1)?.message ?? "", /requirements\.md and tasks\.md/);
});
