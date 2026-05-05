import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectToolExpansion, discoverAgents, parseAgentFrontmatter, resolveAgentSelection, resolveAllowedTools } from "../../extensions/clarification-orchestrator/agents.ts";
import { bundledDefaults } from "../../extensions/clarification-orchestrator/config.ts";

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-agents-"));
}

async function writeAgent(root: string, rel: string, name: string, tools = "read") {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `---\nname: ${name}\ndescription: Test agent\ntools: ${tools}\n---\n\nPrompt body\n`);
}

test("parseAgentFrontmatter parses yaml-like fields", () => {
  const parsed = parseAgentFrontmatter("---\nname: designer\ntools: read, grep\n---\nBody");
  assert.equal(parsed.frontmatter.name, "designer");
  assert.equal(parsed.frontmatter.tools, "read, grep");
  assert.equal(parsed.body, "Body");
});

test("discoverAgents loads bundled and user override priority", async () => {
  const root = await tempDir();
  const user = await tempDir();
  await writeAgent(root, "agents/designer.md", "designer", "read");
  await writeAgent(user, "designer.md", "designer", "read, grep");
  const agents = await discoverAgents({ packageRoot: root, cwd: root, includeUserOverrides: true, userAgentsDir: user });
  const designer = agents.find((agent) => agent.name === "designer");
  assert.equal(designer?.source, "user");
  assert.deepEqual(designer?.tools, ["read", "grep"]);
});

test("resolveAgentSelection accepts reviewer shorthand", async () => {
  const root = await tempDir();
  await writeAgent(root, "agents/reviewer-product.md", "reviewer-product");
  const agents = await discoverAgents({ packageRoot: root, cwd: root });
  assert.equal(resolveAgentSelection(agents, ["product"])[0].name, "reviewer-product");
});

test("resolveAllowedTools uses config override and detects expansion", async () => {
  const root = await tempDir();
  await writeAgent(root, "agents/refiner.md", "refiner", "read");
  const [agent] = await discoverAgents({ packageRoot: root, cwd: root });
  const config = structuredClone(bundledDefaults);
  config.agents.refiner = { tools: ["read", "write"] };
  const tools = resolveAllowedTools(agent, config);
  assert.deepEqual(tools, ["read", "write"]);
  assert.deepEqual(detectToolExpansion(agent, tools), ["write"]);
});
