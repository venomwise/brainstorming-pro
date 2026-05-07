import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

async function readme(): Promise<string> {
  return fs.readFile("README.md", "utf8");
}

test("README documents the focused public command surface", async () => {
  const text = await readme();
  for (const command of ["/clarify <request>", "/clarify --resume", "/clarify-status <topic>", "/spec-plan <topic>", "/spec-exec <topic>"]) {
    assert.match(text, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(text, /\/clarify-doctor.*troubleshooting/);
  assert.doesNotMatch(text, /^- `\/clarify-diff\b/m);
  assert.doesNotMatch(text, /^- `\/clarify-clean\b/m);
});

test("README explains internal prompts and PI_COMMAND remediation", async () => {
  const text = await readme();
  assert.match(text, /prompts\/\*\.md/);
  assert.match(text, /not user slash commands/);
  assert.match(text, /PI_COMMAND/);
  assert.match(text, /automatic resolver/);
  assert.match(text, /single executable path/);
  assert.match(text, /which pi/);
  assert.match(text, /PI_COMMAND[^.]*not a shell command with arguments/);
});
