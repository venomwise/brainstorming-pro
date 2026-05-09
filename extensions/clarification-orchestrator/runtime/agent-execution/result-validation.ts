import { createAgentRunError, type AgentOutputSchema, type AgentRunError } from "./types.ts";

export type AgentOutputValidationResult<TOutput> =
  | { ok: true; output: TOutput }
  | { ok: false; error: AgentRunError };

export function validateAgentOutput<TOutput>(raw: string, schema: AgentOutputSchema<TOutput>): AgentOutputValidationResult<TOutput> {
  let parsed: unknown;
  try {
    parsed = schema.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: createAgentRunError(
        "invalid-output",
        `Agent output could not be parsed as ${schema.name}: ${error instanceof Error ? error.message : String(error)}`,
        { details: { schema: schema.name } },
      ),
    };
  }

  try {
    return { ok: true, output: schema.validate(parsed) };
  } catch (error) {
    return {
      ok: false,
      error: createAgentRunError(
        "schema-validation-failed",
        `Agent output failed ${schema.name} validation: ${error instanceof Error ? error.message : String(error)}`,
        { details: { schema: schema.name } },
      ),
    };
  }
}
