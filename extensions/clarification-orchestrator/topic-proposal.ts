import fs from "node:fs/promises";
import path from "node:path";
import type { TopicCandidate } from "./types.ts";
import { normalizeTopic, validateTopicSafety } from "./path-guard.ts";

const genericWords = new Set([
  "a", "an", "and", "app", "build", "create", "design", "do", "feature", "fix", "for", "help", "implement", "improve", "make", "new", "request", "system", "the", "to", "update", "use", "user", "workflow",
]);

const chineseGloss: Record<string, string> = {
  登录: "login",
  登陆: "login",
  注册: "signup",
  用户: "user",
  权限: "permission",
  支付: "payment",
  订单: "order",
  搜索: "search",
  推荐: "recommendation",
  消息: "message",
  通知: "notification",
  审批: "approval",
  流程: "flow",
  工作流: "workflow",
  设计: "design",
  澄清: "clarification",
  需求: "requirements",
  改进: "improve",
  优化: "optimize",
  管理: "management",
};

export function generateTopicCandidates(request: string, existingTopics: string[] = []): TopicCandidate[] {
  const trimmed = request.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];

  const candidates = new Map<string, TopicCandidate>();
  const language = detectLanguage(trimmed);
  const phrases = language === "zh" ? chineseCandidatePhrases(trimmed) : englishCandidatePhrases(trimmed);

  for (const phrase of phrases) {
    const candidate = toCandidate(phrase, trimmed, language, existingTopics);
    if (!candidate) continue;
    candidates.set(candidate.slug, candidate);
    if (candidates.size >= 3) break;
  }

  if (candidates.size === 0) {
    const fallback = toCandidate(trimmed, trimmed, language, existingTopics);
    if (fallback) candidates.set(fallback.slug, fallback);
  }

  return [...candidates.values()];
}

export type TopicChoiceAction = "use" | "reuse-existing" | "edit" | "manual";

export type TopicChoice = {
  action: TopicChoiceAction;
  label: string;
  topic?: string;
};

export function renderTopicChoices(candidates: TopicCandidate[]): string {
  if (candidates.length === 0) return "No safe topic candidates were generated. Please enter a topic manually.";
  return candidates.map((candidate, index) => {
    const details = [
      `source: ${candidate.sourcePhrase}`,
      candidate.gloss ? `gloss: ${candidate.gloss}` : undefined,
      candidate.language ? `language: ${candidate.language}` : undefined,
      candidate.warnings.length ? `warnings: ${candidate.warnings.join("; ")}` : undefined,
    ].filter(Boolean).join(", ");
    return `${index + 1}. ${candidate.slug} (${candidate.strength}; ${details})`;
  }).join("\n");
}

export function buildTopicChoices(candidates: TopicCandidate[]): TopicChoice[] {
  const choices: TopicChoice[] = [];
  for (const candidate of candidates) {
    if (candidate.exactConflict) {
      choices.push({ action: "reuse-existing", label: `Reuse existing topic ${candidate.slug}`, topic: candidate.slug });
      choices.push({ action: "edit", label: `Edit duplicate candidate ${candidate.slug}`, topic: candidate.slug });
      continue;
    }
    choices.push({ action: "use", label: `Use ${candidate.slug}`, topic: candidate.slug });
    if (candidate.similarTopics?.length) {
      for (const similar of candidate.similarTopics) choices.push({ action: "reuse-existing", label: `Reuse similar existing topic ${similar}`, topic: similar });
    }
  }
  choices.push({ action: "manual", label: "Enter a topic manually" });
  return choices;
}

export async function listExistingSpecTopics(cwd: string): Promise<string[]> {
  const specsDir = path.join(cwd, "specs");
  try {
    const entries = await fs.readdir(specsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export function findSimilarExistingTopics(candidate: string, existingTopics: string[]): string[] {
  const normalized = semanticKey(candidate);
  if (!normalized) return [];
  return existingTopics.filter((topic) => {
    const key = semanticKey(topic);
    return key === normalized || key.includes(normalized) || normalized.includes(key);
  });
}

function toCandidate(phrase: string, request: string, language: string, existingTopics: string[]): TopicCandidate | undefined {
  const sourcePhrase = phrase.trim();
  if (!sourcePhrase) return undefined;
  const warnings: string[] = [];
  let slug = "";
  let unsafe = false;

  const phraseForSlug = language === "zh" ? translateChinesePhrase(sourcePhrase) : sourcePhrase;
  try {
    validateTopicSafety(sourcePhrase);
    slug = normalizeTopic(phraseForSlug).slug;
  } catch (error) {
    unsafe = true;
    warnings.push(error instanceof Error ? error.message : String(error));
    slug = normalizeUnsafe(sourcePhrase);
  }

  if (!slug) return undefined;
  const exactConflict = existingTopics.includes(slug);
  const similarTopics = findSimilarExistingTopics(slug, existingTopics).filter((topic) => topic !== slug);
  const weak = isWeakSlug(slug);
  const strength = unsafe ? "unsafe" : exactConflict ? "duplicate" : weak ? "weak" : "strong";
  if (weak) warnings.push("Candidate appears generic; consider editing it.");
  if (exactConflict) warnings.push(`Exact existing topic conflict: ${slug}`);
  if (similarTopics.length) warnings.push(`Similar existing topics: ${similarTopics.join(", ")}`);

  return {
    slug,
    displayName: sourcePhrase,
    sourcePhrase,
    language,
    gloss: language === "zh" ? phraseForSlug : undefined,
    strength,
    warnings,
    exactConflict,
    similarTopics,
  };
}

function detectLanguage(text: string): "zh" | "en" | "mixed" {
  if (/\p{Script=Han}/u.test(text)) return "zh";
  if (/^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(text)) return "en";
  return "mixed";
}

function englishCandidatePhrases(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = words.filter((word) => !genericWords.has(word));
  const compact = meaningful.length >= 2 ? meaningful : words;
  return unique([
    compact.slice(0, 4).join(" "),
    compact.slice(0, 3).join(" "),
    compact.slice(-3).join(" "),
    words.slice(0, 5).join(" "),
  ]);
}

function chineseCandidatePhrases(text: string): string[] {
  const matches = Object.keys(chineseGloss).filter((term) => text.includes(term));
  const translated = matches.map((term) => chineseGloss[term]);
  const hanChunks = text.match(/[\p{Script=Han}]{2,}/gu) ?? [];
  return unique([
    translated.slice(0, 4).join(" "),
    translated.slice(0, 3).join(" "),
    ...hanChunks.slice(0, 2),
  ].filter(Boolean));
}

function translateChinesePhrase(text: string): string {
  if (/^[\p{Script=Latin}\p{N}\p{P}\p{Zs}]+$/u.test(text)) return text;
  const terms = Object.keys(chineseGloss).filter((term) => text.includes(term)).map((term) => chineseGloss[term]);
  if (terms.length) return terms.join(" ");
  return `topic-${Array.from(text).map((char) => char.codePointAt(0)?.toString(36) ?? "").join("-")}`;
}

function isWeakSlug(slug: string): boolean {
  const parts = slug.split("-").filter(Boolean);
  if (parts.length < 2) return true;
  return parts.every((part) => genericWords.has(part));
}

function normalizeUnsafe(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s_]+/gu, "-").replace(/[^\p{L}\p{N}-]+/gu, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function semanticKey(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/requirements?/g, "requirement")
    .replace(/designs?/g, "design")
    .replace(/flows?/g, "flow")
    .replace(/users?/g, "user")
    .replace(/log-?ins?/g, "login")
    .replace(/sign-?ins?/g, "login")
    .replace(/sign-?ups?/g, "signup")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
