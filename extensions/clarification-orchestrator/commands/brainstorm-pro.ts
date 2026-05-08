import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { tokenizeArgs } from "../options.ts";
import { getStatus, resumeWorkflow, startWorkflow, type RuntimeUserDecision } from "../workflow/runtime.ts";

export type BrainstormProOptions =
  | { action: "start"; request: string; topic: string }
  | { action: "resume"; topic?: string; decision?: RuntimeUserDecision }
  | { action: "status"; topic?: string };

export async function handleBrainstormProCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
  try {
    const options = parseBrainstormProArgs(args);
    const cwd = ctx.cwd ?? process.cwd();
    if (options.action === "start") {
      const { state } = await startWorkflow({ cwd, topic: options.topic, request: options.request });
      ctx.ui.notify(`Started Brainstorming Pro workflow ${state.topic}: ${state.phase}`, "info");
      return;
    }
    if (options.action === "resume") {
      const result = await resumeWorkflow({ cwd, topic: options.topic, decision: options.decision });
      ctx.ui.notify(renderRuntimeResult(result), "info");
      return;
    }
    const status = await getStatus(cwd, options.topic);
    ctx.ui.notify(renderRuntimeResult(status), "info");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
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
    if (token.startsWith("--")) throw new Error(`Unknown /brainstorm-pro option '${token}'.`);
    requestParts.push(token);
  }

  if (resume && status) throw new Error("Use either --resume or --status, not both.");
  if (reviewMode && approvalDecision) throw new Error("Choose either a review mode or approval decision, not both.");
  if ((reviewMode || approvalDecision) && !resume) throw new Error("Runtime decisions are handled through /brainstorm-pro --resume.");
  if (resume) return { action: "resume", topic: topic ?? requestParts[0], decision: reviewMode ?? approvalDecision };
  if (status) return { action: "status", topic: topic ?? requestParts[0] };
  const request = requestParts.join(" ").trim();
  if (!request) throw new Error("Missing request. Usage: /brainstorm-pro \"<request>\" --topic <topic>, /brainstorm-pro --resume [topic], or /brainstorm-pro --status [topic].");
  if (!topic) throw new Error("Starting /brainstorm-pro requires --topic <english-kebab-case-topic> for the first runtime version.");
  return { action: "start", request, topic };
}

function renderRuntimeResult(result: unknown): string {
  if (typeof result === "object" && result && "selectionRequired" in result) {
    const topics = (result as { selectionRequired: string[] }).selectionRequired;
    return topics.length ? `Select a workflow topic to resume: ${topics.join(", ")}` : "No runtime-managed workflows found.";
  }
  if (typeof result === "object" && result && "phase" in result) {
    const state = result as { topic?: string; runId?: string; phase: string; pendingDecision?: { type: string } };
    return [`Workflow ${state.topic ?? "status"}`, state.runId ? `Run: ${state.runId}` : undefined, `Phase: ${state.phase}`, state.pendingDecision ? `Pending: ${state.pendingDecision.type}` : undefined].filter(Boolean).join("\n");
  }
  return JSON.stringify(result, null, 2);
}
