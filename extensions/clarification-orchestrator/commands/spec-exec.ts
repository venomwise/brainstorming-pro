import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { resolveSpecPaths } from "../path-guard.ts";
import { findPlanningArtifacts } from "../lifecycle-handoff.ts";

export async function handleSpecExecCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const topicText = args.trim();
    if (!topicText) throw new Error("Missing topic. Usage: /spec-exec <topic>");
    const topic = resolveSpecPaths(ctx.cwd, topicText);
    const planning = await findPlanningArtifacts(topic);
    if (!planning) {
      throw new Error(`Cannot run /spec-exec ${topic.slug}: approved requirements.md and tasks.md are required. Complete /spec-plan ${topic.slug} first.`);
    }
    ctx.ui.notify([
      `Spec Exec Pro boundary ready for ${topic.slug}.`,
      `Requirements: ${planning.requirementsPath}`,
      `Tasks: ${planning.tasksPath}`,
      "Execution must follow approved tasks and pause on scope changes.",
    ].join("\n"), "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
