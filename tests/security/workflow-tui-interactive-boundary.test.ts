import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const tuiInteractiveModules = [
  "extensions/clarification-orchestrator/tui/interactive-gates.ts",
  "extensions/clarification-orchestrator/tui/decision-submission.ts",
  "extensions/clarification-orchestrator/tui/decision-controls.ts",
  "extensions/clarification-orchestrator/tui/workflow-widget.ts",
];

const forbiddenPatterns = [
  /from "\.\.\/workflow\/gates\.ts"/,
  /from "\.\.\/workflow\/artifact-store\.ts"/,
  /from "\.\.\/workflow\/state-machine\.ts"/,
  /recordReviewDecision/,
  /approveGate/,
  /writeVersionedArtifact/,
  /transition\(/,
  /writeFile/,
  /appendFile/,
  /checkbox/i,
];

test("interactive TUI modules remain facade-only and avoid durable writers", async () => {
  for (const modulePath of tuiInteractiveModules) {
    const source = await readFile(modulePath, "utf8");
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${modulePath} must not match ${pattern}`);
    }
  }
});

test("TUI decision submission mutates only through runtime decision facade", async () => {
  const source = await readFile("extensions/clarification-orchestrator/tui/decision-submission.ts", "utf8");
  assert.match(source, /submitWorkflowDecision/);
  assert.doesNotMatch(source, /saveWorkflowState|loadLatestWorkflowState|fs\./);
});

test("interactive controls do not expose generic subagent or background orchestration", async () => {
  for (const modulePath of tuiInteractiveModules) {
    const source = await readFile(modulePath, "utf8");
    assert.doesNotMatch(source, /intercom|background runner|builtin agent|single\(|parallel\(|chain\(/i, modulePath);
  }
});
