import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertUnderSpecRoot, resolveSpecPaths } from "../../extensions/clarification-orchestrator/path-guard.ts";
import { validateClarificationTopicSlug } from "../../extensions/clarification-orchestrator/topic-validation.ts";

test("unsafe topics and spec paths are rejected", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-sec-path-"));
  assert.throws(() => resolveSpecPaths(cwd, "../evil"));
  assert.throws(() => resolveSpecPaths(cwd, "/tmp/evil"));
  assert.throws(() => resolveSpecPaths(cwd, "evil/name"));
  assert.throws(() => resolveSpecPaths(cwd, ".hidden"));
  assert.throws(() => resolveSpecPaths(cwd, "bad\u0001topic"));
  assert.doesNotThrow(() => resolveSpecPaths(cwd, "safe-topic"));
  assert.throws(() => assertUnderSpecRoot(path.join(cwd, "specs"), path.join(cwd, "outside")));
});

test("strict clarification topics reject traversal and path-like values", () => {
  for (const topic of ["../x", "/tmp/x", "foo/bar", ".hidden", "foo\\bar"]) {
    assert.throws(() => validateClarificationTopicSlug(topic));
  }
});
