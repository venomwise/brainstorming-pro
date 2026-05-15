import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { tokenizeArgs } from "../options.ts";
import { validateClarificationTopicSlug } from "../topic-validation.ts";
import { getStatus, resumeWorkflow, startWorkflow, augmentWorkflow, type RuntimeUserDecision, type WorkflowRuntimeStatus } from "../workflow/runtime.ts";
import type { WorkflowState } from "../workflow/types.ts";
import { WorkflowProgressController } from "../workflow/live-snapshot-store.ts";
import { openWorkflowLiveSession, type WorkflowTuiContext } from "../tui/workflow-session.ts";
import { proposeWorkflowTopic } from "../workflow/topic-proposal.ts";
import { renderWorkflowUxResult } from "../workflow/ux-renderer.ts";

export type BrainstormProOptions =
  | { action: "start"; request: string }
  | { action: "augment"; request: string; topic: string }
  | { action: "resume"; topic?: string; decision?: RuntimeUserDecision }
  | { action: "status"; topic?: string };

// Decision helper flags are parser-only conveniences. Every parsed helper must
// become a RuntimeUserDecision and flow through resumeWorkflow so runtime code
// remains responsible for phase, artifact, review, and approval validation.
// Future helpers such as --reviewers, --retry, --accept-incomplete, and
// --authorize-design-revision must follow this boundary and must not mutate
// workflow files or act as renderer-only lifecycle shortcuts.

export async function handleBrainstormProCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const options = parseBrainstormProArgs(args);
    const cwd = ctx.cwd ?? process.cwd();
    if (options.action === "start") {
      if (!ctx.model) throw new Error("Starting a new Brainstorming Pro workflow requires a selected model to propose a topic.");
      const topic = await proposeWorkflowTopic({ request: options.request, model: ctx.model, modelRegistry: ctx.modelRegistry, signal: ctx.signal });
      const { state } = await startWorkflow({ cwd, topic, request: options.request });
      await presentWorkflowOperationWithLiveTui(state, ctx, (controller) => resumeWorkflow({ cwd, topic: state.topic, onWorkflowProgress: (event) => { controller.emit(event); } }));
      return;
    }
    if (options.action === "augment") {
      const { state } = await augmentWorkflow({ cwd, topic: options.topic, request: options.request });
      ctx.ui.notify(`Updated Brainstorming Pro workflow ${state.topic}: ${state.phase}`, "info");
      return;
    }
    if (options.action === "resume") {
      const initial = await getStatus(cwd, options.topic);
      if ("selectionRequired" in initial) {
        ctx.ui.notify(renderWorkflowUxResult(initial), "info");
        return;
      }
      await presentWorkflowOperationWithLiveTui(initial, ctx, (controller) => resumeWorkflow({ cwd, topic: initial.topic, decision: options.decision, onWorkflowProgress: (event) => { controller.emit(event); } }));
      return;
    }
    const status = await getStatus(cwd, options.topic);
    ctx.ui.notify(renderWorkflowUxResult(status), "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
  }
}

async function presentWorkflowOperationWithLiveTui(
  initial: WorkflowState | WorkflowRuntimeStatus,
  ctx: ExtensionCommandContext,
  operation: (controller: WorkflowProgressController) => Promise<WorkflowState | { selectionRequired: string[] }>,
): Promise<void> {
  const controller = new WorkflowProgressController({ topic: initial.topic, runId: initial.runId });
  let current: WorkflowState | WorkflowRuntimeStatus = initial;
  const session = await openWorkflowLiveSession({
    ctx: ctx as unknown as WorkflowTuiContext,
    controller,
    getSnapshot: () => controller.getSnapshot(current),
    interactive: Boolean(process.stdout.isTTY),
    width: process.stdout.columns,
  });
  try {
    session.requestRender();
    const result = await operation(controller);
    if ("selectionRequired" in result) {
      ctx.ui.notify(renderWorkflowUxResult(result), "info");
      return;
    }
    current = result;
    session.requestRender();
    ctx.ui.notify(renderWorkflowUxResult(result), "info");
  } finally {
    await session.close();
    controller.close();
  }
}

export function parseBrainstormProArgs(args: string): BrainstormProOptions {
  const tokens = tokenizeArgs(args);
  let resume = false;
  let status = false;
  let topic: string | undefined;
  let reviewMode: RuntimeUserDecision | undefined;
  let approvalDecision: RuntimeUserDecision | undefined;
  const requestParts: string[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "--resume") {
      resume = true;
      continue;
    }
    if (token === "--status") {
      status = true;
      continue;
    }
    if (token === "--topic") {
      topic = tokens[++i];
      if (!topic) throw new Error("--topic requires an English kebab-case value.");
      continue;
    }
    if (token === "--choose-review") {
      const mode = tokens[++i];
      if (mode !== "skip" && mode !== "minimal" && mode !== "full") throw new Error("--choose-review requires skip, minimal, or full.");
      reviewMode = { type: "review-mode", mode, user: "command-user" };
      continue;
    }
    if (token === "--decision") {
      const action = tokens[++i];
      if (action !== "approve" && action !== "revise" && action !== "status" && action !== "exit") throw new Error("--decision requires approve, revise, status, or exit.");
      approvalDecision = { type: "approval", action, user: "command-user" };
      continue;
    }
    if (token === "--plan-review-mode" || token === "--choose-plan-review") {
      throw new Error("Plan review is automatic and fixed; /brainstorm-pro does not support plan review mode selection.");
    }
    if (token.startsWith("--")) throw new Error(`Unknown /brainstorm-pro option '${token}'.`);
    requestParts.push(token);
  }

  if (resume && status) throw new Error("Use either --resume or --status, not both.");
  if (reviewMode && approvalDecision) throw new Error("Choose either a review mode or approval decision, not both.");
  if ((reviewMode || approvalDecision) && !resume) throw new Error("Runtime decisions are handled through /brainstorm-pro --resume.");
  if ((resume || status) && requestParts.length > 1) throw new Error("Resume/status accepts at most one workflow topic.");
  const positionalTopic = requestParts[0];
  const selectedTopic = topic ?? positionalTopic;
  if (resume) {
    if (selectedTopic) validateClarificationTopicSlug(selectedTopic);
    return { action: "resume", topic: selectedTopic, decision: reviewMode ?? approvalDecision };
  }
  if (status) {
    if (selectedTopic) validateClarificationTopicSlug(selectedTopic);
    return { action: "status", topic: selectedTopic };
  }
  const request = requestParts.join(" ").trim();
  if (!request && topic) {
    validateClarificationTopicSlug(topic);
    return { action: "resume", topic, decision: undefined };
  }
  if (!request) throw new Error("Missing request. Usage: /brainstorm-pro \"<request>\", /brainstorm-pro \"<request>\" --topic <existing-topic>, /brainstorm-pro --topic <existing-topic>, /brainstorm-pro --resume [topic], or /brainstorm-pro --status [topic].");
  if (topic) {
    validateClarificationTopicSlug(topic);
    return { action: "augment", request, topic };
  }
  return { action: "start", request };
}
