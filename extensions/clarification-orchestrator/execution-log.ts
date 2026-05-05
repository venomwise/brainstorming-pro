import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRunResult, WorkflowPhase } from "./types.ts";
import type { RunPaths } from "./artifact-store.ts";

export type ExecutionLogEvent = {
  timestamp: string;
  type: string;
  phase?: WorkflowPhase;
  message: string;
  details?: unknown;
};

export type ExecutionLogger = {
  events: ExecutionLogEvent[];
  log: (event: Omit<ExecutionLogEvent, "timestamp"> & { timestamp?: string }) => Promise<void>;
  logAgentRun: (result: AgentRunResult, phase?: WorkflowPhase) => Promise<void>;
  flush: () => Promise<void>;
};

export function createExecutionLogger(paths: RunPaths): ExecutionLogger {
  const events: ExecutionLogEvent[] = [];
  const flush = async () => writeExecutionLogs(paths, events);
  return {
    events,
    async log(event) {
      events.push({ ...event, timestamp: event.timestamp ?? new Date().toISOString() });
      await flush();
    },
    async logAgentRun(result, phase) {
      events.push({
        timestamp: new Date().toISOString(),
        type: "agent-run",
        phase,
        message: `${result.agentName} ${result.status}`,
        details: {
          attempt: result.attempt,
          requestedModel: result.requestedModel,
          actualModel: result.actualModel,
          durationMs: result.durationMs,
          usage: result.usage,
          error: result.error,
        },
      });
      await flush();
    },
    flush,
  };
}

export async function writeExecutionLogs(paths: RunPaths, events: ExecutionLogEvent[]): Promise<void> {
  await fs.mkdir(paths.runDir, { recursive: true });
  await fs.writeFile(path.join(paths.runDir, "execution.log.json"), `${JSON.stringify({ version: 1, runId: path.basename(paths.runDir), events }, null, 2)}\n`, "utf8");
  await fs.writeFile(path.join(paths.runDir, "execution.log.txt"), renderTextLog(events), "utf8");
}

export function renderTextLog(events: ExecutionLogEvent[]): string {
  return events.map((event) => `[${event.timestamp}] ${event.phase ? `${event.phase} ` : ""}${event.type}: ${event.message}`).join("\n") + (events.length ? "\n" : "");
}
