import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { parseClarifyArgs } from "../options.ts";
import { resolveSpecPaths } from "../path-guard.ts";
import { createRun, discoverResumableRuns, getRunPaths, loadRunMetadata, resolveCurrentRun, type ResumableRun } from "../artifact-store.ts";
import { runWorkflow, resumeWorkflow } from "../workflow.ts";
import { createProgressReporter } from "../progress.ts";
import { createExecutionLogger } from "../execution-log.ts";
import { discoverAgents, resolveAllowedTools } from "../agents.ts";
import { loadConfig, requiresUserConfirmation } from "../config.ts";
import { ensureFirstRunConfig } from "../first-run-config.ts";
import { buildAgentTaskPrompt } from "../prompts.ts";
import { hashPrompt, writeDebugInput } from "../debug-artifacts.ts";
import { generateTopicCandidates, listExistingSpecTopics } from "../topic-proposal.ts";
import { confirmTopicCandidate } from "../user-gate.ts";

export async function handleClarifyCommand(args: string, ctx: ExtensionCommandContext) {
  try {
    const options = parseClarifyArgs(args);
    const cwd = process.cwd();
    const hasUI = (ctx as any).hasUI !== false;

    let loadedStartupConfig = await loadConfig(cwd, options);
    const input = (ctx.ui as any).input?.bind(ctx.ui) as ((title: string, placeholder?: string) => Promise<string | undefined>) | undefined;
    const hasInteractiveInput = hasUI !== false && Boolean(input);

    if (!options.dryRun && loadedStartupConfig.loadedFiles.length === 0) {
      if (!hasInteractiveInput) {
        throw new Error("Brainstorming Pro first-run setup requires interactive UI. Run /clarify once interactively or create ~/.pi/agent/brainstorming-pro/config.json.");
      }
      await ensureFirstRunConfig({
        hasUI,
        ui: { notify: ctx.ui.notify.bind(ctx.ui), input },
      });
      loadedStartupConfig = await loadConfig(cwd, options);
    }

    if (requiresUserConfirmation(loadedStartupConfig.securitySensitiveChanges) && hasUI === false) {
      throw new Error("Project-local security-sensitive Brainstorming Pro config requires interactive confirmation.");
    }

    if (options.resume) {
      const run = options.request ? await findCurrentRunForTopic(cwd, options.request) : await chooseResumableRun(cwd, ctx, hasUI);
      if (!run) throw new Error("No resumable clarification run found.");
      const state = await resumeWorkflow({ paths: run.paths, options, config: loadedStartupConfig.config, ctx: { hasUI, cwd } });
      ctx.ui.notify(`Resumed ${run.metadata.topic.displayName}: phase ${state.phase}`, "info");
      return;
    }

    if (!options.dryRun && hasUI === false) {
      throw new Error("/clarify requires interactive UI for topic confirmation and design gates. Use --dry-run to validate input non-interactively.");
    }

    const existingTopics = await listExistingSpecTopics(cwd);
    const candidates = generateTopicCandidates(options.request, existingTopics);
    const confirmedTopic = options.dryRun
      ? candidates.find((candidate) => candidate.strength === "strong")?.slug ?? candidates[0]?.slug ?? options.request
      : await confirmTopicCandidate({ request: options.request, candidates, ctx: { hasUI, input, notify: ctx.ui.notify.bind(ctx.ui) } });
    options.proposedTopic = candidates[0]?.slug;
    options.confirmedTopic = confirmedTopic;
    const topic = resolveSpecPaths(cwd, confirmedTopic);

    const run = await createRun(topic, options, cwd, new Date(), { topicProposal: { candidates, proposedTopic: options.proposedTopic, existingTopics } });
    if (options.dryRun) {
      const loaded = loadedStartupConfig;
      const agents = await discoverAgents({ packageRoot: path.resolve(cwd), cwd, includeUserOverrides: true, includeProjectOverrides: loaded.config.security.allowProjectAgents });
      const plan = {
        request: options.request,
        topic: topic.displayName,
        runDir: run.paths.runDir,
        phases: ["REQUEST_CAPTURE", "TOPIC_PROPOSAL", "TOPIC_CONFIRMATION", "V0_BRAINSTORMING", "DESIGN_REVIEW_GATE"],
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
    const state = await runWorkflow({ paths: run.paths, options, config: loadedStartupConfig.config, ctx: { hasUI, cwd }, onPhase: async (phase) => {
      progress.setPhaseProgress(phase);
      await logger.log({ type: "phase", phase, message: `Entered ${phase}` });
    } });
    ctx.ui.notify(`Clarification workflow reached phase ${state.phase}`, "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

async function findCurrentRunForTopic(cwd: string, topicText: string): Promise<ResumableRun | undefined> {
  const topic = resolveSpecPaths(cwd, topicText);
  const current = await resolveCurrentRun(topic);
  if (!current) return undefined;
  const paths = getRunPaths(topic, current.runId);
  return { paths, metadata: await loadRunMetadata(paths) };
}

async function chooseResumableRun(cwd: string, ctx: ExtensionCommandContext, hasUI: boolean): Promise<ResumableRun | undefined> {
  const runs = await discoverResumableRuns(cwd);
  if (runs.length <= 1) return runs[0];
  if (!hasUI || !(ctx.ui as any).input) throw new Error(`Multiple resumable clarification runs found (${runs.length}); use an interactive UI to choose one.`);

  const lines = runs.map((run, index) => `${index + 1}. ${run.metadata.topic.slug} — ${run.metadata.requestSummary ?? run.metadata.request ?? ""} — ${run.metadata.resumeStatus} — v${run.metadata.latestVersion} round ${run.metadata.activeRound} — ${run.metadata.updatedAt}`);
  ctx.ui.notify(["Choose a clarification run to resume:", "", ...lines].join("\n"), "info");
  const answer = (await (ctx.ui as any).input("Resume clarification run", "1"))?.trim();
  const index = Number(answer) - 1;
  if (!Number.isInteger(index) || !runs[index]) throw new Error(`Invalid resume choice '${answer}'.`);
  return runs[index];
}
