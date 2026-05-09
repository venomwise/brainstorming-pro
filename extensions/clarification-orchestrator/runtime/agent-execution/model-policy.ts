import { createAgentRunError, type AgentRunError, type ProviderQualifiedModel } from "./types.ts";

const PROVIDER_QUALIFIED_MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export function validateProviderQualifiedModel(model: ProviderQualifiedModel): { ok: true; model: ProviderQualifiedModel } | { ok: false; error: AgentRunError } {
  if (typeof model !== "string" || model.trim().length === 0) {
    return {
      ok: false,
      error: createAgentRunError("model-policy-violation", "Agent execution requires a provider-qualified model id."),
    };
  }

  const normalized = model.trim();
  if (!PROVIDER_QUALIFIED_MODEL_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: createAgentRunError(
        "model-policy-violation",
        `Model '${model}' is not provider-qualified. Expected format '<provider>/<model>'.`,
        { details: { model } },
      ),
    };
  }

  return { ok: true, model: normalized };
}
