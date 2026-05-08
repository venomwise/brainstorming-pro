import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";

const scriptPath = path.resolve("scripts/validate-package.ts");
const requiredFiles = [
  "extensions/clarification-orchestrator/index.ts",
  "extensions/clarification-orchestrator/commands/brainstorm-pro.ts",
  "extensions/clarification-orchestrator/workflow/runtime.ts",
  "extensions/clarification-orchestrator/workflow/state-machine.ts",
  "extensions/clarification-orchestrator/workflow/types.ts",
  "skills/brainstorming-pro/SKILL.md",
  "skills/spec-plan-pro/SKILL.md",
  "skills/spec-exec-pro/SKILL.md",
];

type FixtureOptions = {
  packageJson?: Record<string, unknown>;
  omitNotice?: boolean;
  inventoryEntry?: Record<string, unknown>;
  targetSource?: string;
  extraFiles?: Record<string, string>;
};

async function createFixture(options: FixtureOptions = {}): Promise<string> {
  const dir = await mkdtemp();
  for (const file of requiredFiles) {
    await writeFixtureFile(dir, file, file.endsWith(".ts") ? "export {};\n" : "# skill\n");
  }
  await writeFixtureFile(dir, "package.json", JSON.stringify(options.packageJson ?? {
    pi: { extensions: ["./extensions/clarification-orchestrator"], skills: ["./skills"] },
  }, null, 2));
  await writeFixtureFile(dir, "extensions/clarification-orchestrator/vendor/pi-subagents/LICENSE", "MIT License\n");
  if (!options.omitNotice) {
    await writeFixtureFile(dir, "extensions/clarification-orchestrator/vendor/pi-subagents/NOTICE.md", [
      "# notice",
      "pi-subagents@0.24.0",
      "Inspired by nicobailon/pi-subagents",
    ].join("\n"));
  }
  await writeFixtureFile(dir, "extensions/clarification-orchestrator/vendor/pi-subagents/README.md", "# readme\n");
  await writeFixtureFile(dir, "extensions/clarification-orchestrator/vendor/pi-subagents/reuse-inventory.json", JSON.stringify([
    options.inventoryEntry ?? {
      upstreamPath: "src/shared/formatters.ts",
      targetPath: "extensions/clarification-orchestrator/tui/formatters.ts",
      classification: "direct-vendor",
      status: "imported",
      adaptationNotes: "formatters",
      productBoundaryNotes: "formatting only",
    },
  ], null, 2));
  await writeFixtureFile(dir, "extensions/clarification-orchestrator/tui/formatters.ts", options.targetSource ?? [
    "/**",
    " * Derived from nicobailon/pi-subagents src/shared/formatters.ts.",
    " * Upstream notice token: pi-subagents@0.24.0.",
    " * Licensed under the MIT License for Brainstorming Pro adaptation.",
    " */",
    "export {};",
  ].join("\n"));
  for (const [file, content] of Object.entries(options.extraFiles ?? {})) {
    await writeFixtureFile(dir, file, content);
  }
  return dir;
}

function mkdtemp(): Promise<string> {
  return import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(tmpdir(), "bp-validate-")));
}

async function writeFixtureFile(root: string, file: string, content: string): Promise<void> {
  const fullPath = path.join(root, file);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function runValidate(cwd: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("close", (code) => resolve({ code, output: Buffer.concat(chunks).toString("utf8") }));
  });
}

test("validate-package rejects missing pi-subagents notice", async () => {
  const dir = await createFixture({ omitNotice: true });
  try {
    const result = await runValidate(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /NOTICE\.md/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate-package rejects imported derived files without headers", async () => {
  const dir = await createFixture({ targetSource: "export {};\n" });
  try {
    const result = await runValidate(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /missing required header token/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate-package rejects imported targets outside approved directories", async () => {
  const dir = await createFixture({
    inventoryEntry: {
      upstreamPath: "src/shared/formatters.ts",
      targetPath: "extensions/clarification-orchestrator/commands/formatters.ts",
      classification: "direct-vendor",
      status: "imported",
      adaptationNotes: "bad",
      productBoundaryNotes: "bad",
    },
  });
  await writeFixtureFile(dir, "extensions/clarification-orchestrator/commands/formatters.ts", await readFile(path.join(dir, "extensions/clarification-orchestrator/tui/formatters.ts"), "utf8"));
  try {
    const result = await runValidate(dir);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /outside approved Brainstorming Pro directories/u);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("validate-package rejects pi-subagents dependencies and imports", async () => {
  const dependencyDir = await createFixture({
    packageJson: {
      dependencies: { "pi-subagents": "^0.24.0" },
      pi: { extensions: ["./extensions/clarification-orchestrator"], skills: ["./skills"] },
    },
  });
  try {
    const result = await runValidate(dependencyDir);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /must not declare pi-subagents/u);
  } finally {
    await rm(dependencyDir, { recursive: true, force: true });
  }

  const importDir = await createFixture({
    extraFiles: {
      "extensions/clarification-orchestrator/bad-import.ts": "import { x } from 'pi-subagents';\nexport { x };\n",
    },
  });
  try {
    const result = await runValidate(importDir);
    assert.notEqual(result.code, 0);
    assert.match(result.output, /must not import external pi-subagents package/u);
  } finally {
    await rm(importDir, { recursive: true, force: true });
  }
});
