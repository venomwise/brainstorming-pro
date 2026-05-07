import test from "node:test";
import assert from "node:assert/strict";
import { collectPiDoctorReport, renderPiDoctorReport, type PiDoctorProbe } from "../../extensions/clarification-orchestrator/pi-doctor.ts";

function probe(stdout = "", stderr = "", exitCode: number | null = 0, timedOut = false): PiDoctorProbe {
  return { command: "pi", args: ["--list-models"], stdout, stderr, exitCode, timedOut };
}

test("doctor report includes process fields and selected invocation", async () => {
  const report = await collectPiDoctorReport({ env: { PATH: "/a:/b" }, activeProbe: false, shellProbe: false, cwd: process.cwd() });
  assert.equal(report.cwd, process.cwd());
  assert.equal(report.execPath, process.execPath);
  assert.equal(Array.isArray(report.argv), true);
  assert.equal(report.piCommandSet, false);
  assert.deepEqual(report.pathEntries, ["/a", "/b"]);
  assert.ok(report.selectedInvocation.command);
});

test("doctor active probe records parseable model count", async () => {
  const output = "provider model context\nOpenAI gpt-4o 128K\n";
  const report = await collectPiDoctorReport({
    env: { PATH: "" },
    shellProbe: false,
    runProbe: async () => probe(output),
  });
  assert.equal(report.activeProbe?.modelCount, 1);
  assert.equal(report.activeProbe?.exitCode, 0);
});

test("doctor active probe counts models emitted on stderr", async () => {
  const output = "provider         model              context\n星辰-gpt-pro       gpt-5.5            1M\n";
  const report = await collectPiDoctorReport({
    env: { PATH: "" },
    shellProbe: false,
    runProbe: async () => probe("", output),
  });
  assert.equal(report.activeProbe?.modelCount, 1);
  assert.equal(report.activeProbe?.exitCode, 0);
});

test("doctor shell probe is diagnostic-only and failures render", async () => {
  const report = await collectPiDoctorReport({
    env: { PATH: "", SHELL: "/bin/sh" },
    activeProbe: false,
    runProbe: async (command, args) => ({ command, args, stdout: "", stderr: "no pi", exitCode: 1, timedOut: false }),
  });
  assert.equal(report.shellProbe?.exitCode, 1);
  const rendered = renderPiDoctorReport(report);
  assert.match(rendered, /diagnostic only/);
  assert.match(rendered, /no pi/);
});

test("doctor render recommends automatic success, parse warning, or PI_COMMAND fallback", async () => {
  const success = await collectPiDoctorReport({ env: { PATH: "" }, shellProbe: false, runProbe: async () => probe("provider model context\nA b 1K\n") });
  assert.match(renderPiDoctorReport(success), /Automatic pi invocation resolution appears to work/);

  const parseFailure = await collectPiDoctorReport({ env: { PATH: "" }, shellProbe: false, runProbe: async () => probe("not a model table\n") });
  assert.match(renderPiDoctorReport(parseFailure), /could not parse any provider\/model rows/);
  assert.match(renderPiDoctorReport(parseFailure), /output format compatibility issue/);

  const failure = await collectPiDoctorReport({ env: { PATH: "" }, shellProbe: false, runProbe: async () => probe("", "missing", null, false) });
  assert.match(renderPiDoctorReport(failure), /PI_COMMAND/);
  assert.match(renderPiDoctorReport(failure), /single executable path/);
});
