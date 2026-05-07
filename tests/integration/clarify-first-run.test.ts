import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { handleClarifyCommand } from "../../extensions/clarification-orchestrator/commands/clarify.ts";

function createCtx(answers: string[], notifications: Array<{ message: string; type?: string }>, hasUI = true): any {
  return {
    hasUI,
    ui: {
      notify: (message: string, type?: string) => notifications.push({ message, type }),
      input: hasUI
        ? async () => {
            const answer = answers.shift();
            return answer ?? "";
          }
        : undefined,
    },
  };
}

async function withTempProcessEnv<T>(fn: (env: { cwd: string; home: string }) => Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;
  const originalPiCommand = process.env.PI_COMMAND;
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bp-clarify-cwd-"));
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "bp-clarify-home-"));
  process.chdir(cwd);
  process.env.HOME = home;
  try {
    return await fn({ cwd, home });
  } finally {
    process.chdir(originalCwd);
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalPiCommand === undefined) delete process.env.PI_COMMAND;
    else process.env.PI_COMMAND = originalPiCommand;
  }
}

async function writePiListModelsCommand(dir: string): Promise<string> {
  const command = path.join(dir, "fake-pi.sh");
  await fs.writeFile(command, `#!/usr/bin/env bash
if [ "$1" = "--list-models" ]; then
  cat <<'EOF'
provider         model              context  max-out  thinking  images
 Hotaru-claude    claude-opus-4-7    1M       128K     yes       yes
 星辰-gpt-pro       gpt-5.5            1M       128K     yes       yes
EOF
  exit 0
fi
echo "unexpected pi args: $*" >&2
exit 2
`, "utf8");
  await fs.chmod(command, 0o755);
  return command;
}

test("/clarify first-run setup writes config and continues with reloaded config", async () => {
  await withTempProcessEnv(async ({ cwd, home }) => {
    process.env.PI_COMMAND = await writePiListModelsCommand(cwd);
    const notifications: Array<{ message: string; type?: string }> = [];
    const ctx = createCtx(["2", "1,2,1", "1"], notifications);

    await handleClarifyCommand("Build first-run feature", ctx);

    const configPath = path.join(home, ".pi", "agent", "brainstorming-pro", "config.json");
    const config = JSON.parse(await fs.readFile(configPath, "utf8"));
    assert.deepEqual(config, {
      version: 1,
      models: {
        default: "星辰-gpt-pro/gpt-5.5",
        fallback: ["Hotaru-claude/claude-opus-4-7"],
      },
    });
    assert.equal(notifications.some((entry) => /Brainstorming Pro config written/.test(entry.message)), true);
    assert.equal(notifications.some((entry) => /Clarification workflow (reached phase DESIGN_REVIEW_GATE|stopped at ABORTED)/.test(entry.message)), true);
  });
});

test("/clarify skips first-run setup when project config exists despite missing PI_COMMAND", async () => {
  await withTempProcessEnv(async ({ cwd, home }) => {
    await fs.mkdir(path.join(cwd, ".pi", "brainstorming-pro"), { recursive: true });
    await fs.writeFile(path.join(cwd, ".pi", "brainstorming-pro", "config.json"), JSON.stringify({ version: 1, models: { default: "openai/gpt-4o", fallback: [] } }, null, 2));
    process.env.PI_COMMAND = path.join(cwd, "missing-pi-command");
    const notifications: Array<{ message: string; type?: string }> = [];
    const ctx = createCtx(["1"], notifications);

    await handleClarifyCommand("Use project config", ctx);

    const userConfigPath = path.join(home, ".pi", "agent", "brainstorming-pro", "config.json");
    await assert.rejects(fs.access(userConfigPath), /ENOENT/);
    assert.equal(notifications.some((entry) => /Brainstorming Pro first-run setup/.test(entry.message)), false);
    assert.equal(notifications.some((entry) => /Clarification workflow (reached phase DESIGN_REVIEW_GATE|stopped at ABORTED)/.test(entry.message)), true);
  });
});

test("/clarify interactive no-config reports friendly missing pi discovery guidance", async () => {
  await withTempProcessEnv(async ({ cwd }) => {
    process.env.PI_COMMAND = path.join(cwd, "missing-pi-command");
    const notifications: Array<{ message: string; type?: string }> = [];
    await handleClarifyCommand("Needs setup", createCtx([], notifications));
    assert.equal(notifications.at(-1)?.type, "error");
    assert.match(notifications.at(-1)?.message ?? "", /Brainstorming Pro first-run setup could not find the pi executable/);
    assert.match(notifications.at(-1)?.message ?? "", /which pi/);
    assert.match(notifications.at(-1)?.message ?? "", /PI_COMMAND/);
  });
});

test("/clarify non-interactive no-config reports setup guidance", async () => {
  await withTempProcessEnv(async () => {
    const notifications: Array<{ message: string; type?: string }> = [];
    await handleClarifyCommand("Non interactive request", createCtx([], notifications, false));
    assert.equal(notifications.at(-1)?.type, "error");
    assert.match(notifications.at(-1)?.message ?? "", /first-run setup requires interactive UI/);
  });
});

test("/clarify --dry-run does not require first-run setup", async () => {
  await withTempProcessEnv(async ({ home }) => {
    const notifications: Array<{ message: string; type?: string }> = [];
    await handleClarifyCommand("Dry run request --dry-run", createCtx([], notifications, false));
    const userConfigPath = path.join(home, ".pi", "agent", "brainstorming-pro", "config.json");
    await assert.rejects(fs.access(userConfigPath), /ENOENT/);
    assert.equal(notifications.some((entry) => /Dry run: would execute clarification/.test(entry.message)), true);
  });
});
