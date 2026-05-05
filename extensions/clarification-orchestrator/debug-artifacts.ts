import crypto from "node:crypto";
import type { RunPaths } from "./artifact-store.ts";
import { writeJsonArtifact, writeMarkdownArtifact } from "./artifact-store.ts";
import type { BrainstormingProConfig } from "./types.ts";

export async function writeDebugInput(paths: RunPaths, config: BrainstormingProConfig, name: string, input: unknown): Promise<string | undefined> {
  if (config.security.debugArtifacts === "disabled") return undefined;
  return writeJsonArtifact(paths, `debug/${safeName(name)}-input.json`, redactValue(input, config));
}

export async function writeDebugRawOutput(paths: RunPaths, config: BrainstormingProConfig, name: string, output: string): Promise<string | undefined> {
  if (config.security.debugArtifacts === "disabled") return undefined;
  return writeMarkdownArtifact(paths, `debug/${safeName(name)}-raw-output.md`, redactString(output, config));
}

export async function writeParseFailure(paths: RunPaths, config: BrainstormingProConfig, name: string, details: unknown): Promise<string | undefined> {
  if (config.security.debugArtifacts === "disabled") return undefined;
  return writeJsonArtifact(paths, `debug/${safeName(name)}-parse-failure.json`, redactValue(details, config));
}

export async function writeRepairedOutput(paths: RunPaths, config: BrainstormingProConfig, name: string, output: string): Promise<string | undefined> {
  if (config.security.debugArtifacts === "disabled") return undefined;
  return writeMarkdownArtifact(paths, `debug/${safeName(name)}-repaired-output.md`, redactString(output, config));
}

export function hashPrompt(prompt: string): string {
  return crypto.createHash("sha256").update(prompt).digest("hex");
}

export function redactValue(value: unknown, config: BrainstormingProConfig): unknown {
  if (config.security.debugArtifacts !== "redacted") return value;
  if (typeof value === "string") return redactString(value, config);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, config));
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/api[_-]?key|token|secret|password/i.test(key)) result[key] = "[REDACTED]";
      else result[key] = redactValue(item, config);
    }
    return result;
  }
  return value;
}

export function redactString(content: string, config: BrainstormingProConfig): string {
  if (config.security.debugArtifacts !== "redacted") return content;
  return content
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]")
    .replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,}\]]+/gi, "$1=[REDACTED]");
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "") || "debug";
}
