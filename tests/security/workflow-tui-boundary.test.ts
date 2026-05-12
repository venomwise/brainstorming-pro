import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const projectRoot = process.cwd();
const checkedFiles = [
  "extensions/clarification-orchestrator/workflow/progress-types.ts",
  "extensions/clarification-orchestrator/workflow/live-snapshot-store.ts",
  "extensions/clarification-orchestrator/workflow/progress-adapters.ts",
  "extensions/clarification-orchestrator/tui/workflow-result.ts",
  "extensions/clarification-orchestrator/tui/workflow-widget.ts",
  "extensions/clarification-orchestrator/tui/workflow-session.ts",
];

const forbiddenImportFragments = [
  "artifact-store",
  "state-machine",
  "gates",
  "approval",
  "decision-writer",
  "ledger-writer",
  "artifact-commit",
  "checkbox-writer",
];

async function source(file: string): Promise<string> {
  return await readFile(path.join(projectRoot, file), "utf8");
}

test("workflow TUI presentation modules do not import runtime mutation helpers", async () => {
  for (const file of checkedFiles) {
    const content = await source(file);
    for (const fragment of forbiddenImportFragments) {
      assert.doesNotMatch(content, new RegExp(`from [\"'][^\"']*${fragment}`, "u"), `${file} imports ${fragment}`);
    }
  }
});

test("workflow TUI modules do not call approval, retry, accept-incomplete, or transition writers", async () => {
  const forbiddenCalls = ["approveDesign", "approvePlan", "writeApproval", "writeDecision", "retryReviewer", "acceptIncomplete", "transition(", "writeVersionedArtifact", "markTaskComplete"];
  for (const file of checkedFiles) {
    const content = await source(file);
    for (const call of forbiddenCalls) {
      assert.equal(content.includes(call), false, `${file} contains forbidden authority call ${call}`);
    }
  }
});

test("all TUI source files stay presentation-only at import boundary", async () => {
  const tuiDir = path.join(projectRoot, "extensions/clarification-orchestrator/tui");
  const files = (await readdir(tuiDir)).filter((file) => file.endsWith(".ts"));
  for (const file of files) {
    const content = await readFile(path.join(tuiDir, file), "utf8");
    assert.doesNotMatch(content, /from ["'][^"']*workflow\/state-machine/u, file);
    assert.doesNotMatch(content, /from ["'][^"']*workflow\/artifact-store/u, file);
    assert.doesNotMatch(content, /from ["'][^"']*workflow\/gates/u, file);
  }
});
