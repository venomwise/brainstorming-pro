import { AGENT_ROLE_DEFINITIONS } from "../../../runtime/agent-execution/roles.ts";
import type { VersionedArtifactRef } from "../../types.ts";
import { buildArchitectureDesignReviewPrompt, buildArchitectureDesignReviewSystemPrompt } from "./prompts/full-architecture-review.ts";
import { buildProductDesignReviewPrompt, buildProductDesignReviewSystemPrompt } from "./prompts/full-product-review.ts";
import { buildRiskSecurityDesignReviewPrompt, buildRiskSecurityDesignReviewSystemPrompt } from "./prompts/full-risk-security-review.ts";
import { buildScopeSimplicityDesignReviewPrompt, buildScopeSimplicityDesignReviewSystemPrompt } from "./prompts/full-scope-simplicity-review.ts";
import { buildTestingDesignReviewPrompt, buildTestingDesignReviewSystemPrompt } from "./prompts/full-testing-review.ts";
import type { DesignReviewFindingCategory, DesignReviewerRole } from "./types.ts";

export type FullDesignReviewerRole = Exclude<DesignReviewerRole, "minimal-reviewer">;

export type FullDesignReviewerPromptInput = {
  topic: string;
  designRef: VersionedArtifactRef;
  designContent: string;
};

export type FullDesignReviewerDefinition = {
  role: FullDesignReviewerRole;
  displayName: string;
  defaultCategory: DesignReviewFindingCategory;
  buildPrompt: (input: FullDesignReviewerPromptInput) => string;
  buildSystemPrompt: () => string;
};

export const FULL_DESIGN_REVIEWER_ORDER: readonly FullDesignReviewerRole[] = [
  "product-reviewer",
  "architecture-reviewer",
  "risk-security-reviewer",
  "testing-reviewer",
  "scope-simplicity-reviewer",
] as const;

const fullReviewerRoles = new Set<FullDesignReviewerRole>(FULL_DESIGN_REVIEWER_ORDER);

const FULL_REVIEWER_DEFINITIONS = {
  "product-reviewer": {
    role: "product-reviewer",
    displayName: "Product Reviewer",
    defaultCategory: "product",
    buildPrompt: buildProductDesignReviewPrompt,
    buildSystemPrompt: buildProductDesignReviewSystemPrompt,
  },
  "architecture-reviewer": {
    role: "architecture-reviewer",
    displayName: "Architecture Reviewer",
    defaultCategory: "architecture",
    buildPrompt: buildArchitectureDesignReviewPrompt,
    buildSystemPrompt: buildArchitectureDesignReviewSystemPrompt,
  },
  "risk-security-reviewer": {
    role: "risk-security-reviewer",
    displayName: "Risk / Security Reviewer",
    defaultCategory: "risk-security",
    buildPrompt: buildRiskSecurityDesignReviewPrompt,
    buildSystemPrompt: buildRiskSecurityDesignReviewSystemPrompt,
  },
  "testing-reviewer": {
    role: "testing-reviewer",
    displayName: "Testing Reviewer",
    defaultCategory: "testing",
    buildPrompt: buildTestingDesignReviewPrompt,
    buildSystemPrompt: buildTestingDesignReviewSystemPrompt,
  },
  "scope-simplicity-reviewer": {
    role: "scope-simplicity-reviewer",
    displayName: "Scope / Simplicity Reviewer",
    defaultCategory: "scope-simplicity",
    buildPrompt: buildScopeSimplicityDesignReviewPrompt,
    buildSystemPrompt: buildScopeSimplicityDesignReviewSystemPrompt,
  },
} satisfies Record<FullDesignReviewerRole, FullDesignReviewerDefinition>;

export function resolveFullDesignReviewerSet(selectedRoles?: readonly FullDesignReviewerRole[]): FullDesignReviewerDefinition[] {
  assertFullDesignReviewerPackComplete();
  const roles = selectedRoles ? validateSelectedRoles(selectedRoles) : FULL_DESIGN_REVIEWER_ORDER;
  return roles.map((role) => getFullDesignReviewerDefinition(role));
}

export function getFullDesignReviewerDefinition(role: FullDesignReviewerRole): FullDesignReviewerDefinition {
  if (!isFullDesignReviewerRole(role)) throw new Error(`Unknown full design reviewer role: ${String(role)}`);
  const definition = FULL_REVIEWER_DEFINITIONS[role];
  if (!definition) throw new Error(`Full design reviewer definition is missing for role: ${role}`);
  assertCompleteDefinition(definition);
  return definition;
}

export function assertFullDesignReviewerPackComplete(): void {
  for (const role of FULL_DESIGN_REVIEWER_ORDER) {
    const agentDefinition = AGENT_ROLE_DEFINITIONS[role];
    if (!agentDefinition) throw new Error(`Agent role definition is missing for full design reviewer role: ${role}`);
    if (agentDefinition.expectedResultKind !== "review-findings") throw new Error(`Full design reviewer role ${role} must produce review-findings.`);
    if (agentDefinition.allowedPhases.length !== 1 || agentDefinition.allowedPhases[0] !== "design-review") throw new Error(`Full design reviewer role ${role} must be restricted to design-review.`);
    if (agentDefinition.allowSkills || agentDefinition.allowSession) throw new Error(`Full design reviewer role ${role} must disallow skills and session.`);
    assertCompleteDefinition(getFullDesignReviewerDefinition(role));
  }
}

export function isFullDesignReviewerRole(value: string): value is FullDesignReviewerRole {
  return fullReviewerRoles.has(value as FullDesignReviewerRole);
}

function validateSelectedRoles(selectedRoles: readonly FullDesignReviewerRole[]): readonly FullDesignReviewerRole[] {
  if (selectedRoles.length === 0) throw new Error("At least one full design reviewer role must be selected.");
  const seen = new Set<FullDesignReviewerRole>();
  for (const role of selectedRoles) {
    if (!isFullDesignReviewerRole(role)) throw new Error(`Unknown full design reviewer role: ${String(role)}`);
    if (seen.has(role)) throw new Error(`Duplicate full design reviewer role selected: ${role}`);
    seen.add(role);
  }
  return selectedRoles;
}

function assertCompleteDefinition(definition: FullDesignReviewerDefinition): void {
  if (!isFullDesignReviewerRole(definition.role)) throw new Error(`Unknown full design reviewer role: ${String(definition.role)}`);
  if (!definition.displayName.trim()) throw new Error(`Full design reviewer ${definition.role} is missing a display name.`);
  if (!definition.defaultCategory.trim()) throw new Error(`Full design reviewer ${definition.role} is missing a default category.`);
  if (typeof definition.buildPrompt !== "function") throw new Error(`Full design reviewer ${definition.role} is missing a prompt builder.`);
  if (typeof definition.buildSystemPrompt !== "function") throw new Error(`Full design reviewer ${definition.role} is missing a system prompt builder.`);
}
