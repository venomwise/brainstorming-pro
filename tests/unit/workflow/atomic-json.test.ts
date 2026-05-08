import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readWorkflowJson, writeWorkflowAtomicJson } from "../../../extensions/clarification-orchestrator/workflow/atomic-json.ts";

test("writeWorkflowAtomicJson creates parent directories and writes formatted JSON", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bp-atomic-"));
  try {
    const filePath = path.join(dir, "nested", "state.json");
    await writeWorkflowAtomicJson(filePath, { phase: "designing", count: 1 });
    assert.deepEqual(await readWorkflowJson(filePath), { phase: "designing", count: 1 });
    assert.equal(await readFile(filePath, "utf8"), "{\n  \"phase\": \"designing\",\n  \"count\": 1\n}\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("writeWorkflowAtomicJson removes temporary files after write failure", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bp-atomic-failure-"));
  try {
    const directoryAsTarget = path.join(dir, "state.json");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(directoryAsTarget));
    await assert.rejects(() => writeWorkflowAtomicJson(directoryAsTarget, { phase: "designing" }));
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(dir));
    assert.deepEqual(entries, ["state.json"]);
    assert.ok((await stat(directoryAsTarget)).isDirectory());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readWorkflowJson reports parse failures with path context", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bp-atomic-parse-"));
  try {
    const filePath = path.join(dir, "bad.json");
    await writeFile(filePath, "{bad", "utf8");
    await assert.rejects(() => readWorkflowJson(filePath), new RegExp(`Invalid workflow JSON at ${filePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
