import type { PhaseAdapter, AdapterPhaseResult } from "./types.ts";
import { buildSpecPlanAdapterContext } from "./context.ts";
import { buildSpecPlanPrompt } from "./prompts/spec-plan.ts";
import { createPlanDraftOutputSchema, type PlanDraftOutput } from "./schemas.ts";
import { agentFailureResult, resolveRunAgent, workflowAgentProgressCallback, type AgentBackedAdapterOptions } from "./agent-backed.ts";
import type { WorkflowState } from "../types.ts";

export type SpecPlanAdapterOutput = AdapterPhaseResult;

export function createSpecPlanAdapter(options: AgentBackedAdapterOptions): PhaseAdapter<WorkflowState, AdapterPhaseResult> {
  return {
    name: "spec-plan",
    phase: "planning",
    allowedFrom: ["planning"],
    requiredArtifacts: ["design"],
    async run(state) {
      let context;
      try {
        context = await buildSpecPlanAdapterContext(options.projectRoot, state);
      } catch (error) {
        return { kind: "blocked", reason: error instanceof Error ? error.message : String(error) };
      }
      const prompt = buildSpecPlanPrompt(context);
      const run = resolveRunAgent(options);
      const result = await run<PlanDraftOutput>({
        role: "plan-author",
        purpose: "Draft Brainstorming Pro requirements and tasks artifacts",
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
        outputSchema: createPlanDraftOutputSchema(state.topic),
        onProgress: workflowAgentProgressCallback(options, state),
      });
      if (result.status !== "succeeded" || !result.output) return agentFailureResult(result);
      return {
        kind: "artifact-commit-request",
        artifacts: [
          { kind: "requirements", content: result.output.requirementsMarkdown },
          { kind: "tasks", content: result.output.tasksMarkdown },
        ],
        metadata: {
          traceability: result.output.traceability,
          assumptions: result.output.assumptions,
          risks: result.output.risks,
        },
      };
    },
    validate(output) {
      if (output.kind === "artifact-commit-request") {
        const kinds = output.artifacts.map((artifact) => artifact.kind);
        if (!kinds.includes("requirements") || !kinds.includes("tasks")) {
          throw new Error("Spec-plan adapter must produce requirements and tasks artifact commit requests.");
        }
      }
    },
    commit(output) {
      return output;
    },
  };
}

export const specPlanAdapter: PhaseAdapter<WorkflowState, AdapterPhaseResult> = createSpecPlanAdapter({
  projectRoot: process.cwd(),
  model: process.env.BRAINSTORMING_PRO_AGENT_MODEL ?? "openai:gpt-4o-mini",
});
