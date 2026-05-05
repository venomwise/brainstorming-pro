import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { handleClarifyCommand } from "./commands/clarify.ts";
import { handleStatusCommand } from "./commands/status.ts";
import { handleDiffCommand } from "./commands/diff.ts";
import { handleCleanCommand } from "./commands/clean.ts";

export default function clarificationOrchestrator(pi: ExtensionAPI) {
  pi.registerCommand("clarify", {
    description: "Run a structured multi-agent clarification workflow for a complex topic.",
    handler: handleClarifyCommand,
  });

  pi.registerCommand("clarify-status", {
    description: "Show status for a Brainstorming Pro clarification run.",
    handler: handleStatusCommand,
  });

  pi.registerCommand("clarify-diff", {
    description: "Compare two Brainstorming Pro clarification runs.",
    handler: handleDiffCommand,
  });

  pi.registerCommand("clarify-clean", {
    description: "Clean old Brainstorming Pro clarification runs according to retention policy.",
    handler: handleCleanCommand,
  });
}
