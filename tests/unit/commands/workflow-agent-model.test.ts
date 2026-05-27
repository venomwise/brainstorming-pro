import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import {
  modelToProviderQualifiedId,
  resolveWorkflowAgentModel,
  validateWorkflowAgentModel,
  WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE,
  WORKFLOW_AGENT_MODEL_NO_AVAILABLE_MESSAGE,
  WORKFLOW_AGENT_MODEL_NON_INTERACTIVE_MESSAGE,
} from "../../../extensions/clarification-orchestrator/commands/workflow-agent-model.ts";

type FakeModel = NonNullable<ExtensionCommandContext["model"]>;

function fakeModel(provider: string, id: string): FakeModel {
  return { provider, id } as FakeModel;
}

function fakeContext(options: {
  model?: FakeModel;
  available?: FakeModel[];
  selected?: string;
  hasUI?: boolean;
  onSelect?: () => void;
}): ExtensionCommandContext {
  return {
    model: options.model,
    hasUI: options.hasUI ?? true,
    modelRegistry: {
      getAvailable: () => options.available ?? [],
    },
    ui: {
      select: async () => {
        options.onSelect?.();
        return options.selected;
      },
    },
  } as unknown as ExtensionCommandContext;
}

test("formats and validates workflow agent model ids", () => {
  assert.equal(modelToProviderQualifiedId(fakeModel("openai", "gpt-4o-mini")), "openai/gpt-4o-mini");
  assert.equal(validateWorkflowAgentModel("openai/test"), "openai/test");
  assert.throws(() => validateWorkflowAgentModel("gpt-4o-mini"), /Expected format '<provider>\/<model>'/);
});

test("prefers current session model without opening picker", async () => {
  let selectCalls = 0;
  const current = fakeModel("anthropic", "claude-sonnet-4");
  const result = await resolveWorkflowAgentModel(fakeContext({
    model: current,
    available: [fakeModel("openai", "gpt-4o-mini")],
    selected: "openai/gpt-4o-mini",
    onSelect: () => { selectCalls++; },
  }), { reason: "start" });

  assert.equal(result.model, current);
  assert.equal(result.agentModel, "anthropic/claude-sonnet-4");
  assert.equal(result.source, "current");
  assert.equal(selectCalls, 0);
});

test("uses model registry picker when no current model exists", async () => {
  const openai = fakeModel("openai", "gpt-4o-mini");
  const anthropic = fakeModel("anthropic", "claude-sonnet-4");
  const result = await resolveWorkflowAgentModel(fakeContext({
    available: [openai, anthropic],
    selected: "anthropic/claude-sonnet-4",
  }), { reason: "start" });

  assert.equal(result.model, anthropic);
  assert.equal(result.agentModel, "anthropic/claude-sonnet-4");
  assert.equal(result.source, "picker");
});

test("rejects cancelled picker without selecting a workflow model", async () => {
  await assert.rejects(
    resolveWorkflowAgentModel(fakeContext({ available: [fakeModel("openai", "gpt-4o-mini")] }), { reason: "start" }),
    new RegExp(WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("rejects empty model registry with setup guidance", async () => {
  await assert.rejects(
    resolveWorkflowAgentModel(fakeContext({ available: [] }), { reason: "start" }),
    (error: unknown) => error instanceof Error
      && error.message === WORKFLOW_AGENT_MODEL_NO_AVAILABLE_MESSAGE
      && error.message.includes("pi --list-models")
      && error.message.includes("--model provider/model"),
  );
});

test("rejects non-interactive missing model without opening picker", async () => {
  let selectCalls = 0;
  await assert.rejects(
    resolveWorkflowAgentModel(fakeContext({
      available: [fakeModel("openai", "gpt-4o-mini")],
      hasUI: false,
      onSelect: () => { selectCalls++; },
    }), { reason: "start", interactive: false }),
    (error: unknown) => error instanceof Error
      && error.message === WORKFLOW_AGENT_MODEL_NON_INTERACTIVE_MESSAGE
      && error.message.includes("selected model"),
  );
  assert.equal(selectCalls, 0);
});
