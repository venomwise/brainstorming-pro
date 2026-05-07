import fs from "node:fs/promises";
import path from "node:path";
import { validateConfig, bundledDefaults } from "../extensions/clarification-orchestrator/config.ts";
import { discoverAgents } from "../extensions/clarification-orchestrator/agents.ts";

const root = process.cwd();
const required = [
  "package.json",
  "extensions/clarification-orchestrator/index.ts",
  "skills/brainstorming-pro/SKILL.md",
  "skills/spec-plan-pro/SKILL.md",
  "skills/spec-exec-pro/SKILL.md",
  "prompts/clarify.md",
  "prompts/clarify-v0.md",
  "prompts/brainstorming-methodology.md",
  "prompts/spec-plan-methodology.md",
  "prompts/spec-exec-methodology.md",
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

for (const [file, version] of [
  ["prompts/brainstorming-methodology.md", "brainstorming-pro-v1"],
  ["prompts/spec-plan-methodology.md", "spec-plan-pro-v1"],
  ["prompts/spec-exec-methodology.md", "spec-exec-pro-v1"],
] as const) {
  const text = await fs.readFile(path.join(root, file), "utf8");
  if (!text.includes(`methodologyVersion: ${version}`)) throw new Error(`${file} missing ${version}`);
}

validateConfig(bundledDefaults);
const agents = await discoverAgents({ packageRoot: root, cwd: root });
for (const name of ["designer", "reviewer-product", "reviewer-architecture", "reviewer-risk", "reviewer-testing", "triager", "refiner", "verifier"]) {
  if (!agents.some((agent) => agent.name === name)) throw new Error(`Missing bundled agent ${name}`);
}

console.log("Brainstorming Pro package validation passed.");
