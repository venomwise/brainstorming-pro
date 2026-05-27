import test from "node:test";
import assert from "node:assert/strict";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { ListedPiModel } from "../../../extensions/clarification-orchestrator/commands/pi-list-models.ts";
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

function listedModel(provider: string, model: string): ListedPiModel {
  return { provider, model, label: `${provider}/${model}` };
}

function fakeContext(options: {
  model?: FakeModel;
  selected?: string;
  hasUI?: boolean;
  onSelect?: () => void;
}): ExtensionCommandContext {
  return {
    model: options.model,
    hasUI: options.hasUI ?? true,
    modelRegistry: {
      getAvailable: () => { throw new Error("modelRegistry.getAvailable should not be used for workflow picker discovery"); },
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
  assert.equal(modelToProviderQualifiedId(fakeModel("Alpha", "gpt-5.5")), "Alpha/gpt-5.5");
  assert.equal(validateWorkflowAgentModel("Alpha/gpt-5.5"), "Alpha/gpt-5.5");
  assert.throws(() => validateWorkflowAgentModel("gpt-4o-mini"), /non-empty provider and model segments separated by '\/'/);
});

test("prefers current session model without opening picker", async () => {
  let selectCalls = 0;
  let discoveryCalls = 0;
  const current = fakeModel("Alpha", "gpt-5.5");
  const result = await resolveWorkflowAgentModel(fakeContext({
    model: current,
    selected: "openai/gpt-4o-mini",
    onSelect: () => { selectCalls++; },
  }), {
    reason: "start",
    listPiModels: async () => {
      discoveryCalls++;
      return [listedModel("openai", "gpt-4o-mini")];
    },
  });

  assert.equal(result.model, current);
  assert.equal(result.agentModel, "Alpha/gpt-5.5");
  assert.equal(result.source, "current");
  assert.equal(selectCalls, 0);
  assert.equal(discoveryCalls, 0);
});

test("uses pi list-models picker when no current model exists", async () => {
  const result = await resolveWorkflowAgentModel(fakeContext({
    selected: "Alpha/gpt-5.5",
  }), {
    reason: "start",
    listPiModels: async () => [listedModel("openai", "gpt-4o-mini"), listedModel("Alpha", "gpt-5.5")],
  });

  assert.equal(result.model.provider, "Alpha");
  assert.equal(result.model.id, "gpt-5.5");
  assert.equal(result.agentModel, "Alpha/gpt-5.5");
  assert.equal(result.source, "picker");
});

test("rejects cancelled picker without selecting a workflow model", async () => {
  await assert.rejects(
    resolveWorkflowAgentModel(fakeContext({}), {
      reason: "start",
      listPiModels: async () => [listedModel("openai", "gpt-4o-mini")],
    }),
    new RegExp(WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
});

test("rejects empty discovered model list with setup guidance", async () => {
  await assert.rejects(
    resolveWorkflowAgentModel(fakeContext({}), { reason: "start", listPiModels: async () => [] }),
    (error: unknown) => error instanceof Error
      && error.message === WORKFLOW_AGENT_MODEL_NO_AVAILABLE_MESSAGE
      && error.message.includes("pi --list-models")
      && error.message.includes("--model provider/model"),
  );
});

test("rejects non-interactive missing model without discovery or picker", async () => {
  let selectCalls = 0;
  let discoveryCalls = 0;
  await assert.rejects(
    resolveWorkflowAgentModel(fakeContext({
      hasUI: false,
      onSelect: () => { selectCalls++; },
    }), {
      reason: "start",
      interactive: false,
      listPiModels: async () => {
        discoveryCalls++;
        return [listedModel("openai", "gpt-4o-mini")];
      },
    }),
    (error: unknown) => error instanceof Error
      && error.message === WORKFLOW_AGENT_MODEL_NON_INTERACTIVE_MESSAGE
      && error.message.includes("selected model"),
  );
  assert.equal(selectCalls, 0);
  assert.equal(discoveryCalls, 0);
});
