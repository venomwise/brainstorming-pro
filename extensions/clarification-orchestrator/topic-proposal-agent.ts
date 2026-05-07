import path from "node:path";
import type { AgentDefinition, BrainstormingProConfig, TopicCandidate } from "./types.ts";
import { findSimilarExistingTopics } from "./topic-proposal.ts";
import { validateClarificationTopicSlug } from "./topic-validation.ts";
import { parseJsonOutput } from "./validation.ts";
import { runSubagent, type RunSubagentParams } from "./runner.ts";

export type TopicProposalModelRunner = (prompt: string) => Promise<string>;

export type ProposeTopicsWithModelParams = {
  request: string;
  existingTopics?: string[];
  cwd: string;
  packageRoot?: string;
  config: BrainstormingProConfig;
  runModel?: TopicProposalModelRunner;
  runSubagentParams?: Partial<RunSubagentParams>;
};

export async function proposeTopicsWithModel(params: ProposeTopicsWithModelParams): Promise<TopicCandidate[]> {
  const existingTopics = params.existingTopics ?? [];
  const prompt = buildTopicProposalPrompt(params.request, existingTopics);
  const raw = params.runModel ? await params.runModel(prompt) : await runTopicProposalSubagent(params, prompt);
  const slugs = parseTopicProposalOutput(raw);
  const candidates: TopicCandidate[] = [];
  const seen = new Set<string>();

  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    try {
      validateClarificationTopicSlug(slug);
    } catch {
      continue;
    }
    seen.add(slug);
    const exactConflict = existingTopics.includes(slug);
    const similarTopics = findSimilarExistingTopics(slug, existingTopics).filter((topic) => topic !== slug);
    const warnings = [
      exactConflict ? `Exact existing topic conflict: ${slug}` : undefined,
      similarTopics.length ? `Similar existing topics: ${similarTopics.join(", ")}` : undefined,
    ].filter((warning): warning is string => Boolean(warning));
    candidates.push({
      slug,
      displayName: slug,
      sourcePhrase: params.request,
      language: "model",
      strength: exactConflict ? "duplicate" : "strong",
      warnings,
      exactConflict,
      similarTopics,
    });
    if (candidates.length >= 3) break;
  }

  return candidates;
}

export function buildTopicProposalPrompt(request: string, existingTopics: string[] = []): string {
  return [
    "You generate safe clarification topic slugs for Brainstorming Pro.",
    "Derive names from the feature/project meaning. Do not do word-for-word translation.",
    "Return ONLY JSON with this shape: {\"candidates\":[\"english-kebab-case\",\"another-topic\"]}.",
    "Rules: provide 2 or 3 semantic English kebab-case candidates; lowercase ASCII letters/numbers; single hyphens only; no spaces, underscores, paths, dots, Unicode, or explanations.",
    existingTopics.length ? `Existing topics to avoid or mark as semantic context: ${existingTopics.join(", ")}` : "Existing topics: none",
    "Request:",
    request,
  ].join("\n");
}

export function parseTopicProposalOutput(raw: string): string[] {
  const parsed = parseJsonOutput(raw);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { candidates?: unknown }).candidates)) return [];
  return (parsed as { candidates: unknown[] }).candidates.filter((candidate): candidate is string => typeof candidate === "string").map((candidate) => candidate.trim()).filter(Boolean);
}

async function runTopicProposalSubagent(params: ProposeTopicsWithModelParams, prompt: string): Promise<string> {
  const agent: AgentDefinition = {
    name: "topic-proposer",
    role: "designer",
    description: "Proposes English kebab-case clarification topic slugs.",
    path: path.join(params.packageRoot ?? params.cwd, "agents", "topic-proposer.md"),
    source: "bundled",
    tools: [],
    prompt: "Return only the requested JSON topic proposal.",
  };
  const result = await runSubagent({
    agent,
    cwd: params.cwd,
    prompt,
    config: params.config,
    tools: [],
    maxOutputBytes: 20_000,
    ...params.runSubagentParams,
  });
  if (result.status !== "success") throw new Error(result.error?.message ?? "Topic proposal model call failed.");
  return result.rawOutput ?? JSON.stringify(result.parsedOutput ?? {});
}
