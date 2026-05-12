import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function read(path: string): Promise<string> {
  return fs.readFile(path, "utf8");
}

test("README documents runtime commands, gates, and layout", async () => {
  const readme = await read("README.md");
  for (const expected of [
    "/brainstorm-pro \"<request>\"",
    "/brainstorm-pro \"<request>\" --topic <existing-topic>",
    "/brainstorm-pro --topic <existing-topic>",
    "/brainstorm-pro --resume [topic]",
    "/brainstorm-pro --status [topic]",
    "awaiting-design-review-decision",
    "awaiting-design-approval",
    "plan-review",
    "automatic fixed three-role plan review",
    "awaiting-plan-approval",
    ".workflow/",
    "events.jsonl",
    "artifacts/",
    "decisions/",
    "approvals/",
    "reviews/",
    "review-run.json",
    "product-reviewer.json",
    "scope-simplicity-reviewer.json",
    "Full design review may bind a user-selected subset",
    "incomplete-review",
    "attempts/",
    "coverage.json",
    "accept-incomplete-decision.json",
    "readiness.json",
    "Review readiness is not the same as approval",
  ]) {
    assert.ok(readme.includes(expected), `README should include ${expected}`);
  }
});

test("workflow design documents implemented command and future hook names", async () => {
  const design = await read("specs/workflow-runtime-orchestrator/design.md");
  for (const expected of [
    "/brainstorm-pro \"<request>\"",
    "/brainstorm-pro \"<request>\" --topic <existing-topic>",
    "brainstorming_pro({",
    "RuntimeUserDecision",
    "VersionedArtifactRef",
    "design-approval.json",
    "plan-approval.json",
  ]) {
    assert.ok(design.includes(expected), `design.md should include ${expected}`);
  }
});
