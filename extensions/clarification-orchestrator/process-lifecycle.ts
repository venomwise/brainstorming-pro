import type { RunPaths } from "./artifact-store.ts";
import { appendStateError, loadState, saveState, writeInterruptedArtifact } from "./artifact-store.ts";
import { globalChildProcessRegistry, type ChildProcessRegistry } from "./runner.ts";
import type { WorkflowError } from "./types.ts";

export type CancellationTracker = {
  signal: AbortSignal;
  controller: AbortController;
  dispose: () => void;
};

export function createCancellationTracker(registry: ChildProcessRegistry = globalChildProcessRegistry): CancellationTracker {
  const controller = new AbortController();
  const onSigint = () => controller.abort("SIGINT");
  const onSigterm = () => controller.abort("SIGTERM");

  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  controller.signal.addEventListener(
    "abort",
    () => {
      registry.terminateAll("SIGTERM");
    },
    { once: true },
  );

  return {
    signal: controller.signal,
    controller,
    dispose: () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    },
  };
}

export async function handleCommandAbort(params: {
  paths: RunPaths;
  registry?: ChildProcessRegistry;
  reason?: string;
  phase?: WorkflowError["phase"];
}): Promise<void> {
  const registry = params.registry ?? globalChildProcessRegistry;
  const activeSubagents = registry.list();
  registry.terminateAll("SIGTERM");

  const error: WorkflowError = {
    type: "cancelled",
    message: params.reason ?? "Clarification workflow was cancelled.",
    phase: params.phase,
    recoverable: true,
    details: { activeSubagents },
    occurredAt: new Date().toISOString(),
  };

  try {
    const state = await loadState(params.paths);
    state.phase = "INTERRUPTED";
    state.execution.status = "interrupted";
    state.errors.push(error);
    await saveState(params.paths, state);
  } catch {
    await appendStateError(params.paths, error);
  }

  await writeInterruptedArtifact(
    params.paths,
    [
      "# Brainstorming Pro interrupted",
      "",
      `- Reason: ${error.message}`,
      `- Phase: ${params.phase ?? "unknown"}`,
      `- Time: ${error.occurredAt}`,
      "",
      "## Active subagents at cancellation",
      "",
      activeSubagents.length === 0
        ? "None recorded."
        : activeSubagents.map((agent) => `- ${agent.agentName} pid=${agent.pid ?? "unknown"} started=${agent.startedAt}`).join("\n"),
      "",
      "Resume with `/clarify <topic> --resume` after inspecting state.json.",
      "",
    ].join("\n"),
  );
}
