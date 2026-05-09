import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { buildAgentLaunchSpec, resolvePiInvocationSync, validateAgentLaunchSpec } from "../../extensions/clarification-orchestrator/runtime/agent-execution/launch-spec.ts";
import { buildChildProcessEnv, assertCanLaunchChild, BRAINSTORMING_PRO_CHILD_ENV, BRAINSTORMING_PRO_DEPTH_ENV } from "../../extensions/clarification-orchestrator/runtime/agent-execution/recursion-guard.ts";
import { validateProviderQualifiedModel } from "../../extensions/clarification-orchestrator/runtime/agent-execution/model-policy.ts";

test("buildAgentLaunchSpec uses no-session, no-skills, shell false, env marker, and trusted paths", () => {
  const env = buildChildProcessEnv({
    parentRunId: "run-1",
    agentRunId: "agent-1",
    role: "design-author",
    parentEnv: {},
  });
  const spec = buildAgentLaunchSpec({
    invocation: { command: "/usr/local/bin/pi", argsPrefix: [], source: "explicit" },
    role: "design-author",
    model: "openai/gpt-5-mini",
    promptFilePath: "/repo/specs/topic/.workflow/runs/run-1/agents/agent-1/prompt.md",
    systemPromptFilePath: "/repo/specs/topic/.workflow/runs/run-1/agents/agent-1/system-prompt.md",
    outputDirectory: "/repo/specs/topic/.workflow/runs/run-1/agents/agent-1",
    cwd: "/repo",
    env,
  });

  assert.equal(spec.shell, false);
  assert.equal(spec.stdio, "pipe");
  assert.equal(spec.cwd, "/repo");
  assert.ok(spec.args.includes("--no-session"));
  assert.ok(spec.args.includes("--no-skills"));
  assert.equal(spec.env[BRAINSTORMING_PRO_CHILD_ENV], "1");
  assert.equal(spec.env[BRAINSTORMING_PRO_DEPTH_ENV], "1");
  assert.equal(validateAgentLaunchSpec(spec).ok, true);
});

test("resolvePiInvocationSync treats PI_COMMAND as one executable path and does not split shell fragments", () => {
  const invocation = resolvePiInvocationSync({
    env: { PI_COMMAND: "node /tmp/pi.js" },
    argv: ["node", "/ignored/pi.js"],
    execPath: "/usr/bin/node",
    existsSync: () => false,
  });

  assert.deepEqual(invocation, {
    command: "node /tmp/pi.js",
    argsPrefix: [],
    source: "env",
  });
});

test("resolvePiInvocationSync can derive current pi cli as node plus argsPrefix", () => {
  const cliPath = path.join("/opt", "@mariozechner", "pi-coding-agent", "dist", "cli.js");
  const invocation = resolvePiInvocationSync({
    env: {},
    argv: ["node", cliPath],
    execPath: "/usr/bin/node",
    existsSync: (candidate) => candidate === cliPath,
  });

  assert.deepEqual(invocation, {
    command: "/usr/bin/node",
    argsPrefix: [cliPath],
    source: "current-cli",
  });
});

test("model policy rejects non provider-qualified models before spawn", () => {
  assert.equal(validateProviderQualifiedModel("openai/gpt-5-mini").ok, true);
  const invalid = validateProviderQualifiedModel("gpt-5-mini");
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.kind, "model-policy-violation");
});

test("recursion guard rejects child marker and max depth", () => {
  const child = assertCanLaunchChild({ [BRAINSTORMING_PRO_CHILD_ENV]: "1" });
  assert.equal(child.ok, false);
  if (!child.ok) assert.equal(child.error.kind, "recursion-depth-exceeded");

  const depth = assertCanLaunchChild({ [BRAINSTORMING_PRO_DEPTH_ENV]: "1" });
  assert.equal(depth.ok, false);
  if (!depth.ok) assert.equal(depth.error.kind, "recursion-depth-exceeded");
});
