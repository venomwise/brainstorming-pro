import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { handleBrainstormProCommand } from "./commands/brainstorm-pro.ts";

export default function clarificationOrchestrator(pi: ExtensionAPI) {
  if (process.env.BRAINSTORMING_PRO_CHILD === "1") return;

  pi.registerCommand("brainstorm-pro", {
    description: "Start, resume, or inspect the durable Brainstorming Pro workflow runtime.",
    handler: handleBrainstormProCommand,
  });
}
