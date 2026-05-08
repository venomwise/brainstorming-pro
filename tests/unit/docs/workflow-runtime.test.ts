import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function read(path: string): Promise<string> {
  return fs.readFile(path, "utf8");
}

test("README documents runtime commands, gates, and layout", async () => {
  const readme = await read("README.md");
  for (const expected of [
    "/brainstorm-pro \"<request>\" --topic <english-kebab-case-topic>",
    "/brainstorm-pro --resume [topic]",
    "/brainstorm-pro --status [topic]",
    "awaiting-design-review-decision",
    "awaiting-design-approval",
    "awaiting-plan-review-decision",
    "awaiting-plan-approval",
    ".workflow/",
    "events.jsonl",
    "artifacts/",
    "decisions/",
    "approvals/",
  ]) {
    assert.ok(readme.includes(expected), `README should include ${expected}`);
  }
});

test("workflow design documents implemented command and future hook names", async () => {
  const design = await read("specs/workflow-runtime-orchestrator/design.md");
  for (const expected of [
    "/brainstorm-pro \"<request>\" --topic <english-kebab-case-topic>",
    "brainstorming_pro({",
    "RuntimeUserDecision",
    "VersionedArtifactRef",
    "design-approval.json",
    "plan-approval.json",
  ]) {
    assert.ok(design.includes(expected), `design.md should include ${expected}`);
  }
});
