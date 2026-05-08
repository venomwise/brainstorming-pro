import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function readme(): Promise<string> {
  return fs.readFile("README.md", "utf8");
}

test("README documents the focused runtime command surface", async () => {
  const text = await readme();
  for (const command of ["/brainstorm-pro \"<request>\"", "/brainstorm-pro \"<request>\" --topic <existing-topic>", "/brainstorm-pro --topic <existing-topic>", "/brainstorm-pro --resume", "/brainstorm-pro --status"]) {
    assert.match(text, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const removed of ["/clarify", "/clarify-status", "/spec-plan", "/spec-exec", "/clarify-doctor", "/clarify-diff", "/clarify-clean"]) {
    assert.doesNotMatch(text, new RegExp("^- `" + removed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "m"));
  }
});
