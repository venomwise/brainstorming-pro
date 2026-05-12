import { WorkflowProgressController } from "../workflow/live-snapshot-store.ts";
import type { WorkflowLiveSnapshot } from "../workflow/progress-types.ts";
import { renderWorkflowLiveSnapshotFallback } from "./workflow-result.ts";
import { WorkflowLiveWidget } from "./workflow-widget.ts";

export type WorkflowTuiCustomHandle = {
  requestRender?: () => void;
  close?: () => void | Promise<void>;
  hide?: () => void | Promise<void>;
  dispose?: () => void | Promise<void>;
};

export type WorkflowTuiContext = {
  ui?: {
    custom?: (component: WorkflowLiveWidget) => WorkflowTuiCustomHandle | Promise<WorkflowTuiCustomHandle>;
  };
};

export type WorkflowLiveSession = {
  widget?: WorkflowLiveWidget;
  fallbackText?: string;
  diagnostic?: string;
  requestRender(): void;
  close(): Promise<void>;
};

export type OpenWorkflowLiveSessionOptions = {
  ctx?: WorkflowTuiContext;
  controller: WorkflowProgressController;
  getSnapshot: () => WorkflowLiveSnapshot;
  width?: number;
  enabled?: boolean;
  interactive?: boolean;
};

export async function openWorkflowLiveSession(options: OpenWorkflowLiveSessionOptions): Promise<WorkflowLiveSession> {
  if (!shouldUseWorkflowTui({ enabled: options.enabled, interactive: options.interactive, width: options.width })) {
    return fallbackSession(options.getSnapshot, options.width);
  }

  const custom = options.ctx?.ui?.custom;
  if (!custom) {
    return fallbackSession(options.getSnapshot, options.width, "Pi custom TUI components are unavailable.");
  }

  const widget = new WorkflowLiveWidget({ getSnapshot: options.getSnapshot });
  let handle: WorkflowTuiCustomHandle | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    handle = await custom(widget);
    unsubscribe = options.controller.subscribe(() => {
      try {
        handle?.requestRender?.();
      } catch {
        // Rendering notifications are presentation-only and fail-soft.
      }
    });
  } catch (error) {
    return fallbackSession(options.getSnapshot, options.width, `TUI session setup failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    widget,
    requestRender(): void {
      handle?.requestRender?.();
    },
    async close(): Promise<void> {
      unsubscribe?.();
      await closeWorkflowTuiHandle(handle);
    },
  };
}

export function shouldUseWorkflowTui(options: { enabled?: boolean; interactive?: boolean; width?: number; env?: NodeJS.ProcessEnv } = {}): boolean {
  if (options.enabled === false) return false;
  const env = options.env ?? process.env;
  if (options.interactive === false) return false;
  if (env.CI === "true" || env.NO_COLOR === "1") return false;
  if ((options.width ?? process.stdout.columns ?? 80) < 40) return false;
  return true;
}

async function closeWorkflowTuiHandle(handle: WorkflowTuiCustomHandle | undefined): Promise<void> {
  if (!handle) return;
  if (handle.close) {
    await handle.close();
    return;
  }
  if (handle.hide) {
    await handle.hide();
    return;
  }
  await handle.dispose?.();
}

function fallbackSession(getSnapshot: () => WorkflowLiveSnapshot, width?: number, diagnostic?: string): WorkflowLiveSession {
  return {
    fallbackText: renderWorkflowLiveSnapshotFallback(getSnapshot(), { width }),
    ...(diagnostic ? { diagnostic } : {}),
    requestRender(): void {
      // Fallback output is deterministic text; no live redraw handle is needed.
    },
    async close(): Promise<void> {
      // No UI resource to clean up.
    },
  };
}
