import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { bundledDefaults } from "../config.ts";
import { parseCleanArgs } from "../options.ts";
import { resolveSpecPaths } from "../path-guard.ts";
import { buildCleanupPlan, executeCleanupPlan } from "../retention.ts";

export async function handleCleanCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const options = parseCleanArgs(args);
    const topic = resolveSpecPaths(ctx.cwd, options.topic);
    const plan = await buildCleanupPlan(topic, bundledDefaults, options.keep);
    const result = await executeCleanupPlan(topic, plan, options.dryRun);
    ctx.ui.notify(renderClean(plan, result, options.dryRun).join("\n"), result.failed.length > 0 ? "warning" : "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export function renderClean(
  plan: Awaited<ReturnType<typeof buildCleanupPlan>>,
  result: Awaited<ReturnType<typeof executeCleanupPlan>>,
  dryRun: boolean,
): string[] {
  return [
    `Brainstorming Pro cleanup: ${plan.topic}`,
    dryRun ? "Dry run: no files deleted" : "Cleanup executed",
    `Protected runs: ${plan.protectedRuns.join(", ") || "none"}`,
    `Planned deletions: ${plan.deleteRuns.join(", ") || "none"}`,
    `Deleted: ${result.deleted.join(", ") || "none"}`,
    `Failed: ${result.failed.map((failure) => `${failure.run}: ${failure.error}`).join("; ") || "none"}`,
  ];
}
