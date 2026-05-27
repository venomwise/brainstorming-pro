import fs from "node:fs/promises";
import { agentFailureResult, resolveRunAgent, workflowAgentProgressCallback, type AgentBackedAdapterOptions } from "./agent-backed.ts";
import { buildSpecExecAdapterContext } from "./spec-exec/context.ts";
import { runExecutionLoop } from "./spec-exec/execution-loop.ts";
import { markPhaseComplete, markTaskComplete } from "./spec-exec/checkbox-writer.ts";
import { snapshotExecutionArtifacts, verifyNoUnauthorizedArtifactMutation } from "./spec-exec/mutation-guard.ts";
import { buildSingleTaskPrompt } from "./spec-exec/prompts.ts";
import { writeExecutionReport } from "./spec-exec/execution-report.ts";
import { blockerFromError, createSingleTaskExecutionResultSchema, type ExecutionBlocker, type ExecutionReportOutput, type SingleTaskExecutionResult, type TaskRunRecord } from "./spec-exec/schemas.ts";
import type { PhaseAdapter, AdapterPhaseResult } from "./types.ts";
import type { WorkflowState } from "../types.ts";
import { writeVersionedArtifact } from "../artifact-store.ts";
import { appendWorkflowEvent } from "../events.ts";
import { parseTaskPlan } from "./spec-exec/task-plan-parser.ts";

export type SpecExecAdapterOutput = AdapterPhaseResult | { kind: "state-patch"; statePatch: Partial<WorkflowState> };

export function createSpecExecAdapter(options: AgentBackedAdapterOptions): PhaseAdapter<WorkflowState, SpecExecAdapterOutput> {
  return {
    name: "spec-exec",
    phase: "executing",
    allowedFrom: ["executing"],
    requiredArtifacts: ["requirements", "tasks"],
    async run(state) {
      let context;
      try {
        context = await buildSpecExecAdapterContext(options.projectRoot, state);
      } catch (error) {
        return { kind: "blocked", reason: error instanceof Error ? error.message : String(error) };
      }

      const run = resolveRunAgent(options);
      const taskRuns: TaskRunRecord[] = [];
      for (let iteration = 0; iteration < 100; iteration += 1) {
        const loop = await runExecutionLoop(context);
        if (loop.status === "decision-required") {
          return terminalStatePatch(context, "blocked", "execution-mode-decision-required", taskRuns, [], { diagnostics: loop });
        }
        if (loop.status === "blocked") {
          return terminalStatePatch(context, "blocked", loop.reason, taskRuns, [], { diagnostics: { malformed: loop.malformed } });
        }
        if (loop.status === "completed") {
          return terminalStatePatch(context, "done", "execution-completed", taskRuns, []);
        }

        if (loop.selection.kind === "complete-phase") {
          await markPhaseComplete(context, loop.selection.task);
          taskRuns.push({ taskId: loop.selection.task.id, title: loop.selection.task.title, kind: loop.selection.task.kind, status: "completed", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), changedFiles: [], evidence: ["All executable child tasks were complete; phase checkbox was updated by code."] });
          continue;
        }

        const task = loop.selection.task;
        const snapshot = await snapshotExecutionArtifacts(context);
        const prompt = buildSingleTaskPrompt(context, loop.plan, task, loop.mode);
        const result = await run<SingleTaskExecutionResult>({
          role: "task-executor",
          purpose: `Execute approved task ${task.id}: ${task.title}`,
          prompt,
          systemPrompt: "You are a controlled Brainstorming Pro single-task executor. Return only the requested JSON object.",
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
          outputSchema: createSingleTaskExecutionResultSchema(task),
          onProgress: workflowAgentProgressCallback(options, state),
        });

        if (result.status !== "succeeded" || !result.output) return agentFailureResult(result);
        try {
          await verifyNoUnauthorizedArtifactMutation(snapshot, context);
        } catch (error) {
          const blocker = blockerFromError(task, "scope_change", error instanceof Error ? error.message : String(error));
          taskRuns.push({ taskId: task.id, title: task.title, kind: task.kind, status: "blocked", startedAt: result.startedAt, completedAt: result.completedAt, agentRunId: result.agentRunId, changedFiles: [], evidence: [blocker.risk] });
          return terminalStatePatch(context, "blocked", blocker.type, taskRuns, [blocker], { diagnostics: { blocker } });
        }

        if (result.output.status === "completed") {
          await markTaskComplete(context, task);
          taskRuns.push({ taskId: task.id, title: task.title, kind: task.kind, status: "completed", startedAt: result.startedAt, completedAt: result.completedAt, agentRunId: result.agentRunId, changedFiles: result.output.changedFiles, evidence: result.output.validation.evidence });
          continue;
        }
        if (result.output.status === "blocked") {
          if (result.output.blocker) taskRuns.push({ taskId: task.id, title: task.title, kind: task.kind, status: "blocked", startedAt: result.startedAt, completedAt: result.completedAt, agentRunId: result.agentRunId, changedFiles: result.output.changedFiles, evidence: [result.output.blocker.risk] });
          return terminalStatePatch(context, "blocked", result.output.blocker?.type ?? "task-blocked", taskRuns, result.output.blocker ? [result.output.blocker] : [], { diagnostics: { blocker: result.output.blocker, result: result.output } });
        }
        taskRuns.push({ taskId: task.id, title: task.title, kind: task.kind, status: "failed", startedAt: result.startedAt, completedAt: result.completedAt, agentRunId: result.agentRunId, changedFiles: result.output.changedFiles, evidence: [result.output.summary] });
        return terminalStatePatch(context, result.output.error?.retryable === false ? "failed" : "blocked", result.output.error?.message ?? result.output.summary, taskRuns, [], { error: result.output.error });
      }

      return { kind: "failed", error: { kind: "execution-loop-limit", message: "Spec-exec loop exceeded the safety iteration limit.", retryable: true } };
    },
    validate(output) {
      if (output.kind === "state-patch") return;
      if (output.kind !== "artifact-commit-request" && output.kind !== "blocked" && output.kind !== "failed") throw new Error("Invalid spec-exec adapter output.");
    },
    commit(output) {
      if (output.kind === "state-patch") return output.statePatch;
      return output;
    },
  };
}

async function terminalStatePatch(
  context: Awaited<ReturnType<typeof buildSpecExecAdapterContext>>,
  phase: "done" | "blocked" | "failed",
  reason: string,
  taskRuns: TaskRunRecord[],
  blockers: ExecutionBlocker[],
  extra: Record<string, unknown> = {},
): Promise<Extract<SpecExecAdapterOutput, { kind: "state-patch" }>> {
  const currentTasksMarkdown = await fs.readFile(`${context.topicDir}/tasks.md`, "utf8");
  const currentPlan = parseTaskPlan(currentTasksMarkdown);
  const changedFiles = Array.from(new Set(taskRuns.flatMap((run) => run.changedFiles)));
  const report: ExecutionReportOutput = {
    kind: "execution-report",
    topic: context.topic,
    status: phase === "done" ? "completed" : phase,
    mode: "full",
    taskRuns,
    completedTasks: currentPlan.tasks.filter((task) => task.completed).map((task) => task.id),
    remainingTasks: currentPlan.tasks.filter((task) => !task.completed).map((task) => task.id),
    skippedOptionalTasks: [],
    changedFiles,
    validationCommands: [],
    blockers,
    summary: reason,
  };
  const reportRefs = await writeExecutionReport(context, report);
  const tasksRef = await writeVersionedArtifact(context.layout, "tasks", currentTasksMarkdown);
  await appendWorkflowEvent(context.layout, { type: phase === "done" ? "phase.completed" : `phase.${phase}`, phase: "executing", details: { reason, reportRefs, tasksArtifact: tasksRef, ...extra } });
  return {
    kind: "state-patch",
    statePatch: {
      phase,
      artifacts: { ...context.state.artifacts, tasks: tasksRef },
      ...(phase === "done" ? {} : { lastError: { message: reason, phase: "executing" as const, recoverable: phase === "blocked", occurredAt: new Date().toISOString(), details: extra } }),
    },
  };
}

