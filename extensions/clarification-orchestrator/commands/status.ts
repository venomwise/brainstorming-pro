import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { parseStatusArgs } from "../options.ts";
import { resolveSpecPaths } from "../path-guard.ts";
import { getRunPaths, loadState, resolveCurrentRun } from "../artifact-store.ts";

export async function handleStatusCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const options = parseStatusArgs(args);
    const topic = resolveSpecPaths(ctx.cwd, options.topic);
    const current = await resolveCurrentRun(topic);
    if (!current) {
      ctx.ui.notify(`No clarification run found for ${topic.slug}.`, "info");
      return;
    }
    const paths = getRunPaths(topic, current.runId);
    const state = await loadState(paths);
    const lines = renderStatus(state);
    ctx.ui.notify(lines.join("\n"), state.errors.length > 0 ? "warning" : "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export function renderStatus(state: Awaited<ReturnType<typeof loadState>>): string[] {
  return [
    `Brainstorming Pro status: ${state.metadata.topic.displayName}`,
    `Run: ${state.metadata.runId}`,
    `Phase: ${state.phase}`,
    `Mode: ${state.options.mode}`,
    `Round: ${state.round}`,
    `Completed artifacts: ${state.completedArtifacts.length}`,
    `Pending decisions: ${state.pendingDecisions.length}`,
    `Errors: ${state.errors.length}`,
    `Resume: /clarify ${state.metadata.topic.displayName} --resume`,
  ];
}
