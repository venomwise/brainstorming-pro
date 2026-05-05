import path from "node:path";
import type { TopicInfo } from "./types.ts";

export type NormalizedTopic = {
  displayName: string;
  slug: string;
  truncated: boolean;
  fallbackUsed: boolean;
  warnings: string[];
};

const MAX_SLUG_LENGTH = 100;

export function normalizeTopic(topic: string): NormalizedTopic {
  const displayName = topic.trim();
  if (!displayName) throw new Error("Topic cannot be empty.");

  validateTopicSafety(displayName);

  let slug = displayName
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_]+/gu, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  const warnings: string[] = [];
  let fallbackUsed = false;
  let truncated = false;

  if (!slug) {
    slug = `clarification-${timestampSlug(new Date())}`;
    fallbackUsed = true;
    warnings.push("Topic normalized to an empty slug; generated fallback slug.");
  }

  if (slug.length > MAX_SLUG_LENGTH) {
    slug = slug.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "");
    truncated = true;
    warnings.push(`Topic slug truncated to ${MAX_SLUG_LENGTH} characters.`);
  }

  return { displayName, slug, truncated, fallbackUsed, warnings };
}

export function validateTopicSafety(topic: string): void {
  if (!topic.trim()) throw new Error("Topic cannot be empty.");
  if (path.isAbsolute(topic)) throw new Error("Topic must not be an absolute path.");
  if (topic.includes("..")) throw new Error("Topic must not contain '..'.");
  if (topic.includes("/") || topic.includes("\\")) throw new Error("Topic must not contain path separators.");
  if (/\0/.test(topic)) throw new Error("Topic must not contain null bytes.");
}

export function resolveSpecPaths(cwd: string, topic: string): TopicInfo {
  const normalized = normalizeTopic(topic);
  const specsRoot = path.resolve(cwd, "specs");
  const specDir = path.resolve(specsRoot, normalized.slug);
  const designPath = path.resolve(specDir, "design.md");
  const clarificationDir = path.resolve(specDir, "clarification");

  assertUnderSpecRoot(specDir, specsRoot);
  assertUnderSpecRoot(designPath, specsRoot);
  assertUnderSpecRoot(clarificationDir, specsRoot);

  return {
    displayName: normalized.displayName,
    slug: normalized.slug,
    specDir,
    designPath,
    clarificationDir,
  };
}

export function assertUnderSpecRoot(targetPath: string, specsRoot: string): void {
  const root = path.resolve(specsRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`Unsafe path outside specs root: ${target}`);
}

function timestampSlug(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}
