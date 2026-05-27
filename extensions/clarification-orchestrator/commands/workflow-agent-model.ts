import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { validateProviderQualifiedModel } from "../runtime/agent-execution/model-policy.ts";
import type { ProviderQualifiedModel } from "../runtime/agent-execution/types.ts";
import { formatListedPiModelChoice, listPiModels, toAgentModelId, type ListedPiModel } from "./pi-list-models.ts";

type WorkflowModel = NonNullable<ExtensionCommandContext["model"]>;

export type WorkflowAgentModelResolutionReason = "start" | "legacy-resume";

export type WorkflowAgentModelResolution = {
  model: WorkflowModel;
  agentModel: ProviderQualifiedModel;
  source: "current" | "picker";
};

export type ResolveWorkflowAgentModelOptions = {
  reason: WorkflowAgentModelResolutionReason;
  interactive?: boolean;
  listPiModels?: () => Promise<ListedPiModel[]>;
};

export const WORKFLOW_AGENT_MODEL_NO_AVAILABLE_MESSAGE = "No parseable Pi model is available for Brainstorming Pro. Check `pi --list-models` output and Pi model configuration, or start Pi with `--model provider/model`.";
export const WORKFLOW_AGENT_MODEL_NON_INTERACTIVE_MESSAGE = "Brainstorming Pro requires a selected model. Start Pi with `--model provider/model` or run interactively to choose a configured model.";
export const WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE = "No workflow model was selected; no workflow was started or recorded.";
export const WORKFLOW_AGENT_MODEL_LEGACY_PATCH_PREFIX = "Legacy workflow still lacks a valid agentModel";

export function formatLegacyWorkflowAgentModelPatchError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`${WORKFLOW_AGENT_MODEL_LEGACY_PATCH_PREFIX}: ${message}`);
}

export function modelToProviderQualifiedId(model: WorkflowModel): ProviderQualifiedModel {
  return `${model.provider}/${model.id}`;
}

export function validateWorkflowAgentModel(modelId: string): ProviderQualifiedModel {
  const result = validateProviderQualifiedModel(modelId);
  if (!result.ok) throw new Error(result.error.message);
  return result.model;
}

export async function resolveWorkflowAgentModel(
  ctx: ExtensionCommandContext,
  options: ResolveWorkflowAgentModelOptions,
): Promise<WorkflowAgentModelResolution> {
  if (ctx.model) {
    return {
      model: ctx.model,
      agentModel: validateWorkflowAgentModel(modelToProviderQualifiedId(ctx.model)),
      source: "current",
    };
  }

  if (options.interactive === false || !ctx.hasUI) throw new Error(WORKFLOW_AGENT_MODEL_NON_INTERACTIVE_MESSAGE);

  const discoverModels = options.listPiModels ?? (() => listPiModels({ cwd: ctx.cwd }));
  const models = await discoverModels();
  if (models.length === 0) throw new Error(WORKFLOW_AGENT_MODEL_NO_AVAILABLE_MESSAGE);

  const choices = models.map(formatListedPiModelChoice);
  const selected = await ctx.ui.select(
    options.reason === "legacy-resume" ? "Select a model for this legacy Brainstorming Pro workflow" : "Select a model for this Brainstorming Pro workflow",
    choices,
  );
  if (!selected) throw new Error(WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE);

  const index = choices.indexOf(selected);
  const listedModel = index >= 0 ? models[index] : undefined;
  if (!listedModel) throw new Error(WORKFLOW_AGENT_MODEL_CANCELLED_MESSAGE);

  const agentModel = validateWorkflowAgentModel(toAgentModelId(listedModel));
  return {
    model: listedPiModelToWorkflowModel(listedModel),
    agentModel,
    source: "picker",
  };
}

function listedPiModelToWorkflowModel(model: ListedPiModel): WorkflowModel {
  return { provider: model.provider, id: model.model } as WorkflowModel;
}
