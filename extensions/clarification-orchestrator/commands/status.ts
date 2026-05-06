import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { parseStatusArgs } from "../options.ts";
import { resolveSpecPaths } from "../path-guard.ts";
import { getRunPaths, loadRunMetadata, loadState, resolveCurrentRun } from "../artifact-store.ts";

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
    const metadata = await loadRunMetadata(paths);
    const state = await loadState(paths);
    const lines = renderStatus(state, metadata);
    ctx.ui.notify(lines.join("\n"), state.errors.length > 0 ? "warning" : "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

export function renderStatus(state: Awaited<ReturnType<typeof loadState>>, metadata = state.metadata): string[] {
  return [
    `Brainstorming Pro status: ${metadata.topic.displayName}`,
    `Run: ${metadata.runId}`,
    `Phase: ${metadata.currentPhase}`,
    `Resume status: ${metadata.resumeStatus}`,
    `Request: ${state.options.request || metadata.requestSummary || metadata.topic.displayName}`,
    `Latest version: v${metadata.latestVersion}`,
    `Active round: ${metadata.activeRound}`,
    `Completed artifacts: ${state.completedArtifacts.length}`,
    `Pending decisions: ${metadata.pendingDecisionIds.length}`,
    `Errors: ${state.errors.length}`,
    `Resume: ${metadata.resumeHint}`,
  ];
}
