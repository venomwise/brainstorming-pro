import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ensureFirstRunConfig, parsePiListModels, renderModelChoices, writeFirstRunConfig } from "../../extensions/clarification-orchestrator/first-run-config.ts";

const observedOutput = `
provider              model              context  max-out  thinking  images
 Hotaru-claude         claude-opus-4-7    1M       128K     yes       yes
 Msutools              gpt-4o-mini        128K     16K      no        yes
 OneXModel             grok-4             256K     32K      no        no
 星辰-claude-cheap      claude-3.5-haiku   200K     8K       no        no
 星辰-gpt-pro           gpt-5.5            1M       128K     yes       yes
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

test("writeFirstRunConfig writes expected json shape", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bp-first-run-write-"));
  const configPath = path.join(dir, "nested", "config.json");
  await writeFirstRunConfig(configPath, "openai/gpt-4o", ["anthropic/claude"]);
  const text = await fs.readFile(configPath, "utf8");
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text), { version: 1, models: { default: "openai/gpt-4o", fallback: ["anthropic/claude"] } });
});
