import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertWorkflowPath, createWorkflowLayout, readLatestArtifact, writeVersionedArtifact } from "../../../extensions/clarification-orchestrator/workflow/artifact-store.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-workflow-artifacts-"));
}

test("writes versioned artifacts and mirrors latest", async () => {
  const cwd = await tempProject();
  const layout = await createWorkflowLayout(cwd, "my-topic");
  const v1 = await writeVersionedArtifact(layout, "design", "# v1");
  const v2 = await writeVersionedArtifact(layout, "design", "# v2");
  assert.equal(v1.version, 1);
  assert.equal(v2.version, 2);
  assert.equal(await fs.readFile(path.join(layout.topicDir, "design.md"), "utf8"), "# v2");
  const latest = await readLatestArtifact(layout, "design");
  assert.equal(latest?.content, "# v2");
});

test("rejects paths outside topic directory", async () => {
  const cwd = await tempProject();
  const layout = await createWorkflowLayout(cwd, "my-topic");
  assert.throws(() => assertWorkflowPath(layout, path.join(cwd, "escape.md")), /Unsafe workflow path/);
});
