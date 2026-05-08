import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const extensionRoot = "extensions/clarification-orchestrator";
const allowedGateMutationFiles = new Set([
  path.join(extensionRoot, "workflow", "runtime.ts"),
  path.join(extensionRoot, "workflow", "gates.ts"),
  path.join(extensionRoot, "workflow", "state-machine.ts"),
]);

test("derived infrastructure scaffolds cannot bypass workflow gates", async () => {
  const files = await listFiles(extensionRoot, [".ts"]);
  const forbiddenCallPattern = /\b(?:approveGate|transition|recordReviewDecision|writeReviewDecision|mutateReviewDecision)\s*\(/u;

  for (const file of files) {
    if (allowedGateMutationFiles.has(file) || file.includes(`${path.sep}workflow${path.sep}adapters${path.sep}`)) continue;
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, forbiddenCallPattern, `${file} must not mutate workflow gates or transitions`);
  }
});

async function listFiles(root: string, extensions: string[]): Promise<string[]> {
  if (!(await exists(root))) return [];
  const currentStat = await stat(root);
  if (currentStat.isFile()) return extensions.some((extension) => root.endsWith(extension)) ? [root] : [];

  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(entryPath, extensions);
    if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) return [entryPath];
    return [];
  }));
  return files.flat();
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
