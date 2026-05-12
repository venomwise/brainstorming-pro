import type { PhaseAdapter, AdapterPhaseResult } from "./types.ts";
import { buildBrainstormingAdapterContext } from "./context.ts";
import { buildBrainstormingPrompt } from "./prompts/brainstorming.ts";
import { createDesignDraftOutputSchema, type DesignDraftOutput } from "./schemas.ts";
import { agentFailureResult, resolveRunAgent, workflowAgentProgressCallback, type AgentBackedAdapterOptions } from "./agent-backed.ts";
import type { WorkflowState } from "../types.ts";

export type BrainstormingAdapterOutput = AdapterPhaseResult;

export function createBrainstormingAdapter(options: AgentBackedAdapterOptions): PhaseAdapter<WorkflowState, AdapterPhaseResult> {
  return {
    name: "brainstorming",
    phase: "designing",
    allowedFrom: ["designing"],
    requiredArtifacts: [],
    async run(state) {
      const context = await buildBrainstormingAdapterContext(options.projectRoot, state);
      const prompt = buildBrainstormingPrompt(context);
      const run = resolveRunAgent(options);
      const result = await run<DesignDraftOutput>({
        role: "design-author",
        purpose: "Draft Brainstorming Pro design artifact",
        prompt: prompt.prompt,
        systemPrompt: prompt.systemPrompt,
        model: options.model,
        workflow: {
          topic: state.topic,
          runId: state.runId,
          phase: state.phase,
          projectRoot: context.projectRoot,
          topicDir: context.topicDir,
          artifacts: state.artifacts,
          state,
        },
        outputSchema: createDesignDraftOutputSchema(state.topic),
        onProgress: workflowAgentProgressCallback(options, state),
      });
      if (result.status !== "succeeded" || !result.output) return agentFailureResult(result);
      return {
        kind: "artifact-commit-request",
        artifacts: [{ kind: "design", content: result.output.designMarkdown, summary: result.output.summary }],
        metadata: {
          assumptions: result.output.assumptions,
          nonGoals: result.output.nonGoals,
          risks: result.output.risks,
          openQuestions: result.output.openQuestions,
        },
      };
    },
    validate(output) {
      if (output.kind === "artifact-commit-request" && !output.artifacts.some((artifact) => artifact.kind === "design")) {
        throw new Error("Brainstorming adapter must produce a design artifact commit request.");
      }
    },
    commit(output) {
      return output;
    },
  };
}

export const brainstormingAdapter: PhaseAdapter<WorkflowState, AdapterPhaseResult> = createBrainstormingAdapter({
  projectRoot: process.cwd(),
  model: process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini",
});
