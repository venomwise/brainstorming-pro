import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { handleBrainstormProCommand, parseBrainstormProArgs } from "../../../extensions/clarification-orchestrator/commands/brainstorm-pro.ts";
import { createInitialWorkflowState, loadLatestWorkflowState, saveWorkflowState } from "../../../extensions/clarification-orchestrator/workflow/runtime.ts";
import type { VersionedArtifactRef } from "../../../extensions/clarification-orchestrator/workflow/types.ts";

type FakeModel = NonNullable<ExtensionCommandContext["model"]>;

const designRef: VersionedArtifactRef = { kind: "design", version: 1, path: ".workflow/artifacts/design/v1.md", checksum: "abc", createdAt: "2026-05-08T00:00:00.000Z" };

async function tempProject(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "bp-command-"));
}

async function withFakePiListModels<T>(cwd: string, stdout: string, run: () => Promise<T>): Promise<T> {
  const binDir = path.join(cwd, "node_modules", ".bin");
  await fs.mkdir(binDir, { recursive: true });
  const piPath = path.join(binDir, "pi");
  await fs.writeFile(piPath, `#!/usr/bin/env node\nif (!process.argv.includes("--list-models")) process.exit(2);\nprocess.stdout.write(${JSON.stringify(stdout)});\n`);
  await fs.chmod(piPath, 0o755);
  const previous = process.env.PI_COMMAND;
  process.env.PI_COMMAND = piPath;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PI_COMMAND;
    else process.env.PI_COMMAND = previous;
  }
}

function fakeModel(provider: string, id: string): FakeModel {
  return { provider, id } as FakeModel;
}

function fakeCommandContext(options: {
  cwd: string;
  model?: FakeModel;
  available?: FakeModel[];
  selected?: string;
  hasUI?: boolean;
  onSelect?: () => void;
  notifications?: Array<{ message: string; type?: "info" | "warning" | "error" }>;
}): ExtensionCommandContext {
  return {
    cwd: options.cwd,
    model: options.model,
    hasUI: options.hasUI ?? true,
    modelRegistry: {
      getAvailable: () => options.available ?? [],
    },
    ui: {
      select: async () => {
        options.onSelect?.();
        return options.selected;
      },
      notify: (message: string, type?: "info" | "warning" | "error") => {
        options.notifications?.push({ message, type });
      },
    },
  } as unknown as ExtensionCommandContext;
}

async function writeDecisionPhaseWorkflow(cwd: string, agentModel?: string): Promise<void> {
  const state = createInitialWorkflowState({ agentModel: agentModel ?? "openai/test", topic: "my-topic", request: "Build", runId: "run-1" });
  const legacyState = agentModel ? state : (({ agentModel: _removed, ...rest }) => rest)(state);
  await saveWorkflowState(cwd, { ...legacyState, phase: "awaiting-design-review-decision", artifacts: { design: designRef } });
}

test("parses supported public command forms", () => {
  assert.deepEqual(parseBrainstormProArgs("\"Build a thing\""), { action: "start", request: "Build a thing" });
  assert.deepEqual(parseBrainstormProArgs("\"Build a thing\" --topic my-topic"), { action: "augment", request: "Build a thing", topic: "my-topic" });
  assert.deepEqual(parseBrainstormProArgs("--topic my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--resume --topic my-topic"), { action: "resume", topic: "my-topic", decision: undefined });
  assert.deepEqual(parseBrainstormProArgs("--status --topic my-topic"), { action: "status", topic: "my-topic" });
});

test("parses runtime helper decisions only with resume", () => {
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review skip"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "skip", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review minimal"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "minimal", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --choose-review full"), { action: "resume", topic: "my-topic", decision: { type: "review-mode", mode: "full", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision approve"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "approve", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision revise"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "revise", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision status"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "status", user: "command-user" } });
  assert.deepEqual(parseBrainstormProArgs("--resume my-topic --decision exit"), { action: "resume", topic: "my-topic", decision: { type: "approval", action: "exit", user: "command-user" } });
});

test("rejects invalid parser combinations and helper values", () => {
  assert.throws(() => parseBrainstormProArgs("--decision approve"), /through \/brainstorm-pro --resume/);
  assert.throws(() => parseBrainstormProArgs("--choose-review minimal"), /through \/brainstorm-pro --resume/);
  assert.throws(() => parseBrainstormProArgs("--resume --choose-review fast"), /skip, minimal, or full/);
  assert.throws(() => parseBrainstormProArgs("--resume --decision maybe"), /approve, revise, status, or exit/);
  assert.throws(() => parseBrainstormProArgs("--resume my-topic --choose-review minimal --decision approve"), /either a review mode or approval decision/);
  assert.throws(() => parseBrainstormProArgs("--resume --status my-topic"), /either --resume or --status/);
  assert.throws(() => parseBrainstormProArgs("--resume my-topic --unknown"), /Unknown \/brainstorm-pro option '--unknown'/);
  assert.throws(() => parseBrainstormProArgs("--resume BadTopic"), /English kebab-case/);
  assert.throws(() => parseBrainstormProArgs("--plan-review-mode full"), /Plan review is automatic and fixed/);
  assert.throws(() => parseBrainstormProArgs("--choose-plan-review skip"), /Plan review is automatic and fixed/);
});

test("start picker cancellation aborts without creating a workflow", async () => {
  const cwd = await tempProject();
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  await withFakePiListModels(cwd, "provider  model\nopenai    gpt-4o-mini\n", async () => {
    await handleBrainstormProCommand("Build a thing", fakeCommandContext({
      cwd,
      notifications,
    }));
  });

  assert.equal(notifications.at(-1)?.type, "error");
  assert.match(notifications.at(-1)?.message ?? "", /No workflow model was selected/);
  await assert.rejects(fs.stat(path.join(cwd, "specs")), /ENOENT/u);
});

test("start without configured models aborts without creating a workflow", async () => {
  const cwd = await tempProject();
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  await withFakePiListModels(cwd, "provider  model\n", async () => {
    await handleBrainstormProCommand("Build a thing", fakeCommandContext({ cwd, notifications }));
  });

  assert.equal(notifications.at(-1)?.type, "error");
  assert.match(notifications.at(-1)?.message ?? "", /pi --list-models/);
  await assert.rejects(fs.stat(path.join(cwd, "specs")), /ENOENT/u);
});

test("resume with persisted agent model does not open model picker", async () => {
  const cwd = await tempProject();
  await writeDecisionPhaseWorkflow(cwd, "openai/test");
  let selectCalls = 0;
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

  await handleBrainstormProCommand("--resume my-topic", fakeCommandContext({
    cwd,
    model: fakeModel("anthropic", "claude-sonnet-4"),
    available: [fakeModel("anthropic", "claude-sonnet-4")],
    onSelect: () => { selectCalls++; },
    notifications,
  }));

  const state = await loadLatestWorkflowState(cwd, "my-topic");
  assert.equal(selectCalls, 0);
  assert.equal(state.agentModel, "openai/test");
  assert.equal(notifications.at(-1)?.type, "info");
});

test("legacy resume patches missing agent model before runtime resume", async () => {
  const cwd = await tempProject();
  await writeDecisionPhaseWorkflow(cwd);
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

  await handleBrainstormProCommand("--resume my-topic", fakeCommandContext({
    cwd,
    model: fakeModel("anthropic", "claude-sonnet-4"),
    notifications,
  }));

  const state = await loadLatestWorkflowState(cwd, "my-topic");
  assert.equal(state.agentModel, "anthropic/claude-sonnet-4");
  assert.equal(state.phase, "awaiting-design-review-decision");
  assert.equal(notifications.at(-1)?.type, "info");
});

test("legacy resume can patch missing agent model from parsed pi list-models output", async () => {
  const cwd = await tempProject();
  await writeDecisionPhaseWorkflow(cwd);
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

  await withFakePiListModels(cwd, "provider  model\nAlpha     gpt-5.5\n", async () => {
    await handleBrainstormProCommand("--resume my-topic", fakeCommandContext({
      cwd,
      selected: "Alpha/gpt-5.5",
      notifications,
    }));
  });

  const state = await loadLatestWorkflowState(cwd, "my-topic");
  assert.equal(state.agentModel, "Alpha/gpt-5.5");
  assert.equal(state.phase, "awaiting-design-review-decision");
  assert.equal(notifications.at(-1)?.type, "info");
});

test("status remains read-only for legacy workflows", async () => {
  const cwd = await tempProject();
  await writeDecisionPhaseWorkflow(cwd);
  let selectCalls = 0;
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];

  await handleBrainstormProCommand("--status my-topic", fakeCommandContext({
    cwd,
    model: fakeModel("anthropic", "claude-sonnet-4"),
    onSelect: () => { selectCalls++; },
    notifications,
  }));

  const state = await loadLatestWorkflowState(cwd, "my-topic");
  assert.equal(selectCalls, 0);
  assert.equal(state.agentModel, undefined);
  assert.equal(state.phase, "awaiting-design-review-decision");
  assert.equal(notifications.at(-1)?.type, "info");
});
