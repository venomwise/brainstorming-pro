import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRun, loadState, saveState, writeInterruptedArtifact } from "../../extensions/clarification-orchestrator/artifact-store.ts";
import { parseClarifyArgs } from "../../extensions/clarification-orchestrator/options.ts";
import { resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import { resumeWorkflow } from "../../extensions/clarification-orchestrator/workflow.ts";

async function setup() {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-resume-"));
  const topic = resolveSpecPaths(cwd, "Resume Topic");
  return { cwd, ...(await createRun(topic, parseClarifyArgs("Resume Topic"), cwd)) };
}

test("resumeWorkflow advances from interrupted review to next recoverable phase", async () => {
  const run = await setup();
  const state = await loadState(run.paths);
  state.phase = "REVIEW";
  await saveState(run.paths, state);
  const resumed = await resumeWorkflow({ paths: run.paths, options: state.options, ctx: { hasUI: true, cwd: run.cwd } });
  assert.equal(resumed.phase, "TRIAGE");
});

test("writeInterruptedArtifact records phase active subagents errors and resume instructions", async () => {
  const run = await setup();
  const file = await writeInterruptedArtifact(run.paths, {
    phase: "REFINE",
    activeSubagents: [{ agentName: "refiner", pid: 123, startedAt: "now" }],
    errors: [{ type: "cancelled", message: "ctrl-c", phase: "REFINE", recoverable: true, occurredAt: "now" }],
    completedArtifacts: ["a.md"],
    resumeInstructions: "Resume now",
  });
  const text = await fs.readFile(file, "utf8");
  assert.match(text, /REFINE/);
  assert.match(text, /refiner/);
  assert.match(text, /Resume now/);
});
