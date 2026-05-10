import type { WorkflowPhase } from "../../workflow/types.ts";
import type { AgentResultKind, AgentRole, AgentRunLimits } from "./types.ts";
import { createAgentRunError, type AgentRunError } from "./types.ts";

export type AgentRoleDefinition = AgentRunLimits & {
  role: AgentRole;
  description: string;
  allowedPhases: WorkflowPhase[];
  expectedResultKind: AgentResultKind;
  allowSkills: false;
  allowSession: false;
};

const DEFAULT_LIMITS: AgentRunLimits = {
  timeoutMs: 120_000,
  maxRetries: 0,
  maxStdoutBytes: 512 * 1024,
  maxStderrBytes: 256 * 1024,
  maxOutputBytes: 768 * 1024,
};

export const AGENT_ROLE_DEFINITIONS: Record<AgentRole, AgentRoleDefinition> = {
  "design-author": {
    role: "design-author",
    description: "Produces candidate design content for Brainstorming Pro adapter validation.",
    allowedPhases: ["designing"],
    expectedResultKind: "artifact-draft",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "design-reviser": {
    role: "design-reviser",
    description: "Produces a revised candidate design when a workflow-owned revision phase requests it.",
    allowedPhases: ["awaiting-design-review-decision", "awaiting-design-approval", "design-review"],
    expectedResultKind: "artifact-draft",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "plan-author": {
    role: "plan-author",
    description: "Produces candidate requirements and tasks content for approved designs.",
    allowedPhases: ["planning"],
    expectedResultKind: "artifact-draft",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "task-executor": {
    role: "task-executor",
    description: "Executes approved workflow tasks only after the runtime enters executing.",
    allowedPhases: ["executing"],
    expectedResultKind: "execution-report",
    allowSkills: false,
    allowSession: false,
    timeoutMs: 300_000,
    maxRetries: 0,
    maxStdoutBytes: 1024 * 1024,
    maxStderrBytes: 512 * 1024,
    maxOutputBytes: 1536 * 1024,
  },
  "minimal-reviewer": {
    role: "minimal-reviewer",
    description: "Runs lightweight workflow-owned validation until full review panels exist.",
    allowedPhases: ["design-review", "plan-review", "execution-review"],
    expectedResultKind: "review-findings",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "product-reviewer": {
    role: "product-reviewer",
    description: "Reviews product problem clarity, users, goals, success criteria, scope, non-goals, and planning readiness.",
    allowedPhases: ["design-review"],
    expectedResultKind: "review-findings",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "architecture-reviewer": {
    role: "architecture-reviewer",
    description: "Reviews component boundaries, runtime ownership, interfaces, data flow, persistence integration, coupling, and maintainability.",
    allowedPhases: ["design-review"],
    expectedResultKind: "review-findings",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "risk-security-reviewer": {
    role: "risk-security-reviewer",
    description: "Reviews trust boundaries, path and topic scoping, stale artifact risk, approval gate safety, untrusted output handling, fail-closed behavior, and audit integrity.",
    allowedPhases: ["design-review"],
    expectedResultKind: "review-findings",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "testing-reviewer": {
    role: "testing-reviewer",
    description: "Reviews test strategy, coverage, fixtures, negative paths, deterministic validation, and evidence expectations.",
    allowedPhases: ["design-review"],
    expectedResultKind: "review-findings",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
  "scope-simplicity-reviewer": {
    role: "scope-simplicity-reviewer",
    description: "Reviews YAGNI, over-abstraction, spec boundary discipline, implementation complexity, and maintainability.",
    allowedPhases: ["design-review"],
    expectedResultKind: "review-findings",
    allowSkills: false,
    allowSession: false,
    ...DEFAULT_LIMITS,
  },
};

export function isAgentRole(value: string): value is AgentRole {
  return Object.prototype.hasOwnProperty.call(AGENT_ROLE_DEFINITIONS, value);
}

export function getAgentRoleDefinition(role: AgentRole): AgentRoleDefinition {
  return AGENT_ROLE_DEFINITIONS[role];
}

export function validateRoleForPhase(role: string, phase: WorkflowPhase): { ok: true; definition: AgentRoleDefinition } | { ok: false; error: AgentRunError } {
  if (!isAgentRole(role)) {
    return {
      ok: false,
      error: createAgentRunError("role-not-allowed", `Unknown agent role: ${role}`),
    };
  }

  const definition = getAgentRoleDefinition(role);
  if (!definition.allowedPhases.includes(phase)) {
    return {
      ok: false,
      error: createAgentRunError(
        "role-not-allowed",
        `Agent role ${role} is not allowed in workflow phase ${phase}.`,
        { details: { role, phase, allowedPhases: definition.allowedPhases } },
      ),
    };
  }

  return { ok: true, definition };
}

export function mergeAgentRunLimits(definition: AgentRoleDefinition, override: Partial<AgentRunLimits> | undefined): AgentRunLimits {
  return {
    timeoutMs: override?.timeoutMs ?? definition.timeoutMs,
    maxRetries: override?.maxRetries ?? definition.maxRetries,
    maxStdoutBytes: override?.maxStdoutBytes ?? definition.maxStdoutBytes,
    maxStderrBytes: override?.maxStderrBytes ?? definition.maxStderrBytes,
    maxOutputBytes: override?.maxOutputBytes ?? definition.maxOutputBytes,
  };
}
