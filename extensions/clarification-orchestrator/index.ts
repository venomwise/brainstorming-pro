import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { handleClarifyCommand } from "./commands/clarify.ts";
import { handleStatusCommand } from "./commands/status.ts";
import { handleSpecPlanCommand } from "./commands/spec-plan.ts";
import { handleSpecExecCommand } from "./commands/spec-exec.ts";
import { handleDoctorCommand } from "./commands/doctor.ts";

export default function clarificationOrchestrator(pi: ExtensionAPI) {
  pi.registerCommand("clarify", {
    description: "Run a structured multi-agent clarification workflow for a complex topic.",
    handler: (args, ctx) => handleClarifyCommand(args, ctx, { sendMessage: pi.sendMessage.bind(pi) }),
  });

  pi.registerCommand("clarify-status", {
    description: "Show status for a Brainstorming Pro clarification run.",
    handler: handleStatusCommand,
  });

  pi.registerCommand("spec-plan", {
    description: "Validate Brainstorming Pro approved design handoff before planning.",
    handler: handleSpecPlanCommand,
  });

  pi.registerCommand("spec-exec", {
    description: "Validate approved requirements and tasks before execution.",
    handler: handleSpecExecCommand,
  });

  pi.registerCommand("clarify-doctor", {
    description: "Advanced troubleshooting report for Brainstorming Pro pi invocation and PATH issues.",
    handler: handleDoctorCommand,
  });
}
