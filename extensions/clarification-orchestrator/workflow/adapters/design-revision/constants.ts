export const DEFAULT_MAX_TOTAL_DESIGN_REVISION_ROUNDS = 3;
export const DEFAULT_MAX_TOTAL_POST_REVISION_REVIEW_ROUNDS = 3;

export const REQUIRED_DESIGN_TEMPLATE_HEADINGS = [
  "Summary",
  "Goals",
  "Non-Goals",
  "Proposed Solution",
  "Requirements Traceability",
] as const;

export const MAX_REVISED_DESIGN_MARKDOWN_BYTES = 256_000;
export const MAX_REVISION_SUMMARY_ITEMS = 50;
