#!/usr/bin/env node
const mode = process.env.AGENT_EXECUTION_FAKE_MODE ?? "valid";
if (mode === "valid") {
  process.stdout.write(JSON.stringify({ ok: true, argv: process.argv.slice(2), env: {
    BRAINSTORMING_PRO_CHILD: process.env.BRAINSTORMING_PRO_CHILD,
    BRAINSTORMING_PRO_AGENT_ROLE: process.env.BRAINSTORMING_PRO_AGENT_ROLE,
  } }));
  process.exit(0);
}
if (mode === "non-zero") {
  process.stderr.write("boom");
  process.exit(2);
}
if (mode === "timeout") {
  setTimeout(() => process.stdout.write("late"), 5000);
  setTimeout(() => process.exit(0), 6000);
}
if (mode === "huge") {
  process.stdout.write("x".repeat(2048));
  process.exit(0);
}
if (mode === "malformed") {
  process.stdout.write("not json");
  process.exit(0);
}
if (mode === "schema") {
  process.stdout.write(JSON.stringify({ ok: false }));
  process.exit(0);
}
process.stderr.write(`unknown mode ${mode}`);
process.exit(1);
