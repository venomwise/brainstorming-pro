import fs from "node:fs/promises";
import path from "node:path";
import type { WorkflowLayout } from "./artifact-store.ts";
import { assertWorkflowPath } from "./artifact-store.ts";
import type { WorkflowPhase } from "./types.ts";

export type WorkflowEvent = {
  type: string;
  timestamp: string;
  phase?: WorkflowPhase;
  details?: unknown;
};

export async function appendWorkflowEvent(layout: WorkflowLayout, event: Omit<WorkflowEvent, "timestamp"> & { timestamp?: string }): Promise<WorkflowEvent> {
  assertWorkflowPath(layout, layout.eventsPath);
  await fs.mkdir(path.dirname(layout.eventsPath), { recursive: true });
  const persisted = { ...event, timestamp: event.timestamp ?? new Date().toISOString() };
  await fs.appendFile(layout.eventsPath, `${JSON.stringify(persisted)}\n`, "utf8");
  return persisted;
}

export async function readWorkflowEvents(layout: WorkflowLayout): Promise<WorkflowEvent[]> {
  assertWorkflowPath(layout, layout.eventsPath);
  try {
    const text = await fs.readFile(layout.eventsPath, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line) as WorkflowEvent);
  } catch (error: unknown) {
    if (typeof error === "object" && error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}
