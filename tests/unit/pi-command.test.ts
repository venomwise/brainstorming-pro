import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { deriveCurrentPiCliScript, formatPiInvocationCommand, resolvePiInvocationSync } from "../../extensions/clarification-orchestrator/pi-command.ts";

test("resolver honors explicit command before environment", () => {
  const invocation = resolvePiInvocationSync({ piCommand: "/custom/pi", env: { PI_COMMAND: "/env/pi" } });
  assert.equal(invocation.command, "/custom/pi");
  assert.deepEqual(invocation.argsPrefix, []);
  assert.equal(invocation.source, "explicit");
});

test("resolver honors PI_COMMAND as single executable string", () => {
  const invocation = resolvePiInvocationSync({ env: { PI_COMMAND: "/env/pi --bad" } });
  assert.equal(invocation.command, "/env/pi --bad");
  assert.deepEqual(invocation.argsPrefix, []);
  assert.equal(invocation.source, "env");
});

test("resolver detects current pi CLI entrypoint", () => {
  const script = "/opt/node/lib/node_modules/@mariozechner/pi-coding-agent/dist/cli.js";
  const invocation = resolvePiInvocationSync({ argv: ["node", script], execPath: "/usr/bin/node", env: {} });
  assert.equal(invocation.command, "/usr/bin/node");
  assert.deepEqual(invocation.argsPrefix, [script]);
  assert.equal(invocation.source, "current-cli");
  assert.equal(deriveCurrentPiCliScript(["node", script]), script);
});

test("resolver ignores unrecognized or relative argv[1]", () => {
  assert.equal(deriveCurrentPiCliScript(["node", "node_modules/@mariozechner/pi-coding-agent/dist/cli.js"]), undefined);
  const invocation = resolvePiInvocationSync({ argv: ["node", "/tmp/not-pi/dist/cli.js"], execPath: "/usr/bin/node", env: {}, fileExists: () => false, isExecutable: () => false });
  assert.equal(invocation.source, "path");
  assert.equal(invocation.command, "pi");
});

test("resolver detects sibling npm bin", () => {
  const sibling = path.join("/opt/node/bin", process.platform === "win32" ? "pi.cmd" : "pi");
  const invocation = resolvePiInvocationSync({
    argv: ["node"],
    execPath: "/opt/node/bin/node",
    env: {},
    fileExists: (candidate) => candidate === sibling,
    isExecutable: (candidate) => candidate === sibling,
  });
  assert.equal(invocation.source, "sibling-bin");
  assert.equal(invocation.command, sibling);
});

test("resolver detects package-local npm bin", () => {
  const packageBin = path.join("/workspace/project", "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
  const invocation = resolvePiInvocationSync({
    argv: ["node"],
    execPath: "/opt/node/bin/node",
    cwd: "/workspace/project/subdir",
    env: {},
    fileExists: (candidate) => candidate === packageBin,
    isExecutable: (candidate) => candidate === packageBin,
  });
  assert.equal(invocation.source, "package-bin");
  assert.equal(invocation.command, packageBin);
});

test("resolver falls back to bare pi and formats display commands", () => {
  const invocation = resolvePiInvocationSync({ argv: ["node"], execPath: "/usr/bin/node", env: {}, fileExists: () => false, isExecutable: () => false });
  assert.equal(invocation.source, "path");
  assert.equal(invocation.command, "pi");
  assert.equal(formatPiInvocationCommand(invocation, ["--list-models"]), "pi --list-models");

  const currentCli = { command: "/usr/bin/node", argsPrefix: ["/opt/pi cli/dist/cli.js"], displayCommand: "", source: "current-cli" as const };
  assert.equal(formatPiInvocationCommand(currentCli, ["--print"]), "/usr/bin/node '/opt/pi cli/dist/cli.js' --print");
});
