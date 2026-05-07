import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deriveCurrentProcessPiCommand, ensureFirstRunConfig, listPiModels, parsePiListModels, renderModelChoices, resolvePiCommand, writeFirstRunConfig } from "../../extensions/clarification-orchestrator/first-run-config.ts";
import { resolvePiInvocationSync } from "../../extensions/clarification-orchestrator/pi-command.ts";

const observedOutput = `
provider              model              context  max-out  thinking  images
 Hotaru-claude         claude-opus-4-7    1M       128K     yes       yes
 Msutools              gpt-4o-mini        128K     16K      no        yes
 OneXModel             grok-4             256K     32K      no        no
 星辰-claude-cheap      claude-3.5-haiku   200K     8K       no        no
 星辰-gpt-pro           gpt-5.5            1M       128K     yes       yes
`;

const cjkProviderOutput = `
provider         model              context  max-out  thinking  images
星辰-claude-cheap  claude-opus-4-6    1M       128K     yes       yes   
星辰-claude-cheap  claude-sonnet-4-6  1M       128K     yes       yes   
星辰-gpt-pro       gpt-5.4            1M       128K     yes       yes   
星辰-gpt-pro       gpt-5.5            1M       128K     yes       yes   
Msutools         gpt-5.5            1M       128K     yes       yes   
`;

test("parsePiListModels parses observed provider/model table", () => {
  const models = parsePiListModels(observedOutput);
  assert.deepEqual(models.map((model) => model.id), [
    "Hotaru-claude/claude-opus-4-7",
    "Msutools/gpt-4o-mini",
    "OneXModel/grok-4",
    "星辰-claude-cheap/claude-3.5-haiku",
    "星辰-gpt-pro/gpt-5.5",
  ]);
  assert.equal(models[3].provider, "星辰-claude-cheap");
});

test("parsePiListModels parses CJK provider table aligned by display width", () => {
  const models = parsePiListModels(cjkProviderOutput);
  assert.deepEqual(models.map((model) => model.id), [
    "星辰-claude-cheap/claude-opus-4-6",
    "星辰-claude-cheap/claude-sonnet-4-6",
    "星辰-gpt-pro/gpt-5.4",
    "星辰-gpt-pro/gpt-5.5",
    "Msutools/gpt-5.5",
  ]);
});

test("parsePiListModels ignores blank invalid duplicate and missing header rows", () => {
  const output = `
provider         model              context
 OpenAI           gpt-4o             128K
 OpenAI           gpt-4o             128K
                  missing-provider   128K
 Anthropic                          200K
 Anthropic        claude             200K
`;
  assert.deepEqual(parsePiListModels(output).map((model) => model.id), ["OpenAI/gpt-4o", "Anthropic/claude"]);
  assert.deepEqual(parsePiListModels("model only\nOpenAI gpt-4o"), []);
  assert.deepEqual(parsePiListModels("provider model context\n"), []);
});

test("renderModelChoices numbers provider-qualified ids", () => {
  assert.equal(renderModelChoices(parsePiListModels(observedOutput)).split("\n")[1], "2. Msutools/gpt-4o-mini");
});

test("ensureFirstRunConfig writes selected default and de-duplicated fallback", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-first-run-"));
  const configPath = path.join(dir, "config.json");
  const notifications: string[] = [];
  const answers = ["2", "1,2,1,5"];
  const result = await ensureFirstRunConfig({
    hasUI: true,
    configPath,
    listModels: async () => observedOutput,
    ui: {
      notify: (message) => notifications.push(message),
      input: async () => answers.shift(),
    },
  });

  assert.equal(result.defaultModel, "Msutools/gpt-4o-mini");
  assert.deepEqual(result.fallback, ["Hotaru-claude/claude-opus-4-7", "星辰-gpt-pro/gpt-5.5"]);
  assert.match(notifications.join("\n"), /Brainstorming Pro first-run setup/);
  const written = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.deepEqual(written, {
    version: 1,
    models: {
      default: "Msutools/gpt-4o-mini",
      fallback: ["Hotaru-claude/claude-opus-4-7", "星辰-gpt-pro/gpt-5.5"],
    },
  });
});

test("ensureFirstRunConfig rejects non-interactive empty model list and invalid choices without writing", async () => {
  await assert.rejects(
    ensureFirstRunConfig({ hasUI: false, ui: { notify: () => {} }, listModels: async () => observedOutput }),
    /requires interactive UI/,
  );

  await assert.rejects(
    ensureFirstRunConfig({ hasUI: true, ui: { notify: () => {}, input: async () => "1" }, listModels: async () => "provider model context\n" }),
    /could not discover provider-qualified models/,
  );

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-first-run-invalid-"));
  const configPath = path.join(dir, "config.json");
  await assert.rejects(
    ensureFirstRunConfig({ hasUI: true, configPath, ui: { notify: () => {}, input: async () => "99" }, listModels: async () => observedOutput }),
    /Invalid default model choice '99'/,
  );
  await assert.rejects(fs.access(configPath), /ENOENT/);
});

test("resolvePiCommand compatibility wrapper honors explicit env and resolver fallback", () => {
  const original = process.env.PI_COMMAND;
  try {
    delete process.env.PI_COMMAND;
    assert.equal(resolvePiCommand("/tmp/custom-pi"), "/tmp/custom-pi");
    process.env.PI_COMMAND = "/tmp/env-pi";
    assert.equal(resolvePiCommand(), "/tmp/env-pi");
    delete process.env.PI_COMMAND;
    assert.equal(deriveCurrentProcessPiCommand(["node", "/usr/local/bin/pi"], "/usr/bin/node"), "/usr/local/bin/pi");
    assert.equal(deriveCurrentProcessPiCommand(["node", "pi --bad"], "/usr/bin/node"), undefined);
    assert.equal(resolvePiInvocationSync({ argv: ["node"], execPath: "/usr/bin/node", env: {}, fileExists: () => false, isExecutable: () => false }).command, "pi");
  } finally {
    if (original === undefined) delete process.env.PI_COMMAND;
    else process.env.PI_COMMAND = original;
  }
});

async function writeExecutable(name: string, body: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-pi-command-"));
  const file = path.join(dir, name);
  await fs.writeFile(file, body, "utf8");
  await fs.chmod(file, 0o755);
  return file;
}

test("listPiModels uses explicit piCommand and returns stdout unchanged", async () => {
  const executable = await writeExecutable("pi", `#!/usr/bin/env node\nconsole.log(${JSON.stringify(observedOutput)});\n`);
  assert.equal(await listPiModels(executable), `${observedOutput}\n`);
});

test("listPiModels includes stderr output when pi exits successfully", async () => {
  const executable = await writeExecutable("pi", `#!/usr/bin/env node\nconsole.error(${JSON.stringify(cjkProviderOutput)});\n`);
  assert.deepEqual(parsePiListModels(await listPiModels(executable)).map((model) => model.id), [
    "星辰-claude-cheap/claude-opus-4-6",
    "星辰-claude-cheap/claude-sonnet-4-6",
    "星辰-gpt-pro/gpt-5.4",
    "星辰-gpt-pro/gpt-5.5",
    "Msutools/gpt-5.5",
  ]);
});

test("listPiModels uses PI_COMMAND when explicit command is omitted", async () => {
  const original = process.env.PI_COMMAND;
  const executable = await writeExecutable("pi", `#!/usr/bin/env node\nconsole.log('provider         model              context');\nconsole.log(' Env             model              1K');\n`);
  try {
    process.env.PI_COMMAND = executable;
    assert.match(await listPiModels(), /Env\s+model/);
  } finally {
    if (original === undefined) delete process.env.PI_COMMAND;
    else process.env.PI_COMMAND = original;
  }
});

test("listPiModels reports missing pi command with friendly setup guidance", async () => {
  await assert.rejects(
    listPiModels("/definitely/missing/pi"),
    (error: any) => {
      assert.match(error.message, /Brainstorming Pro first-run setup could not find the pi executable/);
      assert.match(error.message, /which pi/);
      assert.match(error.message, /\/clarify-doctor/);
      assert.match(error.message, /PI_COMMAND/);
      return true;
    },
  );
});

test("listPiModels preserves non-ENOENT spawn diagnostics", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-pi-dir-"));
  await assert.rejects(
    listPiModels(dir),
    (error: any) => {
      assert.match(error.message, /could not start/);
      assert.match(error.message, new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.doesNotMatch(error.message, /not found on its PATH/);
      return true;
    },
  );
});

test("writeFirstRunConfig writes expected json shape", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-first-run-write-"));
  const configPath = path.join(dir, "nested", "config.json");
  await writeFirstRunConfig(configPath, "openai/gpt-4o", ["anthropic/claude"]);
  const text = await fs.readFile(configPath, "utf8");
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text), { version: 1, models: { default: "openai/gpt-4o", fallback: ["anthropic/claude"] } });
});
