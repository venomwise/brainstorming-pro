import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const files = [
  "extensions/clarification-orchestrator/workflow/progress-types.ts",
  "extensions/clarification-orchestrator/workflow/live-snapshot-store.ts",
  "extensions/clarification-orchestrator/workflow/progress-adapters.ts",
  "extensions/clarification-orchestrator/tui/workflow-result.ts",
  "extensions/clarification-orchestrator/tui/workflow-widget.ts",
  "extensions/clarification-orchestrator/tui/workflow-session.ts",
];

const forbiddenProductTerms = [
  /\bsubagent\b(?!s-derived)/iu,
  /\bsingle\b.*\bparallel\b.*\bchain\b/iu,
  /\bintercom\b/iu,
  /background async runner/iu,
  /builtin agent discovery/iu,
  /choose.*reviewer/iu,
];

test("Spec 8 TUI modules do not expose generic subagent or arbitrary orchestration UI", async () => {
  for (const file of files) {
    const content = await readFile(path.join(process.cwd(), file), "utf8");
    for (const pattern of forbiddenProductTerms) {
      assert.doesNotMatch(content, pattern, `${file} matched ${pattern}`);
    }
  }
});
