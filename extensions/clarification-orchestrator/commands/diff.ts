import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { parseDiffArgs } from "../options.ts";
import { resolveSpecPaths } from "../path-guard.ts";
import { compareRuns } from "../run-diff.ts";

export async function handleDiffCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const options = parseDiffArgs(args);
    const topic = resolveSpecPaths(ctx.cwd, options.topic);
    const diff = await compareRuns(topic, options.run1, options.run2);
    ctx.ui.notify(renderDiff(diff).join("\n"), "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export function renderDiff(diff: Awaited<ReturnType<typeof compareRuns>>): string[] {
  return [
    `Brainstorming Pro diff: ${diff.topic}`,
    `Runs: ${diff.run1} -> ${diff.run2}`,
    `Design changed: ${diff.designChanged ? "yes" : "no"}`,
    `Issues added: ${diff.issues.added.join(", ") || "none"}`,
    `Issues removed: ${diff.issues.removed.join(", ") || "none"}`,
    `Decisions added: ${diff.decisions.added.join(", ") || "none"}`,
    `Decisions removed: ${diff.decisions.removed.join(", ") || "none"}`,
  ];
}
