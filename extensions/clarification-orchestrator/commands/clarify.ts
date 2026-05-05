import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { parseClarifyArgs } from "../options.ts";
import { resolveSpecPaths } from "../path-guard.ts";
import { createRun, getRunPaths, resolveCurrentRun } from "../artifact-store.ts";
import { runWorkflow, resumeWorkflow } from "../workflow.ts";
import { createProgressReporter } from "../progress.ts";
import { createExecutionLogger } from "../execution-log.ts";
import { discoverAgents, resolveAllowedTools } from "../agents.ts";
import { loadConfig, requiresUserConfirmation } from "../config.ts";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { hashPrompt, writeDebugInput } from "../debug-artifacts.ts";

export async function handleClarifyCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const options = parseClarifyArgs(args);
    const cwd = process.cwd();
    const topic = resolveSpecPaths(cwd, options.topic);
    const hasUI = (ctx as any).hasUI !== false;

    const loadedStartupConfig = await loadConfig(cwd, options);
    if (requiresUserConfirmation(loadedStartupConfig.securitySensitiveChanges) && hasUI === false) {
      throw new Error("Project-local security-sensitive Brainstorming Pro config requires interactive confirmation.");
    }

    if (options.resume) {
      const current = await resolveCurrentRun(topic);
      if (!current) throw new Error(`No current clarification run found for ${topic.displayName}.`);
      const paths = getRunPaths(topic, current.runId);
      const state = await resumeWorkflow({ paths, options, ctx: { hasUI, cwd } });
      ctx.ui.notify(`Resumed ${topic.displayName}: phase ${state.phase}`, "info");
      return;
    }

    const run = await createRun(topic, options, cwd);
    if (options.dryRun) {
      const loaded = loadedStartupConfig;
      const agents = await discoverAgents({ packageRoot: path.resolve(cwd), cwd, includeUserOverrides: true, includeProjectOverrides: loaded.config.security.allowProjectAgents });
      const plan = {
        topic: topic.displayName,
        runDir: run.paths.runDir,
        phases: ["DISCOVERY", "REVIEW", "TRIAGE", "USER_DECISION", "REFINE", "VERIFY", "FINAL_APPROVAL"],
        agents: agents.map((agent) => ({ name: agent.name, role: agent.role, model: agent.model ?? loaded.config.agents[agent.name]?.model ?? loaded.config.models.default, tools: resolveAllowedTools(agent, loaded.config) })),
        promptHash: hashPrompt(buildAgentTaskPrompt({ topic: topic.displayName, phase: "DRY_RUN", instructions: "Planned Brainstorming Pro execution." })),
      };
      await writeDebugInput(run.paths, loaded.config, "dry-run-plan", plan);
      ctx.ui.notify(`Dry run: would execute clarification for ${topic.displayName} in ${path.relative(cwd, run.paths.runDir)}`, "info");
      return;
    }

    const progress = createProgressReporter({ notify: ctx.ui.notify.bind(ctx.ui) });
    const logger = createExecutionLogger(run.paths);
    progress.setActivity(`Starting clarification for ${topic.displayName}`);
    await logger.log({ type: "workflow-start", message: `Starting ${topic.displayName}`, phase: "INIT" });
    const state = await runWorkflow({ paths: run.paths, options, ctx: { hasUI, cwd }, onPhase: async (phase) => {
      progress.setPhaseProgress(phase);
      await logger.log({ type: "phase", phase, message: `Entered ${phase}` });
    } });
    ctx.ui.notify(`Clarification workflow reached phase ${state.phase}`, "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
