import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { renderExecutionView } from "../../extensions/clarification-orchestrator/tui/execution/index.ts";
import { renderExecutionFallback } from "../../extensions/clarification-orchestrator/tui/execution-fallback.ts";
import type { ExecutionViewModel } from "../../extensions/clarification-orchestrator/tui/execution-view-model.ts";

const tuiExecutionFiles = [
  "extensions/clarification-orchestrator/tui/execution-view-model.ts",
  "extensions/clarification-orchestrator/tui/execution-fallback.ts",
  "extensions/clarification-orchestrator/tui/execution/index.ts",
  "extensions/clarification-orchestrator/tui/execution/task-timeline-view.ts",
  "extensions/clarification-orchestrator/tui/execution/current-task-view.ts",
  "extensions/clarification-orchestrator/tui/execution/checkpoint-view.ts",
  "extensions/clarification-orchestrator/tui/execution/checkbox-view.ts",
  "extensions/clarification-orchestrator/tui/execution/mutation-warning-view.ts",
  "extensions/clarification-orchestrator/tui/execution/blocker-view.ts",
  "extensions/clarification-orchestrator/tui/execution/execution-report-view.ts",
];

const forbiddenImports = [
  "execution-loop",
  "task-plan-parser",
  "checkbox-writer",
  "mutation-guard",
  "evidence-validator",
  "state-machine",
  "artifact-store",
  "decision-facade",
  "run-agent",
  "spawn",
  "agent-execution",
];

function model(): ExecutionViewModel {
  return {
    topic: "demo-topic",
    runId: "run-1",
    phase: "executing",
    generatedAt: "now",
    status: "blocked",
    summary: { totalTasks: 1, completedTasks: 0, runningTasks: 0, pendingTasks: 0, skippedTasks: 0, blockedTasks: 1, failedTasks: 0 },
    taskTimeline: [{ taskId: "1.1", title: "Checkpoint", kind: "checkpoint", status: "blocked", requirementIds: [], evidence: [], diagnostics: [], source: "summary" }],
    blockers: [{ taskId: "1.1", taskTitle: "Checkpoint", type: "validation_failure", tried: ["validated"], risk: "failed", options: ["inspect status"], neededFromUser: "fix input" }],
    mutationWarnings: [{ severity: "error", message: "unauthorized mutation", affectedTaskIds: ["1.1"], failClosed: true }],
    diagnostics: [],
    safeCommands: ["/brainstorm-pro --status", "/brainstorm-pro --resume"],
  };
}

test("execution TUI modules do not import runtime authority modules", async () => {
  for (const file of tuiExecutionFiles) {
    const content = await readFile(path.join(process.cwd(), file), "utf8");
    for (const forbidden of forbiddenImports) assert.doesNotMatch(content, new RegExp(forbidden, "u"), `${file} imports ${forbidden}`);
  }
});

test("execution renderers expose no recovery, approval, orchestration, or runner controls", () => {
  const output = `${renderExecutionView(model(), 120).join("\n")}\n${renderExecutionFallback(model(), { width: 120 })}`;
  assert.doesNotMatch(output, /\b(retry|abort|continue|skip|resolve|mark-complete|approve|state transition|single|parallel|chain|async|intercom|background runner|builtin agent)\b/iu);
  assert.match(output, /not user approval gates/);
});

test("execution rendering does not write workflow files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tui-exec-boundary-"));
  const files = ["tasks.md", "requirements.md", "design.md", path.join(".workflow", "state.json")];
  for (const file of files) {
    const full = path.join(dir, file);
    await import("node:fs/promises").then((fs) => fs.mkdir(path.dirname(full), { recursive: true }));
    await writeFile(full, "original\n");
  }
  const before = await Promise.all(files.map(async (file) => [file, (await stat(path.join(dir, file))).mtimeMs, await readFile(path.join(dir, file), "utf8")] as const));
  renderExecutionView(model(), 100);
  renderExecutionFallback(model(), { width: 100 });
  const after = await Promise.all(files.map(async (file) => [file, (await stat(path.join(dir, file))).mtimeMs, await readFile(path.join(dir, file), "utf8")] as const));
  assert.deepEqual(after, before);
});
