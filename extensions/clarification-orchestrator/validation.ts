import { Value } from "typebox/value";

export type ValidationIssue = {
  path: string;
  message: string;
  expected?: string;
  valueSummary?: string;
};

export class ValidationFailure extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[]) {
    super(message);
    this.name = "ValidationFailure";
    this.issues = issues;
  }
}

export type SchemaLike = unknown;

export function validateOrThrow<T>(schema: SchemaLike, value: unknown, label = "value"): T {
  if (Value.Check(schema as any, value)) return value as T;

  const issues = collectValidationIssues(schema, value);
  throw new ValidationFailure(`${label} failed validation`, issues);
}

export function collectValidationIssues(schema: SchemaLike, value: unknown): ValidationIssue[] {
  const raw = Array.from(Value.Errors(schema as any, value));
  if (raw.length === 0) {
    return [
      {
        path: "$",
        message: "Value did not satisfy schema.",
        valueSummary: summarizeValue(value),
      },
    ];
  }

  return raw.map((error: any) => ({
    path: error.path || "$",
    message: error.message || "Invalid value",
    expected: error.schema?.description || error.schema?.type,
    valueSummary: summarizeValue(error.value),
  }));
}

export function formatValidationError(error: unknown): string {
  if (error instanceof ValidationFailure) {
    return error.issues
      .map((issue) => {
        const expected = issue.expected ? ` expected=${issue.expected}` : "";
        const value = issue.valueSummary ? ` value=${issue.valueSummary}` : "";
        return `${issue.path}: ${issue.message}${expected}${value}`;
      })
      .join("\n");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function parseJsonOutput(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error("Output is empty; expected JSON.");

  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = extractFencedJson(trimmed);
    if (fenced) return JSON.parse(fenced);
    const object = extractFirstJsonObject(trimmed);
    if (object) return JSON.parse(object);
    throw new Error("Output is not valid JSON and no JSON object/code fence could be extracted.");
  }
}

export function buildRepairPrompt(params: {
  schemaName: string;
  validationError: string;
  rawOutput: string;
  expectedSchema: string;
}): string {
  return [
    "Your previous response did not match the required JSON schema.",
    "Return ONLY corrected JSON. Do not include markdown fences or explanatory text.",
    `Schema name: ${params.schemaName}`,
    "Validation errors:",
    params.validationError,
    "Expected schema:",
    params.expectedSchema,
    "Previous raw output:",
    params.rawOutput,
  ].join("\n\n");
}

function extractFencedJson(text: string): string | undefined {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return match?.[1]?.trim();
}

function extractFirstJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  return text.slice(start, end + 1);
}

function summarizeValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value.length > 120 ? `${value.slice(0, 117)}...` : value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[array length=${value.length}]`;
  if (typeof value === "object") return `{object keys=${Object.keys(value as Record<string, unknown>).slice(0, 10).join(",")}}`;
  return typeof value;
}
