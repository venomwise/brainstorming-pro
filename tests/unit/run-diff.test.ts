import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { compareRuns, listRuns } from "../../extensions/clarification-orchestrator/run-diff.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";

async function setupRuns() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-diff-"));
  const topic = resolveSpecPaths(cwd, "Topic");
  for (const run of ["run-1", "run-2"]) await fs.mkdir(path.join(topic.clarificationDir, run), { recursive: true });
  await fs.writeFile(path.join(topic.clarificationDir, "run-1", "02-design-v1.md"), "a");
  await fs.writeFile(path.join(topic.clarificationDir, "run-2", "02-design-v1.md"), "b");
  await fs.writeFile(path.join(topic.clarificationDir, "run-1", "triage-r1.json"), JSON.stringify({ issues: [{ id: "i1" }] }));
  await fs.writeFile(path.join(topic.clarificationDir, "run-2", "triage-r1.json"), JSON.stringify({ issues: [{ id: "i2" }] }));
  return topic;
}

test("listRuns returns sorted run dirs", async () => {
  const topic = await setupRuns();
  assert.deepEqual(await listRuns(topic), ["run-1", "run-2"]);
});

test("compareRuns compares current and previous by default", async () => {
  const topic = await setupRuns();
  const diff = await compareRuns(topic);
  assert.equal(diff.designChanged, true);
  assert.deepEqual(diff.issues.added, ["i2"]);
  assert.deepEqual(diff.issues.removed, ["i1"]);
});
