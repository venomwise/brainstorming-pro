import type { DesignRevisionRequest } from "./types.ts";

export function buildDesignRevisionSystemPrompt(): string {
  return [
    "You are the package-owned Brainstorming Pro design reviser.",
    "Return only structured JSON matching DesignRevisionOutput.",
    "You may draft a complete replacement design markdown document and metadata only.",
    "Forbidden: requirements generation, tasks generation, approval decisions, review decisions, planning instructions, workflow state mutation, direct file writes, artifact commits, reviewer retry, or accept-incomplete actions.",
    "Do not guess unanswered user questions. Preserve unresolved decisions as assumptions or risk notes.",
  ].join("\n");
}

export function buildDesignRevisionPrompt(input: { request: DesignRevisionRequest; sourceDesignMarkdown: string }): string {
  return [
    `# Design Revision Request ${input.request.revisionId}`,
    "",
    "Revise the design markdown to address the bound review/triage inputs below.",
    "Return a complete revised design document, not a patch.",
    "",
    "## Source Design Ref",
    JSON.stringify(input.request.sourceDesignRef, null, 2),
    "",
    "## Source Design Markdown",
    input.sourceDesignMarkdown,
    "",
    "## Must Fix Cluster IDs",
    input.request.mustFixClusterIds.join("\n") || "(none)",
    "",
    "## Should Fix Cluster IDs",
    input.request.shouldFixClusterIds.join("\n") || "(none)",
    "",
    "## Conflict IDs",
    input.request.conflictIds.join("\n") || "(none)",
    "",
    "## User Answers",
    JSON.stringify(input.request.userAnswers, null, 2),
    "",
    "## User Instructions",
    input.request.userInstructions ?? "(none)",
    "",
    "## Triage Summary",
    input.request.triage.summary,
    "",
    "## Triage Details",
    JSON.stringify(input.request.triage, null, 2),
    "",
    "## Output Contract",
    "Return JSON with revisedDesignMarkdown, changeSummary, resolvedItemIds, unresolvedItemIds, assumptions, and riskNotes.",
  ].join("\n");
}
