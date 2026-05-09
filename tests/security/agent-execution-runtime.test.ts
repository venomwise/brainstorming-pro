import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const runtimeDir = "extensions/clarification-orchestrator/runtime/agent-execution";

test("agent execution runtime exposes no generic subagent product API", async () => {
  const source = await readRuntimeSources();
  assert.doesNotMatch(source, /registerTool\s*\(/u);
  assert.doesNotMatch(source, /registerCommand\s*\(/u);
  assert.doesNotMatch(source, /\bSubagentParams\b|\bSubagentResult\b|\bChainStep\b|\bAsyncJobState\b/u);
  assert.doesNotMatch(source, /intercom|background async|builtin agent/iu);
});

test("agent execution runtime does not expose single parallel chain async public modes", async () => {
  const indexSource = await readFile(path.join(runtimeDir, "index.ts"), "utf8");
  for (const forbidden of ["single", "parallel", "chain", "async"]) {
    assert.doesNotMatch(indexSource, new RegExp(`\\b${forbidden}\\b`, "u"));
  }
});

test("launch code keeps PI_COMMAND non-shell and child mode registration guard exists", async () => {
  const launchSource = await readFile(path.join(runtimeDir, "launch-spec.ts"), "utf8");
  assert.match(launchSource, /shell:\s*false/u);
  assert.doesNotMatch(launchSource, /shell:\s*true/u);
  assert.doesNotMatch(launchSource, /\.split\(\s*["']\s/u);

  const indexSource = await readFile("extensions/clarification-orchestrator/index.ts", "utf8");
  assert.match(indexSource, /BRAINSTORMING_PRO_CHILD/u);
  assert.match(indexSource, /return;/u);
});

test("agent runtime does not directly write workflow approvals or transition workflow state", async () => {
  const source = await readRuntimeSources();
  assert.doesNotMatch(source, /design-approval\.json|plan-approval\.json/u);
  assert.doesNotMatch(source, /transitionWorkflow|transition\(/u);
  assert.doesNotMatch(source, /commitArtifact|writeArtifact|createArtifactVersion/u);
});

async function readRuntimeSources(): Promise<string> {
  const files = (await readdir(runtimeDir)).filter((entry) => entry.endsWith(".ts"));
  return (await Promise.all(files.map((file) => readFile(path.join(runtimeDir, file), "utf8")))).join("\n");
}
