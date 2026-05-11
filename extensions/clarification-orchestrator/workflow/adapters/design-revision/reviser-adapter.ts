import type { AgentRunResult, AgentOutputSchema } from "../../../runtime/agent-execution/types.ts";
import type { AgentBackedAdapterOptions } from "../agent-backed.ts";
import { resolveRunAgent } from "../agent-backed.ts";
import type { WorkflowLayout } from "../../artifact-store.ts";
import { writeDesignRevisionChildResult, writeDesignRevisionOutput, writeDesignRevisionPrompts } from "./ledger.ts";
import { validateDesignRevisionOutput } from "./schemas.ts";
import { buildDesignRevisionPrompt, buildDesignRevisionSystemPrompt } from "./prompts.ts";
import type { DesignRevisionOutput, DesignRevisionRequest } from "./types.ts";

export type DesignReviserAdapterResult =
  | { status: "succeeded"; output: DesignRevisionOutput; childResult: AgentRunResult<DesignRevisionOutput> }
  | { status: "failed"; childResult: AgentRunResult<DesignRevisionOutput>; reason: string };

export async function runDesignReviserAdapter(input: {
  layout: WorkflowLayout;
  request: DesignRevisionRequest;
  sourceDesignMarkdown: string;
  options: AgentBackedAdapterOptions;
  knownItemIds?: ReadonlySet<string>;
}): Promise<DesignReviserAdapterResult> {
  const prompt = buildDesignRevisionPrompt({ request: input.request, sourceDesignMarkdown: input.sourceDesignMarkdown });
  const systemPrompt = buildDesignRevisionSystemPrompt();
  await writeDesignRevisionPrompts(input.layout, input.request.revisionId, { prompt, systemPrompt });

  const schema = designRevisionOutputSchema(input.knownItemIds);
  const childResult = await resolveRunAgent(input.options)<DesignRevisionOutput>({
    role: "design-reviser",
    purpose: "revise-design",
    prompt,
    systemPrompt,
    model: input.options.model,
    workflow: {
      topic: input.request.topic,
      runId: input.request.workflowRunId,
      phase: "design-review",
      projectRoot: input.options.projectRoot,
      topicDir: input.layout.topicDir,
      artifacts: { design: input.request.sourceDesignRef },
    },
    outputSchema: schema,
    limits: { timeoutMs: 300_000, maxRetries: 0, maxStdoutBytes: 512_000, maxStderrBytes: 128_000, maxOutputBytes: 512_000 },
  });

  await writeDesignRevisionChildResult(input.layout, input.request.revisionId, childResult);
  if (childResult.status !== "succeeded" || !childResult.output) {
    return { status: "failed", childResult, reason: childResult.error?.message ?? `Agent run ${childResult.status}.` };
  }
  await writeDesignRevisionOutput(input.layout, input.request.revisionId, childResult.output);
  return { status: "succeeded", childResult, output: childResult.output };
}

export function designRevisionOutputSchema(knownItemIds?: ReadonlySet<string>): AgentOutputSchema<DesignRevisionOutput> {
  return {
    name: "DesignRevisionOutput",
    parse(raw: string): unknown {
      return JSON.parse(raw) as unknown;
    },
    validate(value: unknown): DesignRevisionOutput {
      return validateDesignRevisionOutput(value, knownItemIds);
    },
  };
}
