import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ArtifactKind, VersionedArtifactRef } from "./types.ts";
import { validateClarificationTopicSlug } from "../topic-validation.ts";

export type WorkflowLayout = {
  topic: string;
  topicDir: string;
  workflowDir: string;
  artifactsDir: string;
  decisionsDir: string;
  approvalsDir: string;
  eventsPath: string;
};

const mirrorNames: Record<ArtifactKind, string> = {
  design: "design.md",
  requirements: "requirements.md",
  tasks: "tasks.md",
};

export async function createWorkflowLayout(cwd: string, topic: string): Promise<WorkflowLayout> {
  validateClarificationTopicSlug(topic);
  const topicDir = path.resolve(cwd, "specs", topic);
  const workflowDir = path.join(topicDir, ".workflow");
  const layout: WorkflowLayout = {
    topic,
    topicDir,
    workflowDir,
    artifactsDir: path.join(workflowDir, "artifacts"),
    decisionsDir: path.join(workflowDir, "decisions"),
    approvalsDir: path.join(workflowDir, "approvals"),
    eventsPath: path.join(workflowDir, "events.jsonl"),
  };
  assertWorkflowPath(layout, topicDir);
  await fs.mkdir(layout.artifactsDir, { recursive: true });
  await fs.mkdir(layout.decisionsDir, { recursive: true });
  await fs.mkdir(layout.approvalsDir, { recursive: true });
  return layout;
}

export async function writeVersionedArtifact(layout: WorkflowLayout, kind: ArtifactKind, content: string, date = new Date()): Promise<VersionedArtifactRef> {
  if (!content.length) throw new Error(`${kind} artifact content cannot be empty.`);
  const kindDir = path.join(layout.artifactsDir, kind);
  assertWorkflowPath(layout, kindDir);
  await fs.mkdir(kindDir, { recursive: true });
  const version = (await latestVersion(kindDir)) + 1;
  const artifactPath = path.join(kindDir, `v${version}.md`);
  assertWorkflowPath(layout, artifactPath);
  await fs.writeFile(artifactPath, content, { flag: "wx" });
  const ref: VersionedArtifactRef = { kind, version, path: path.relative(layout.topicDir, artifactPath), checksum: checksum(content), createdAt: date.toISOString() };
  await mirrorLatestArtifact(layout, ref);
  return ref;
}

export async function mirrorLatestArtifact(layout: WorkflowLayout, ref: VersionedArtifactRef): Promise<void> {
  const sourcePath = resolveWorkflowPath(layout, ref.path);
  const content = await fs.readFile(sourcePath, "utf8");
  if (checksum(content) !== ref.checksum) throw new Error(`Checksum mismatch for ${ref.kind} v${ref.version}.`);
  const mirrorPath = path.join(layout.topicDir, mirrorNames[ref.kind]);
  assertWorkflowPath(layout, mirrorPath);
  await fs.writeFile(mirrorPath, content);
}

export async function readLatestArtifact(layout: WorkflowLayout, kind: ArtifactKind): Promise<{ content: string; ref: VersionedArtifactRef } | undefined> {
  const kindDir = path.join(layout.artifactsDir, kind);
  const version = await latestVersion(kindDir);
  if (version === 0) return undefined;
  const artifactPath = path.join(kindDir, `v${version}.md`);
  assertWorkflowPath(layout, artifactPath);
  const content = await fs.readFile(artifactPath, "utf8");
  return { content, ref: { kind, version, path: path.relative(layout.topicDir, artifactPath), checksum: checksum(content), createdAt: new Date().toISOString() } };
}

export function assertWorkflowPath(layout: WorkflowLayout, targetPath: string): void {
  const root = path.resolve(layout.topicDir);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
  throw new Error(`Unsafe workflow path outside topic directory: ${target}`);
}

export function resolveWorkflowPath(layout: WorkflowLayout, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error("Workflow artifact paths must be relative.");
  const target = path.resolve(layout.topicDir, relativePath);
  assertWorkflowPath(layout, target);
  return target;
}

export function checksum(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function latestVersion(kindDir: string): Promise<number> {
  try {
    const entries = await fs.readdir(kindDir);
    return entries.reduce((max, entry) => {
      const match = /^v(\d+)\.md$/u.exec(entry);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return 0;
    throw error;
  }
}
