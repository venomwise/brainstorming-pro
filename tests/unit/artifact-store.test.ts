import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRun, inspectExistingSpec, loadRunMetadata, recordCompletedArtifact, resolveCurrentRun, resolveExistingDesignConflict, writeDesignGateDecision, writeJsonArtifact, writeMarkdownArtifact, writeReviewRoundArtifact, writeVersionedDesign } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";

async function tempProject() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-artifacts-"));
}

test("createRun creates state and current pointer", async () => {
  const cwd = await tempProject();
  const topic = resolveSpecPaths(cwd, "My Feature");
  const options = parseClarifyArgs("My Feature");
  const { paths, state } = await createRun(topic, options, cwd, new Date(2026, 4, 4, 12, 30, 0));
  assert.equal(state.metadata.runId, "run-20260504-123000");
  assert.ok(await fs.stat(paths.statePath));
  assert.equal((await resolveCurrentRun(topic))?.runId, "run-20260504-123000");
});

test("write artifacts and record completion", async () => {
  const cwd = await tempProject();
  const topic = resolveSpecPaths(cwd, "Topic");
  const { paths } = await createRun(topic, parseClarifyArgs("Topic"), cwd);
  const md = await writeMarkdownArtifact(paths, "01.md", "hello");
  await writeJsonArtifact(paths, "data.json", { ok: true });
  const state = await recordCompletedArtifact(paths, md);
  assert.equal(state.completedArtifacts.length, 1);
});

test("inspectExistingSpec detects design and run state", async () => {
  const cwd = await tempProject();
  const topic = resolveSpecPaths(cwd, "Topic");
  await fs.mkdir(topic.specDir, { recursive: true });
  await fs.writeFile(topic.designPath, "design");
  await createRun(topic, parseClarifyArgs("Topic"), cwd);
  const existing = await inspectExistingSpec(topic);
  assert.equal(existing.designExists, true);
  assert.equal(existing.stateExists, true);
  assert.deepEqual(resolveExistingDesignConflict(existing), ["resume", "new-run", "overwrite", "abort"]);
});

test("versioned design snapshots mirror latest design", async () => {
  const cwd = await tempProject();
  const topic = resolveSpecPaths(cwd, "Versioned Topic");
  const { paths } = await createRun(topic, parseClarifyArgs("Versioned Topic"), cwd);
  const written = await writeVersionedDesign(paths, 0, "# Design v0");
  assert.equal(await fs.readFile(written.versionPath, "utf8"), "# Design v0");
  assert.equal(await fs.readFile(topic.designPath, "utf8"), "# Design v0");
});

test("metadata file contains resume-aware fields", async () => {
  const cwd = await tempProject();
  const topic = resolveSpecPaths(cwd, "Metadata Topic");
  const { paths } = await createRun(topic, parseClarifyArgs("Metadata Topic"), cwd);
  const metadata = await loadRunMetadata(paths);
  assert.equal(metadata.resumeStatus, "awaiting-design-gate-decision");
  assert.equal(metadata.currentPhase, "INIT");
  assert.equal(metadata.latestVersion, 0);
  assert.ok(metadata.resumeHint.includes("/clarify --resume"));
});

test("review and gate artifact helpers validate paths", async () => {
  const cwd = await tempProject();
  const topic = resolveSpecPaths(cwd, "Review Topic");
  const { paths } = await createRun(topic, parseClarifyArgs("Review Topic"), cwd);
  const gate = await writeDesignGateDecision(paths, 0, { action: "save" });
  const review = await writeReviewRoundArtifact(paths, 1, "triage.json", { issues: [] });
  assert.match(gate, /versions\/v0\/design-gate\.json$/);
  assert.match(review, /reviews\/round-1\/triage\.json$/);
  await assert.rejects(() => writeReviewRoundArtifact(paths, 1, "../escape.json", {}), /must not contain/);
});
