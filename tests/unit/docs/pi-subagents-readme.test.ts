import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("README documents pi-subagents infrastructure-only reuse policy", async () => {
  const readme = await readFile("README.md", "utf8");
  for (const expected of [
    "Infrastructure-only pi-subagents reuse",
    "does not directly depend on, register, or expose the generic `pi-subagents` product model",
    "reuse-inventory.json",
    "NOTICE.md",
    "specs/pi-subagents-infrastructure-reuse/design.md",
    "specs/pi-subagents-infrastructure-reuse/requirements.md",
  ]) {
    assert.ok(readme.includes(expected), `README should mention ${expected}`);
  }
});

test("README does not list forbidden pi-subagents product features as public Brainstorming Pro features", async () => {
  const readme = await readFile("README.md", "utf8");
  const commandSection = readme.slice(readme.indexOf("## Commands"), readme.indexOf("## Runtime lifecycle"));
  assert.doesNotMatch(commandSection, /\/subagent\b/u);
  assert.doesNotMatch(commandSection, /intercom/iu);
  assert.doesNotMatch(commandSection, /chain orchestration|async runner|background async/iu);
});
