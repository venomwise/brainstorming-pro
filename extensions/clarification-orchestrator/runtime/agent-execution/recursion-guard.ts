import type { AgentRole } from "./types.ts";
import { createAgentRunError, type AgentRunError } from "./types.ts";

export const BRAINSTORMING_PRO_CHILD_ENV = "BRAINSTORMING_PRO_CHILD";
export const BRAINSTORMING_PRO_PARENT_RUN_ID_ENV = "BRAINSTORMING_PRO_PARENT_RUN_ID";
export const BRAINSTORMING_PRO_AGENT_RUN_ID_ENV = "BRAINSTORMING_PRO_AGENT_RUN_ID";
export const BRAINSTORMING_PRO_AGENT_ROLE_ENV = "BRAINSTORMING_PRO_AGENT_ROLE";
export const BRAINSTORMING_PRO_DEPTH_ENV = "BRAINSTORMING_PRO_DEPTH";
export const MAX_AGENT_EXECUTION_DEPTH = 1;

export type AgentChildEnvInput = {
  parentRunId: string;
  agentRunId: string;
  role: AgentRole;
  parentEnv?: NodeJS.ProcessEnv;
};

export function getCurrentAgentDepth(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[BRAINSTORMING_PRO_DEPTH_ENV];
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

export function assertCanLaunchChild(env: NodeJS.ProcessEnv = process.env): { ok: true } | { ok: false; error: AgentRunError } {
  if (env[BRAINSTORMING_PRO_CHILD_ENV] === "1") {
    return {
      ok: false,
      error: createAgentRunError(
        "recursion-depth-exceeded",
        "Agent execution cannot launch a child process from an existing Brainstorming Pro child process.",
        { details: { childMarker: BRAINSTORMING_PRO_CHILD_ENV } },
      ),
    };
  }

  const depth = getCurrentAgentDepth(env);
  if (depth >= MAX_AGENT_EXECUTION_DEPTH) {
    return {
      ok: false,
      error: createAgentRunError(
        "recursion-depth-exceeded",
        `Agent execution depth ${depth} exceeds the maximum supported depth ${MAX_AGENT_EXECUTION_DEPTH}.`,
        { details: { depth, maxDepth: MAX_AGENT_EXECUTION_DEPTH } },
      ),
    };
  }

  return { ok: true };
}

export function buildChildProcessEnv(input: AgentChildEnvInput): NodeJS.ProcessEnv {
  const parentEnv = input.parentEnv ?? process.env;
  const nextDepth = getCurrentAgentDepth(parentEnv) + 1;
  return {
    ...parentEnv,
    [BRAINSTORMING_PRO_CHILD_ENV]: "1",
    [BRAINSTORMING_PRO_PARENT_RUN_ID_ENV]: input.parentRunId,
    [BRAINSTORMING_PRO_AGENT_RUN_ID_ENV]: input.agentRunId,
    [BRAINSTORMING_PRO_AGENT_ROLE_ENV]: input.role,
    [BRAINSTORMING_PRO_DEPTH_ENV]: String(nextDepth),
  };
}

export function isBrainstormingProChildProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[BRAINSTORMING_PRO_CHILD_ENV] === "1";
}
