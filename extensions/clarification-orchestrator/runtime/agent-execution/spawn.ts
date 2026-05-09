import { spawn, type ChildProcess } from "node:child_process";
import type { AgentLaunchSpec } from "./launch-spec.ts";
import { captureStderrChunk, captureStdoutChunk, createBoundedOutputBuffers, writeCapturedOutput, type BoundedOutputBuffers } from "./output.ts";
import { createAgentRunError, type AgentRunError, type AgentRunLimits, type AgentRunPaths } from "./types.ts";

export type SpawnAgentProcessResult = {
  status: "succeeded" | "failed" | "timed-out";
  exitCode: number | null;
  signal: NodeJS.Signals | string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  output: BoundedOutputBuffers;
  error?: AgentRunError;
};

type SpawnFunction = typeof spawn;

export type SpawnAgentProcessOptions = {
  spawnFn?: SpawnFunction;
  onStdout?: (bytes: number) => void;
  onStderr?: (bytes: number) => void;
};

export async function spawnAgentProcess(
  spec: AgentLaunchSpec,
  limits: AgentRunLimits,
  paths: AgentRunPaths,
  options: SpawnAgentProcessOptions = {},
): Promise<SpawnAgentProcessResult> {
  const spawnFn = options.spawnFn ?? spawn;
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const output = createBoundedOutputBuffers();

  return new Promise<SpawnAgentProcessResult>((resolve) => {
    let child: ChildProcess;
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    const finish = async (result: Omit<SpawnAgentProcessResult, "startedAt" | "completedAt" | "durationMs" | "output">): Promise<void> => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      await writeCapturedOutput(paths, output);
      const completedAt = new Date().toISOString();
      resolve({
        ...result,
        startedAt,
        completedAt,
        durationMs: Date.now() - startMs,
        output,
      });
    };

    try {
      child = spawnFn(spec.command, spec.args, {
        cwd: spec.cwd,
        env: spec.env,
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: false,
      });
    } catch (error) {
      void finish({
        status: "failed",
        exitCode: null,
        signal: null,
        error: createAgentRunError("spawn-error", error instanceof Error ? error.message : String(error), { details: { command: spec.command } }),
      });
      return;
    }

    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, limits.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      captureStdoutChunk(output, chunk, limits.maxStdoutBytes, limits.maxOutputBytes);
      options.onStdout?.(chunk.length);
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      captureStderrChunk(output, chunk, limits.maxStderrBytes);
      options.onStderr?.(chunk.length);
    });

    child.on("error", (error) => {
      void finish({
        status: "failed",
        exitCode: null,
        signal: null,
        error: createAgentRunError(error.message.includes("ENOENT") ? "pi-command-not-found" : "spawn-error", error.message, { details: { command: spec.command } }),
      });
    });

    child.on("close", (code, signal) => {
      if (timedOut) {
        void finish({
          status: "timed-out",
          exitCode: code,
          signal,
          error: createAgentRunError("timeout", `Agent process timed out after ${limits.timeoutMs}ms.`, { details: { timeoutMs: limits.timeoutMs } }),
        });
        return;
      }

      if (signal) {
        void finish({
          status: "failed",
          exitCode: code,
          signal,
          error: createAgentRunError("signal", `Agent process exited due to signal ${signal}.`, { details: { signal } }),
        });
        return;
      }

      if (code !== 0) {
        void finish({
          status: "failed",
          exitCode: code,
          signal,
          error: createAgentRunError("non-zero-exit", `Agent process exited with code ${code}.`, { details: { exitCode: code } }),
        });
        return;
      }

      void finish({ status: "succeeded", exitCode: code, signal: null });
    });
  });
}
