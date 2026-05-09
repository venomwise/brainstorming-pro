import { randomUUID } from "node:crypto";
import { redactEnvForMetadata, writeAgentMetadata, writeAgentResult } from "./audit-files.ts";
import { buildAgentLaunchSpec, resolvePiInvocationSync, validateAgentLaunchSpec } from "./launch-spec.ts";
import { validateProviderQualifiedModel } from "./model-policy.ts";
import { rawOutputAsUtf8 } from "./output.ts";
import { writeAgentPromptFiles } from "./prompt-files.ts";
import { agentCompleted, agentFailed, agentOutput, agentRetrying, agentStarted, emitAgentProgress } from "./progress.ts";
import { validateAgentOutput } from "./result-validation.ts";
import { assertCanLaunchChild, buildChildProcessEnv, BRAINSTORMING_PRO_AGENT_ROLE_ENV, BRAINSTORMING_PRO_CHILD_ENV, BRAINSTORMING_PRO_DEPTH_ENV, BRAINSTORMING_PRO_PARENT_RUN_ID_ENV, BRAINSTORMING_PRO_AGENT_RUN_ID_ENV } from "./recursion-guard.ts";
import { shouldRetryAgentRun } from "./retry.ts";
import { mergeAgentRunLimits, validateRoleForPhase } from "./roles.ts";
import { spawnAgentProcess, type SpawnAgentProcessOptions } from "./spawn.ts";
import { createFailedAgentRunResult, createAgentRunError, emptyOutputCaptureSummary, type AgentRunAttempt, type AgentRunRequest, type AgentRunResult } from "./types.ts";

export type RunAgentOptions = SpawnAgentProcessOptions;

export async function runAgent<TOutput>(request: AgentRunRequest<TOutput>, options: RunAgentOptions = {}): Promise<AgentRunResult<TOutput>> {
  const agentRunId = randomUUID();
  const startedAt = new Date().toISOString();
  const diagnostics: string[] = [];
  let paths = { agentRunDir: request.workflow.topicDir } as AgentRunResult<TOutput>["paths"];

  const fail = async (error: ReturnType<typeof createAgentRunError>, status: AgentRunResult<TOutput>["status"] = "failed", attempts = 0, attemptRecords: AgentRunAttempt[] = []): Promise<AgentRunResult<TOutput>> => {
    const result = createFailedAgentRunResult<TOutput>({
      agentRunId,
      role: request.role,
      status,
      startedAt,
      paths,
      attempts,
      attemptRecords,
      error,
      diagnostics,
    });
    if (paths.metadataPath) {
      await writeAgentMetadata(paths, {
        agentRunId,
        role: request.role,
        phase: request.workflow.phase,
        purpose: request.purpose,
        status: result.status,
        startedAt: result.startedAt,
        completedAt: result.completedAt,
        attempts: result.attempts,
        error,
        diagnostics,
      });
      await writeAgentResult(paths, result);
    }
    await emitAgentProgress(request.onProgress, agentFailed(agentRunId, error), diagnostics);
    return result;
  };

  try {
    const role = validateRoleForPhase(request.role, request.workflow.phase);
    if (!role.ok) return fail(role.error);

    const model = validateProviderQualifiedModel(request.model);
    if (!model.ok) return fail(model.error);

    const recursion = assertCanLaunchChild(request.env ?? process.env);
    if (!recursion.ok) return fail(recursion.error);

    const limits = mergeAgentRunLimits(role.definition, request.limits);
    paths = await writeAgentPromptFiles({
      projectRoot: request.workflow.projectRoot,
      topic: request.workflow.topic,
      workflowRunId: request.workflow.runId,
      agentRunId,
      prompt: request.prompt,
      systemPrompt: request.systemPrompt,
    });

    const env = buildChildProcessEnv({
      parentRunId: request.workflow.runId,
      agentRunId,
      role: request.role,
      parentEnv: request.env ?? process.env,
    });
    const invocation = resolvePiInvocationSync({ explicitCommand: request.piCommand, env, cwd: request.workflow.projectRoot });
    const launchSpec = buildAgentLaunchSpec({
      invocation,
      role: request.role,
      model: model.model,
      promptFilePath: paths.promptPath!,
      systemPromptFilePath: paths.systemPromptPath!,
      outputDirectory: paths.agentRunDir,
      cwd: request.workflow.projectRoot,
      env,
    });
    const launchValidation = validateAgentLaunchSpec(launchSpec);
    if (!launchValidation.ok) return fail(launchValidation.error);

    await emitAgentProgress(request.onProgress, agentStarted(agentRunId, request.role), diagnostics);

    const attemptRecords: AgentRunAttempt[] = [];
    let attempt = 1;
    let lastSpawn = await spawnAgentProcess(launchSpec, limits, paths, {
      ...options,
      onStdout: (bytes) => {
        options.onStdout?.(bytes);
        void emitAgentProgress(request.onProgress, agentOutput(agentRunId, "stdout", bytes), diagnostics);
      },
      onStderr: (bytes) => {
        options.onStderr?.(bytes);
        void emitAgentProgress(request.onProgress, agentOutput(agentRunId, "stderr", bytes), diagnostics);
      },
    });

    for (;;) {
      attemptRecords.push({
        attempt,
        startedAt: lastSpawn.startedAt,
        completedAt: lastSpawn.completedAt,
        status: lastSpawn.status,
        exitCode: lastSpawn.exitCode,
        signal: lastSpawn.signal,
        error: lastSpawn.error,
        outputCapture: lastSpawn.output.summary,
      });

      if (!lastSpawn.error || !shouldRetryAgentRun({ attempt, limits, errorKind: lastSpawn.error.kind })) break;
      attempt += 1;
      await emitAgentProgress(request.onProgress, agentRetrying(agentRunId, attempt, lastSpawn.error.message), diagnostics);
      lastSpawn = await spawnAgentProcess(launchSpec, limits, paths, options);
    }

    if (lastSpawn.status !== "succeeded") {
      return fail(
        lastSpawn.error ?? createAgentRunError("unexpected-error", "Agent process failed without a typed error."),
        lastSpawn.status,
        attemptRecords.length,
        attemptRecords,
      );
    }

    const validation = validateAgentOutput(rawOutputAsUtf8(lastSpawn.output), request.outputSchema);
    if (!validation.ok) {
      return fail(validation.error, "invalid-output", attemptRecords.length, attemptRecords);
    }

    const completedAt = new Date().toISOString();
    const result: AgentRunResult<TOutput> = {
      agentRunId,
      role: request.role,
      status: "succeeded",
      output: validation.output,
      paths,
      startedAt,
      completedAt,
      attempts: attemptRecords.length,
      attemptRecords,
      outputCapture: lastSpawn.output.summary,
      ...(diagnostics.length ? { diagnostics } : {}),
    };

    await writeAgentMetadata(paths, {
      agentRunId,
      role: request.role,
      phase: request.workflow.phase,
      purpose: request.purpose,
      status: result.status,
      startedAt,
      completedAt,
      attempts: result.attempts,
      command: launchSpec.command,
      args: launchSpec.args,
      env: redactEnvForMetadata(launchSpec.env, [
        BRAINSTORMING_PRO_CHILD_ENV,
        BRAINSTORMING_PRO_PARENT_RUN_ID_ENV,
        BRAINSTORMING_PRO_AGENT_RUN_ID_ENV,
        BRAINSTORMING_PRO_AGENT_ROLE_ENV,
        BRAINSTORMING_PRO_DEPTH_ENV,
      ]),
      outputCapture: result.outputCapture,
      attemptRecords,
      diagnostics,
    });
    await writeAgentResult(paths, result);
    await emitAgentProgress(request.onProgress, agentCompleted(agentRunId, "succeeded"), diagnostics);
    return result;
  } catch (error) {
    return fail(createAgentRunError("unexpected-error", error instanceof Error ? error.message : String(error), { details: error }));
  }
}
