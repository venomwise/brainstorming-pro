import path from "node:path";
import { validateClarificationTopicSlug } from "./topic-validation.ts";

export type TopicInfo = {
  displayName: string;
  slug: string;
  specDir: string;
};

export function resolveSpecPaths(cwd: string, topicText: string): TopicInfo {
  const slug = validateClarificationTopicSlug(topicText.trim());
  const specRoot = path.resolve(cwd, "specs");
  const specDir = path.resolve(specRoot, slug);
  assertUnderSpecRoot(specRoot, specDir);
  return { displayName: slug, slug, specDir };
}

export function assertUnderSpecRoot(specRoot: string, targetPath: string): void {
  const root = path.resolve(specRoot);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`Unsafe path outside specs root: ${target}`);
}
