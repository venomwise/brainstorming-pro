import fs from "node:fs/promises";
import path from "node:path";
import type { AgentDefinition, AgentRole, AgentSource, BrainstormingProConfig } from "./types.ts";

export type AgentDiscoveryOptions = {
  packageRoot: string;
  cwd: string;
  includeUserOverrides?: boolean;
  includeProjectOverrides?: boolean;
  userAgentsDir?: string;
};

export type ParsedAgentFile = {
  frontmatter: Record<string, string>;
  body: string;
};

const roleByName: Array<[RegExp, AgentRole]> = [
  [/^designer$/, "designer"],
  [/^reviewer-/, "reviewer"],
  [/^triager$/, "triager"],
  [/^refiner$/, "refiner"],
  [/^verifier$/, "verifier"],
];

export async function discoverAgents(options: AgentDiscoveryOptions): Promise<AgentDefinition[]> {
  const discovered: AgentDefinition[] = [];
  const bundledDir = path.join(options.packageRoot, "agents");
  discovered.push(...(await discoverAgentDir(bundledDir, "bundled")));

  if (options.includeUserOverrides) {
    const userDir = options.userAgentsDir ?? path.join(process.env.HOME ?? "", ".pi", "agent", "brainstorming-pro", "agents");
    discovered.push(...(await discoverAgentDir(userDir, "user")));
  }

  if (options.includeProjectOverrides) {
    const projectDir = path.join(options.cwd, ".pi", "brainstorming-pro", "agents");
    discovered.push(...(await discoverAgentDir(projectDir, "project")));
  }

  return resolveAgentPriority(discovered);
}

export async function discoverAgentDir(dir: string, source: AgentSource): Promise<AgentDefinition[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const agents: AgentDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith(".md")) continue;
    agents.push(await loadAgentFile(path.join(dir, entry), source));
  }
  return agents;
}

export async function loadAgentFile(file: string, source: AgentSource): Promise<AgentDefinition> {
  const text = await fs.readFile(file, "utf8");
  const parsed = parseAgentFrontmatter(text);
  const name = parsed.frontmatter.name;
  if (!name) throw new Error(`Agent file ${file} is missing frontmatter field 'name'.`);
  const description = parsed.frontmatter.description ?? "";
  const tools = parseTools(parsed.frontmatter.tools);
  const model = parsed.frontmatter.model;
  return {
    name,
    role: inferAgentRole(name),
    description,
    path: file,
    source,
    tools,
    model,
    prompt: parsed.body.trim(),
  };
}

export function parseAgentFrontmatter(text: string): ParsedAgentFile {
  if (!text.startsWith("---")) return { frontmatter: {}, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: text };
  const raw = text.slice(3, end).trim();
  const body = text.slice(end + 4).replace(/^\s*\n/, "");
  const frontmatter: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf(":");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    frontmatter[key] = stripQuotes(value);
  }
  return { frontmatter, body };
}

export function resolveAgentSelection(agents: AgentDefinition[], names: string[]): AgentDefinition[] {
  const byName = new Map(agents.map((agent) => [agent.name, agent]));
  return names.map((name) => {
    const direct = byName.get(name);
    if (direct) return direct;
    const reviewer = byName.get(name.startsWith("reviewer-") ? name : `reviewer-${name}`);
    if (reviewer) return reviewer;
    throw new Error(`Unknown agent or reviewer '${name}'.`);
  });
}

export function resolveReviewerSelection(config: BrainstormingProConfig, agents: AgentDefinition[], commandReviewers?: string[]): AgentDefinition[] {
  const requested = commandReviewers && commandReviewers.length > 0 ? commandReviewers : config.reviewers.enabled;
  const disabled = new Set(config.reviewers.disabled);
  const active = requested.filter((name) => !disabled.has(name) && !disabled.has(`reviewer-${name}`));
  return resolveAgentSelection(agents, active);
}

export function resolveAllowedTools(agent: AgentDefinition, config: BrainstormingProConfig): string[] {
  const configured = config.agents[agent.name]?.tools;
  const tools = configured ?? agent.tools ?? defaultToolsForRole(agent.role, agent.name);
  return [...new Set(tools.filter(Boolean))];
}

export function detectToolExpansion(agent: AgentDefinition, resolvedTools: string[]): string[] {
  const defaults = new Set(defaultToolsForRole(agent.role, agent.name));
  return resolvedTools.filter((tool) => !defaults.has(tool));
}

export function defaultToolsForRole(role: AgentRole, name: string): string[] {
  if (role === "designer") return ["read", "find", "grep", "ls"];
  if (role === "reviewer") return ["read", "find", "grep", "ls"];
  if (role === "triager") return [];
  if (role === "refiner") return ["read"];
  if (role === "verifier") return ["read"];
  throw new Error(`No default tools for agent ${name}`);
}

function resolveAgentPriority(agents: AgentDefinition[]): AgentDefinition[] {
  const priority: Record<AgentSource, number> = { bundled: 0, user: 1, project: 2 };
  const byName = new Map<string, AgentDefinition>();
  for (const agent of agents) {
    const current = byName.get(agent.name);
    if (!current || priority[agent.source] > priority[current.source]) byName.set(agent.name, agent);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function inferAgentRole(name: string): AgentRole {
  for (const [pattern, role] of roleByName) {
    if (pattern.test(name)) return role;
  }
  if (name.includes("reviewer")) return "reviewer";
  throw new Error(`Cannot infer role for agent '${name}'.`);
}

function parseTools(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((tool) => tool.trim()).filter(Boolean);
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}
