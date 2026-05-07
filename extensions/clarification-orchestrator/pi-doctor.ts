import { spawn } from "node:child_process";
import os from "node:os";
import { formatPiInvocationCommand, resolvePiInvocationSync, type PiInvocation } from "./pi-command.ts";
import { parsePiListModels } from "./first-run-config.ts";

export type PiDoctorProbe = {
  command: string;
  args: string[];
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  modelCount?: number;
};

export type PiDoctorReport = {
  platform: string;
  cwd: string;
  execPath: string;
  argv0: string;
  argv: string[];
  argv1?: string;
  piCommandSet: boolean;
  pathEntries: string[];
  selectedInvocation: PiInvocation;
  activeProbe?: PiDoctorProbe;
  shellProbe?: PiDoctorProbe;
};

export type PiDoctorOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  activeProbe?: boolean;
  shellProbe?: boolean;
  timeoutMs?: number;
  runProbe?: (command: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv) => Promise<PiDoctorProbe>;
};

export async function collectPiDoctorReport(options: PiDoctorOptions = {}): Promise<PiDoctorReport> {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 3000;
  const selectedInvocation = resolvePiInvocationSync({ cwd: options.cwd, env });
  const runProbe = options.runProbe ?? runProcessProbe;
  const report: PiDoctorReport = {
    platform: `${process.platform} ${os.release()}`,
    cwd: options.cwd ?? process.cwd(),
    execPath: process.execPath,
    argv0: process.argv0,
    argv: [...process.argv],
    argv1: process.argv[1],
    piCommandSet: Boolean(env.PI_COMMAND),
    pathEntries: (env.PATH ?? "").split(process.platform === "win32" ? ";" : ":").filter(Boolean),
    selectedInvocation,
  };

  if (options.activeProbe !== false) {
    report.activeProbe = await runProbe(selectedInvocation.command, [...selectedInvocation.argsPrefix, "--list-models"], timeoutMs, env);
    report.activeProbe.modelCount = parsePiListModels(combineProbeOutput(report.activeProbe)).length;
  }

  if (options.shellProbe !== false) {
    const shell = env.SHELL;
    report.shellProbe = shell ? await runProbe(shell, ["-lc", "command -v pi"], timeoutMs, env) : {
      command: "<none>", args: [], timedOut: false, exitCode: null, stdout: "", stderr: "", error: "SHELL is not set",
    };
  }

  return report;
}

export function renderPiDoctorReport(report: PiDoctorReport): string {
  const active = report.activeProbe;
  const shell = report.shellProbe;
  return [
    "# Brainstorming Pro Pi Doctor",
    "",
    "## Process",
    `- platform: ${report.platform}`,
    `- cwd: ${report.cwd}`,
    `- execPath: ${report.execPath}`,
    `- argv0: ${report.argv0}`,
    `- argv[1]: ${report.argv1 ?? "<unset>"}`,
    `- argv: ${JSON.stringify(report.argv)}`,
    "",
    "## PATH",
    `- PI_COMMAND: ${report.piCommandSet ? "set" : "not set"}`,
    ...report.pathEntries.map((entry) => `- ${entry}`),
    "",
    "## Resolver",
    `- selected source: ${report.selectedInvocation.source}`,
    `- selected command: ${formatPiInvocationCommand(report.selectedInvocation)}`,
    "",
    "## Active Probe",
    active ? renderProbe(active, true) : "- skipped",
    "",
    "## Shell Probe (diagnostic only; not used by the main resolver)",
    shell ? renderProbe(shell, false) : "- skipped",
    "",
    "## Recommendations",
    recommendation(report),
  ].join("\n");
}

function renderProbe(probe: PiDoctorProbe, includeModels: boolean): string {
  return [
    `- command: ${[probe.command, ...probe.args].join(" ")}`,
    `- exitCode: ${probe.exitCode ?? "none"}`,
    `- timedOut: ${probe.timedOut}`,
    includeModels ? `- parseable model count: ${probe.modelCount ?? 0}` : undefined,
    probe.error ? `- error: ${probe.error}` : undefined,
    probe.stderr.trim() ? `- stderr: ${summarize(probe.stderr)}` : undefined,
    probe.stdout.trim() ? `- stdout: ${summarize(probe.stdout)}` : undefined,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function recommendation(report: PiDoctorReport): string {
  if (report.activeProbe && !report.activeProbe.timedOut && report.activeProbe.exitCode === 0) {
    if ((report.activeProbe.modelCount ?? 0) === 0) {
      return "- Pi invocation succeeded, but Brainstorming Pro could not parse any provider/model rows. This may indicate a `pi --list-models` output format compatibility issue.";
    }
    return "- Automatic pi invocation resolution appears to work.";
  }
  return "- If automatic resolution cannot find pi, run `which pi` in a working shell and set PI_COMMAND to that single executable path (not a shell command with arguments).";
}

function combineProbeOutput(probe: PiDoctorProbe): string {
  return [probe.stdout, probe.stderr].filter(Boolean).join("\n");
}

function summarize(text: string): string {
  const trimmed = text.trim().replace(/\s+/gu, " ");
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function runProcessProbe(command: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv): Promise<PiDoctorProbe> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const child = spawn(command, args, { env });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => stdout += chunk.toString("utf8"));
    child.stderr.on("data", (chunk) => stderr += chunk.toString("utf8"));
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ command, args, timedOut, exitCode: null, stdout, stderr, error: error.message });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ command, args, timedOut, exitCode, stdout, stderr });
    });
  });
}
