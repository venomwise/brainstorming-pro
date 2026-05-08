import { complete, type Model, type UserMessage } from "@mariozechner/pi-ai";
import { validateClarificationTopicSlug } from "../topic-validation.ts";

export type TopicProposalInput = {
  request: string;
  model: Model<any>;
  modelRegistry: {
    getApiKeyAndHeaders(model: Model<any>): Promise<{ ok: true; apiKey?: string; headers?: Record<string, string> } | { ok: false; error: string }>;
  };
  signal?: AbortSignal;
};

const topicProposalSystemPrompt = `You generate durable workflow topic slugs for Brainstorming Pro.

Given a user request in any language, summarize the intended project or feature as one concise English kebab-case slug.

Rules:
- Return only the slug, with no prose, quotes, Markdown, JSON, or explanation.
- Use English lowercase ASCII words.
- Use kebab-case with single hyphens.
- Use 2 to 6 meaningful words when possible.
- Do not include path separators, dots, underscores, spaces, leading hyphens, trailing hyphens, or duplicate hyphens.
- Prefer semantic product/feature meaning over literal translation.
- Avoid generic-only slugs like request, brainstorm, feature, update, or change unless there is no meaningful alternative.`;

export async function proposeWorkflowTopic(input: TopicProposalInput): Promise<string> {
  if (!input.request.trim()) throw new Error("Workflow request cannot be empty.");
  const proposed = await requestTopicSlug(input, input.request);
  const normalized = normalizeTopicCandidate(proposed);
  try {
    validateClarificationTopicSlug(normalized);
    return normalized;
  } catch (error) {
    const repaired = normalizeTopicCandidate(await requestTopicSlug(input, `Repair this invalid topic candidate into a valid English kebab-case slug: ${proposed}\n\nOriginal request:\n${input.request}`));
    validateClarificationTopicSlug(repaired);
    return repaired;
  }
}

async function requestTopicSlug(input: TopicProposalInput, request: string): Promise<string> {
  const auth = await input.modelRegistry.getApiKeyAndHeaders(input.model);
  if (!auth.ok || !auth.apiKey) {
    throw new Error(auth.ok ? `No API key configured for ${input.model.provider}; cannot propose workflow topic.` : auth.error);
  }
  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: request }],
    timestamp: Date.now(),
  };
  const response = await complete(input.model, { systemPrompt: topicProposalSystemPrompt, messages: [userMessage] }, { apiKey: auth.apiKey, headers: auth.headers, signal: input.signal });
  if (response.stopReason !== "stop") throw new Error(`Topic proposal failed: ${response.stopReason}${response.errorMessage ? `: ${response.errorMessage}` : ""}`);
  const text = response.content.filter((content): content is { type: "text"; text: string } => content.type === "text").map((content) => content.text).join("\n").trim();
  if (!text) throw new Error("Topic proposal returned an empty slug.");
  return text;
}

function normalizeTopicCandidate(candidate: string): string {
  return candidate.trim().replace(/^```(?:text)?\s*/iu, "").replace(/```$/u, "").replace(/^['"`]+|['"`]+$/gu, "").trim().toLowerCase();
}
