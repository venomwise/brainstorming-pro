import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { resolveSpecPaths } from "../path-guard.ts";
import { findApprovedDesignContext } from "../lifecycle-handoff.ts";

export async function handleSpecPlanCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const topicText = args.trim();
    if (!topicText) throw new Error("Missing topic. Usage: /spec-plan <topic>");
    const topic = resolveSpecPaths(ctx.cwd, topicText);
    const approved = await findApprovedDesignContext(topic);
    if (!approved) {
      throw new Error(`Cannot run /spec-plan ${topic.slug}: approved design context not found. Run /clarify <request> or revise/approve the design first.`);
    }
    ctx.ui.notify([
      `Spec Plan Pro boundary ready for ${topic.slug}.`,
      `Approved design: ${approved.designPath}`,
      `Final approval: ${approved.finalApprovalPath}`,
      "Full planning workflow is handled by spec-plan-pro and must produce user-approved requirements.md and tasks.md before execution.",
    ].join("\n"), "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
