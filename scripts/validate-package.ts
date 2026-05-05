import fs from "node:fs/promises";
import path from "node:path";
import { validateConfig, bundledDefaults } from "../extensions/clarification-orchestrator/config.ts";
import { discoverAgents } from "../extensions/clarification-orchestrator/agents.ts";

const root = process.cwd();
const required = [
  "package.json",
  "extensions/clarification-orchestrator/index.ts",
  "skills/brainstorming-pro/SKILL.md",
  "prompts/clarify.md",
  "prompts/clarify-review.md",
  "prompts/clarify-refine.md",
  "agents/designer.md",
  "agents/reviewer-product.md",
  "agents/reviewer-architecture.md",
  "agents/reviewer-risk.md",
  "agents/reviewer-testing.md",
  "agents/triager.md",
  "agents/refiner.md",
  "agents/verifier.md",
];

for (const file of required) {
  await fs.access(path.join(root, file));
}

const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (!pkg.pi?.extensions?.length) throw new Error("package.json missing pi.extensions");
if (!pkg.pi?.skills?.length) throw new Error("package.json missing pi.skills");
if (!pkg.pi?.prompts?.length) throw new Error("package.json missing pi.prompts");

validateConfig(bundledDefaults);
const agents = await discoverAgents({ packageRoot: root, cwd: root });
for (const name of ["designer", "reviewer-product", "reviewer-architecture", "reviewer-risk", "reviewer-testing", "triager", "refiner", "verifier"]) {
  if (!agents.some((agent) => agent.name === name)) throw new Error(`Missing bundled agent ${name}`);
}

console.log("Brainstorming Pro package validation passed.");
