import { createAgentRunError, type AgentRunError, type ProviderQualifiedModel } from "./types.ts";

export function validateProviderQualifiedModel(model: ProviderQualifiedModel): { ok: true; model: ProviderQualifiedModel } | { ok: false; error: AgentRunError } {
  if (typeof model !== "string" || model.trim().length === 0) {
    return {
      ok: false,
      error: createAgentRunError("model-policy-violation", "Agent execution requires a provider-qualified model id."),
    };
  }

  const normalized = model.trim();
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0 || slashIndex === normalized.length - 1 || containsControlCharacter(normalized)) {
    return {
      ok: false,
      error: createAgentRunError(
        "model-policy-violation",
        `Model '${model}' must have non-empty provider and model segments separated by '/'.`,
        { details: { model } },
      ),
    };
  }

  return { ok: true, model: normalized };
}

function containsControlCharacter(value: string): boolean {
  return /\p{Cc}/u.test(value);
}
