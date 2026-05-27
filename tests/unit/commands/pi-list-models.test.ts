import assert from "node:assert/strict";
import test from "node:test";
import { parsePiListModelsOutput, toAgentModelId } from "../../../extensions/clarification-orchestrator/commands/pi-list-models.ts";

test("parses pi --list-models table preserving provider and model text", () => {
  const output = `provider              model                         name\n` +
    `Alpha                 gpt-5.5                       GPT 5.5\n` +
    `Hotaru-claude         claude-sonnet-4                Claude Sonnet\n` +
    `Msutools              gpt_4.1-mini                   GPT Mini\n` +
    `OneXModel             model:with.dash_under          Mixed\n` +
    `星辰-claude-cheap      claude-4                       Chinese provider\n` +
    `星辰-gpt-pro           some-model                     Chinese provider\n`;

  assert.deepEqual(parsePiListModelsOutput(output), [
    { provider: "Alpha", model: "gpt-5.5", label: "Alpha/gpt-5.5" },
    { provider: "Hotaru-claude", model: "claude-sonnet-4", label: "Hotaru-claude/claude-sonnet-4" },
    { provider: "Msutools", model: "gpt_4.1-mini", label: "Msutools/gpt_4.1-mini" },
    { provider: "OneXModel", model: "model:with.dash_under", label: "OneXModel/model:with.dash_under" },
    { provider: "星辰-claude-cheap", model: "claude-4", label: "星辰-claude-cheap/claude-4" },
    { provider: "星辰-gpt-pro", model: "some-model", label: "星辰-gpt-pro/some-model" },
  ]);
});

test("formats listed models without normalizing provider text", () => {
  assert.equal(toAgentModelId({ provider: "Alpha", model: "gpt-5.5", label: "Alpha/gpt-5.5" }), "Alpha/gpt-5.5");
  assert.equal(toAgentModelId({ provider: "星辰-gpt-pro", model: "some-model", label: "星辰-gpt-pro/some-model" }), "星辰-gpt-pro/some-model");
});

test("returns no parseable rows for empty or headerless output", () => {
  assert.deepEqual(parsePiListModelsOutput(""), []);
  assert.deepEqual(parsePiListModelsOutput("Alpha gpt-5.5\nopenai gpt-4o"), []);
});
