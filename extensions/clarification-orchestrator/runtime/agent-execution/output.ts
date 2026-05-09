import fs from "node:fs/promises";
import type { AgentOutputCaptureSummary, AgentRunPaths } from "./types.ts";

export type BoundedOutputBuffers = {
  stdout: Buffer;
  stderr: Buffer;
  rawOutput: Buffer;
  summary: AgentOutputCaptureSummary;
};

function appendBounded(current: Buffer, chunk: Buffer, limit: number): { buffer: Buffer; truncated: boolean } {
  if (limit <= 0) return { buffer: Buffer.alloc(0), truncated: current.length + chunk.length > 0 };
  const combined = Buffer.concat([current, chunk]);
  if (combined.length <= limit) return { buffer: combined, truncated: false };
  return { buffer: combined.subarray(0, limit), truncated: true };
}

export function createBoundedOutputBuffers(): BoundedOutputBuffers {
  return {
    stdout: Buffer.alloc(0),
    stderr: Buffer.alloc(0),
    rawOutput: Buffer.alloc(0),
    summary: {
      stdoutBytes: 0,
      stderrBytes: 0,
      rawOutputBytes: 0,
      stdoutTruncated: false,
      stderrTruncated: false,
      rawOutputTruncated: false,
    },
  };
}

export function captureStdoutChunk(buffers: BoundedOutputBuffers, chunk: Buffer, maxStdoutBytes: number, maxOutputBytes: number): void {
  buffers.summary.stdoutBytes += chunk.length;
  const stdout = appendBounded(buffers.stdout, chunk, maxStdoutBytes);
  buffers.stdout = stdout.buffer;
  buffers.summary.stdoutTruncated = buffers.summary.stdoutTruncated || stdout.truncated;

  buffers.summary.rawOutputBytes += chunk.length;
  const raw = appendBounded(buffers.rawOutput, chunk, maxOutputBytes);
  buffers.rawOutput = raw.buffer;
  buffers.summary.rawOutputTruncated = buffers.summary.rawOutputTruncated || raw.truncated;
}

export function captureStderrChunk(buffers: BoundedOutputBuffers, chunk: Buffer, maxStderrBytes: number): void {
  buffers.summary.stderrBytes += chunk.length;
  const stderr = appendBounded(buffers.stderr, chunk, maxStderrBytes);
  buffers.stderr = stderr.buffer;
  buffers.summary.stderrTruncated = buffers.summary.stderrTruncated || stderr.truncated;
}

export async function writeCapturedOutput(paths: AgentRunPaths, buffers: BoundedOutputBuffers): Promise<void> {
  if (paths.stdoutPath) await fs.writeFile(paths.stdoutPath, buffers.stdout);
  if (paths.stderrPath) await fs.writeFile(paths.stderrPath, buffers.stderr);
  if (paths.rawOutputPath) await fs.writeFile(paths.rawOutputPath, buffers.rawOutput);
}

export function rawOutputAsUtf8(buffers: BoundedOutputBuffers): string {
  return buffers.rawOutput.toString("utf8");
}
