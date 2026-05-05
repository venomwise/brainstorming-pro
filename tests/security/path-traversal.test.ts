import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRun, writeMarkdownArtifact, assertArtifactPathAllowed } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import { assertDeletionAllowed } from "../../extensions/clarification-orchestrator/retention.ts";

test("unsafe topics and artifact paths are rejected", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-sec-path-"));
  assert.throws(() => resolveSpecPaths(cwd, "../evil"));
  const topic = resolveSpecPaths(cwd, "Safe Topic");
  const run = await createRun(topic, parseClarifyArgs("Safe Topic"), cwd);
  await assert.rejects(() => writeMarkdownArtifact(run.paths, "../../evil.md", "bad"));
  assert.throws(() => assertArtifactPathAllowed(run.paths, path.join(cwd, "evil.md")));
});

test("deletion is limited to run directories", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-sec-delete-"));
  const topic = resolveSpecPaths(cwd, "Safe Topic");
  assert.throws(() => assertDeletionAllowed(topic, path.join(topic.specDir, "design.md")));
  assert.throws(() => assertDeletionAllowed(topic, path.join(cwd, "outside", "run-1")));
  assert.doesNotThrow(() => assertDeletionAllowed(topic, path.join(topic.clarificationDir, "run-1")));
});
