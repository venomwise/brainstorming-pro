import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { BrainstormingProConfig, ClarifyOptions } from "./types.ts";
import { BrainstormingProConfigSchema } from "./schemas.ts";
import { validateOrThrow } from "./validation.ts";

export const bundledDefaults: BrainstormingProConfig = {
  version: 1,
  defaults: {
    mode: "hybrid",
    maxRounds: 2,
    threshold: "P1",
  },
  reviewers: {
    enabled: ["product", "architecture", "risk", "testing"],
    disabled: [],
    custom: [],
    concurrency: 4,
  },
  agents: {
    designer: { timeoutMs: 300000, maxOutputBytes: 2_000_000 },
    "reviewer-product": { timeoutMs: 300000, maxOutputBytes: 1_000_000 },
    "reviewer-architecture": { timeoutMs: 300000, maxOutputBytes: 1_000_000 },
    "reviewer-risk": { timeoutMs: 300000, maxOutputBytes: 1_000_000 },
    "reviewer-testing": { timeoutMs: 300000, maxOutputBytes: 1_000_000 },
    triager: { timeoutMs: 300000, maxOutputBytes: 1_000_000 },
    refiner: { timeoutMs: 300000, maxOutputBytes: 2_000_000 },
    verifier: { timeoutMs: 300000, maxOutputBytes: 1_000_000 },
  },
  models: {
    fallback: [],
  },
  retry: {
    maxAttempts: 3,
    initialDelayMs: 1000,
    maxDelayMs: 30000,
    retryableErrors: ["subagent", "rate-limit", "timeout"],
  },
  security: {
    allowProjectAgents: false,
    allowProjectToolExpansion: false,
    debugArtifacts: "redacted",
  },
  artifacts: {
    retention: {
      maxRuns: 5,
      maxAgeDays: 30,
    },
  },
  ui: {
    verbose: false,
    progress: true,
  },
};

export type LoadedConfig = {
  config: BrainstormingProConfig;
  loadedFiles: string[];
  securitySensitiveChanges: SecuritySensitiveChange[];
};

export type SecuritySensitiveChange = {
  path: string;
  field: string;
  message: string;
};

export async function loadConfig(cwd: string, overrides?: Partial<ClarifyOptions>): Promise<LoadedConfig> {
  const loadedFiles: string[] = [];
  const securitySensitiveChanges: SecuritySensitiveChange[] = [];
  let config: BrainstormingProConfig = structuredClone(bundledDefaults);

  for (const file of configPaths(cwd)) {
    const partial = await loadConfigFile(file);
    if (!partial) continue;
    loadedFiles.push(file);
    securitySensitiveChanges.push(...detectSecuritySensitiveChanges(partial, file));
    config = mergeConfig(config, partial);
  }

  if (overrides) config = applyCommandOverrides(config, overrides);
  validateConfig(config);
  return { config, loadedFiles, securitySensitiveChanges };
}

export function configPaths(cwd: string): string[] {
  return [
    path.join(os.homedir(), ".pi", "agent", "brainstorming-pro", "config.json"),
    path.join(cwd, ".pi", "brainstorming-pro", "config.json"),
    path.join(cwd, ".pi", "brainstorming-pro", "config.local.json"),
  ];
}

export async function loadConfigFile(file: string): Promise<Partial<BrainstormingProConfig> | undefined> {
  try {
    const text = await fs.readFile(file, "utf8");
    return JSON.parse(text) as Partial<BrainstormingProConfig>;
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in config file ${file}: ${error.message}`);
    throw error;
  }
}

export function mergeConfig(base: BrainstormingProConfig, override: Partial<BrainstormingProConfig>): BrainstormingProConfig {
  const result: any = structuredClone(base);
  deepMerge(result, override);
  return result as BrainstormingProConfig;
}

export function validateConfig(config: BrainstormingProConfig): BrainstormingProConfig {
  return validateOrThrow<BrainstormingProConfig>(BrainstormingProConfigSchema as any, config, "Brainstorming Pro config");
}

export function detectSecuritySensitiveChanges(partial: Partial<BrainstormingProConfig>, file: string): SecuritySensitiveChange[] {
  const changes: SecuritySensitiveChange[] = [];
  if (partial.security?.allowProjectAgents) {
    changes.push({ path: file, field: "security.allowProjectAgents", message: "Project config enables project-local agents." });
  }
  if (partial.security?.allowProjectToolExpansion) {
    changes.push({ path: file, field: "security.allowProjectToolExpansion", message: "Project config allows project-local tool expansion." });
  }
  if (partial.security?.debugArtifacts === "enabled") {
    changes.push({ path: file, field: "security.debugArtifacts", message: "Project config enables raw debug artifacts that may contain sensitive context." });
  }
  for (const [agentName, agentConfig] of Object.entries(partial.agents ?? {})) {
    if (agentConfig?.tools && agentConfig.tools.length > 0) {
      changes.push({ path: file, field: `agents.${agentName}.tools`, message: `Config changes tools for agent ${agentName}.` });
    }
  }
  return changes;
}

export function requiresUserConfirmation(changes: SecuritySensitiveChange[]): boolean {
  return changes.length > 0;
}

function applyCommandOverrides(config: BrainstormingProConfig, overrides: Partial<ClarifyOptions>): BrainstormingProConfig {
  const result = structuredClone(config);
  // /clarify no longer exposes automation, threshold, max-round, or reviewer
  // command overrides. Those values remain package/user/project config only.
  if (overrides.verbose !== undefined) result.ui.verbose = overrides.verbose;
  return result;
}

function deepMerge(target: any, source: any): void {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      target[key] = [...value];
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== "object" || Array.isArray(target[key])) target[key] = {};
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
}
