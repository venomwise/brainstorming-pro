import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const extensionRoot = "extensions/clarification-orchestrator";
const allowedPublicCommandNames = new Set(["brainstorm-pro"]);
const disallowedApiNames = [
  "SubagentParams",
  "SubagentResult",
  "ChainStep",
  "AsyncJobState",
  "single",
  "parallel",
  "chain",
  "async",
];

test("extension registers only workflow-owned public commands", async () => {
  const indexSource = await readFile(path.join(extensionRoot, "index.ts"), "utf8");
  const registeredCommands = [...indexSource.matchAll(/registerCommand\(\s*["']([^"']+)["']/gu)].map((match) => match[1]);

  assert.deepEqual(registeredCommands, ["brainstorm-pro"]);
  for (const command of registeredCommands) {
    assert.ok(allowedPublicCommandNames.has(command), `unexpected public command registered: ${command}`);
    assert.notEqual(command, "subagent", "generic pi-subagents command must not be registered");
  }

  const allSources = await readExtensionSources();
  assert.doesNotMatch(allSources.join("\n"), /registerTool\(\s*["']subagent["']/u);
});

test("source does not expose forbidden pi-subagents orchestration APIs", async () => {
  const files = await listFiles(extensionRoot, [".ts"]);
  const allowlist = new Set<string>();

  for (const file of files) {
    if (allowlist.has(file)) continue;
    const source = await readFile(file, "utf8");
    const publicNames = exportedNamesAndCommandOptions(source);

    for (const name of disallowedApiNames) {
      assert.equal(
        publicNames.includes(name),
        false,
        `${file} exposes forbidden copied pi-subagents API name ${name}`,
      );
    }
  }
});

test("intercom, background runner, and builtin agent product files are absent", async () => {
  for (const forbiddenPath of [
    path.join(extensionRoot, "intercom"),
    path.join(extensionRoot, "agents"),
    path.join(extensionRoot, "runs", "background"),
    path.join(extensionRoot, "runtime", "background"),
  ]) {
    assert.equal(await exists(forbiddenPath), false, `${forbiddenPath} must not be introduced by infrastructure reuse`);
  }

  const tsFiles = await listFiles(extensionRoot, [".ts"]);
  const joined = (await Promise.all(tsFiles.map((file) => readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(joined, /from\s+["'][^"']*intercom/u);
  assert.doesNotMatch(joined, /registerCommand\(\s*["'][^"']*(?:async|background|intercom)[^"']*["']/u);
  assert.doesNotMatch(joined, /builtin\s+agent|built-in\s+agent|agents\/researcher|agents\/worker|agents\/delegate/iu);
});

async function readExtensionSources(): Promise<string[]> {
  const files = await listFiles(extensionRoot, [".ts", ".md", ".json"]);
  return Promise.all(files.map((file) => readFile(file, "utf8")));
}

function exportedNamesAndCommandOptions(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/^\s*export\s+(?:type\s+)?(?:type|interface|class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gmu)) {
    names.push(match[1]);
  }
  for (const match of source.matchAll(/registerCommand\(\s*["']([^"']+)["']/gu)) {
    names.push(match[1]);
  }
  for (const match of source.matchAll(/token\s*===\s*["']--([^"']+)["']/gu)) {
    names.push(match[1]);
  }
  return names;
}

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

