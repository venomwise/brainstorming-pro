import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path: string): Promise<string> {
  return readFile(path, "utf8");
}

test("pi-subagents scaffold docs preserve workflow-first terminology and boundaries", async () => {
  const docs = await Promise.all([
    read("extensions/clarification-orchestrator/runtime/agent-execution/README.md"),
    read("extensions/clarification-orchestrator/tui/README.md"),
    read("extensions/clarification-orchestrator/workflow/live-snapshot-policy.md"),
    read("extensions/clarification-orchestrator/vendor/pi-subagents/README.md"),
  ]);
  const combined = docs.join("\n");

  for (const expected of [
    "Brainstorming Pro",
    "workflow-first",
    "WorkflowLiveSnapshot",
    "non-interactive",
    "plain text fallback",
    "cannot approve gates",
    "must not expose generic",
    "single",
    "parallel",
    "chain",
    "async",
  ]) {
    assert.ok(combined.includes(expected), `scaffold docs should mention ${expected}`);
  }
});

test("live snapshot docs keep TUI rendering read-only", async () => {
  const policy = await read("extensions/clarification-orchestrator/workflow/live-snapshot-policy.md");
  for (const expected of [
    "snapshot is never the authoritative workflow state",
    "must not call gate approval helpers",
    "transition the state machine",
    "mutate review decisions",
    "degrade to markdown/plain text status output",
  ]) {
    assert.ok(policy.includes(expected), `live snapshot policy should mention ${expected}`);
  }
});
