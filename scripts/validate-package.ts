import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const required = [
  "package.json",
  "extensions/clarification-orchestrator/index.ts",
  "extensions/clarification-orchestrator/commands/brainstorm-pro.ts",
  "extensions/clarification-orchestrator/workflow/runtime.ts",
  "extensions/clarification-orchestrator/workflow/state-machine.ts",
  "extensions/clarification-orchestrator/workflow/types.ts",
  "skills/brainstorming-pro/SKILL.md",
  "skills/spec-plan-pro/SKILL.md",
  "skills/spec-exec-pro/SKILL.md",
];

for (const file of required) {
  await fs.access(path.join(root, file));
}

const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
if (!pkg.pi?.extensions?.length) throw new Error("package.json missing pi.extensions");
if (!pkg.pi?.skills?.length) throw new Error("package.json missing pi.skills");

console.log("Brainstorming Pro package validation passed.");
