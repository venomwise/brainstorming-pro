import type { WorkflowLayout } from "../../artifact-store.ts";
import { writeDesignRevisionValidation } from "./ledger.ts";
import { MAX_REVISED_DESIGN_MARKDOWN_BYTES, REQUIRED_DESIGN_TEMPLATE_HEADINGS } from "./constants.ts";
import { rejectUnauthorizedRevisionDirectives, validateDesignRevisionOutput } from "./schemas.ts";
import type { DesignRevisionOutput, DesignRevisionValidationResult } from "./types.ts";

export async function validateAndWriteRevisedDesign(input: {
  layout: WorkflowLayout;
  revisionId: string;
  output: unknown;
  knownItemIds: ReadonlySet<string>;
  validatedAt?: string;
}): Promise<DesignRevisionValidationResult & { output?: DesignRevisionOutput }> {
  const result = validateRevisedDesignOutput(input.output, input.knownItemIds, input.validatedAt);
  await writeDesignRevisionValidation(input.layout, input.revisionId, { status: result.status, diagnostics: result.diagnostics, validatedAt: result.validatedAt });
  return result;
}

export function validateRevisedDesignOutput(value: unknown, knownItemIds: ReadonlySet<string>, validatedAt = new Date().toISOString()): DesignRevisionValidationResult & { output?: DesignRevisionOutput } {
  const diagnostics: string[] = [];
  let output: DesignRevisionOutput;
  try {
    rejectUnauthorizedRevisionDirectives(value);
    output = validateDesignRevisionOutput(value, knownItemIds);
  } catch (error) {
    return { status: "failed", diagnostics: [error instanceof Error ? error.message : String(error)], validatedAt };
  }

  const byteLength = Buffer.byteLength(output.revisedDesignMarkdown, "utf8");
  if (byteLength === 0) diagnostics.push("Revised design markdown is empty.");
  if (byteLength > MAX_REVISED_DESIGN_MARKDOWN_BYTES) diagnostics.push("Revised design markdown exceeds configured output size limit.");
  for (const heading of REQUIRED_DESIGN_TEMPLATE_HEADINGS) {
    if (!hasMarkdownHeading(output.revisedDesignMarkdown, heading)) diagnostics.push(`Missing required design heading: ${heading}`);
  }
  if (/\b(approved|approval granted|design is approved|move to planning|enter planning|commit(?:ted)? artifact|review decision)\b/iu.test(output.revisedDesignMarkdown)) {
    diagnostics.push("Revised design markdown contains approval, planning, artifact commit, or review-decision claims.");
  }
  const requirementsTasksSubstitutionPattern = /^#{1,6}\s+(Requirements(?!\s+Traceability\s*$)|Tasks)\b/imu;
  if (requirementsTasksSubstitutionPattern.test(output.revisedDesignMarkdown)) {
    diagnostics.push("Revised design markdown embeds requirements/tasks as a substitute for design.");
  }
  if ([...output.resolvedItemIds, ...output.unresolvedItemIds].some((id) => !knownItemIds.has(id))) {
    diagnostics.push("Revised design output references unknown source item IDs.");
  }

  if (diagnostics.length > 0) return { status: "failed", diagnostics, validatedAt };
  return { status: "passed", diagnostics: [], validatedAt, output };
}

export function collectKnownRevisionItemIds(input: {
  clusterIds?: readonly string[];
  conflictIds?: readonly string[];
  questionIds?: readonly string[];
}): Set<string> {
  return new Set([...(input.clusterIds ?? []), ...(input.conflictIds ?? []), ...(input.questionIds ?? [])]);
}

function hasMarkdownHeading(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^#{1,6}\\s+${escaped}\\s*$`, "imu").test(markdown);
}
