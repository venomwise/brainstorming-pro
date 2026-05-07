# Pi Invocation Resolver Design

## Summary

Brainstorming Pro will replace ad hoc `spawn("pi", ...)` usage with a shared, deterministic Pi invocation resolver and a troubleshooting doctor command. The resolver will let first-run model discovery and subagent execution reuse the current running pi CLI when possible, avoiding extension-process `PATH` mismatches without requiring users to set `PI_COMMAND`. When automatic execution still fails, `/clarify` will show a concise diagnostic summary and `/clarify-doctor` will provide a full environment report, including optional shell-based detection for user-assisted troubleshooting.

## Goals

- First-run `/clarify` model discovery succeeds in common npm/nvm/global-install environments even when the extension process `PATH` does not contain `pi`.
- Subagent execution uses the same Pi invocation resolution as first-run setup, preventing later `spawn pi ENOENT` failures after setup succeeds.
- `PI_COMMAND` remains supported as an explicit advanced override, but users should not need it in the normal path.
- Error messages identify the selected invocation and point users to `/clarify-doctor` instead of only reporting raw `ENOENT`.
- `/clarify-doctor` emits a complete, copyable diagnostic report that pi can help analyze using normal agent tools/conversation.
- Main execution paths remain deterministic, testable, and free from login-shell probing side effects.

## Primary Users / Roles

- **First-time Brainstorming Pro users**: want `/clarify` first-run setup to discover models without manual environment configuration.
- **Brainstorming Pro maintainers**: need one audited place for Pi command resolution, diagnostics, and tests.
- **Advanced users debugging environment issues**: need a clear report showing how the extension process differs from their interactive shell.

## Non-Goals

- Do not replace pi CLI subprocess execution with pi internal APIs.
- Do not require users to set `PI_COMMAND` for standard npm/nvm/global pi installs.
- Do not support `PI_COMMAND` values containing shell snippets or arguments such as `npx pi` or `source ~/.zshrc && pi`.
- Do not run login-shell probes from the main resolver used by first-run setup or subagent execution.
- Do not use LLM tool calls as part of the first-run setup critical path.
- Do not reintroduce removed public maintenance commands such as `/clarify-diff` or `/clarify-clean`.

## Context

Brainstorming Pro currently has two pi subprocess paths:

- `extensions/clarification-orchestrator/first-run-config.ts` runs `pi --list-models` when no Brainstorming Pro user/project config file exists.
- `extensions/clarification-orchestrator/runner.ts` builds subagent commands using `pi --print --mode json --no-session ...`.

The first-run path has a friendly `ENOENT` message and a small resolver that checks explicit `piCommand`, `process.env.PI_COMMAND`, a current-process-derived command, then bare `pi`. The subagent path still directly falls back to `params.piCommand ?? process.env.PI_COMMAND ?? "pi"`.

The failure mode occurs because Node `spawn("pi", ...)` resolves bare commands through the child process environment `PATH`. A pi extension process can inherit a different `PATH` from the user's interactive shell, especially with nvm, npm global installs, pnpm, GUI/IDE launchers, or non-login shells. The user may be able to run `pi --list-models` interactively while the extension process cannot find `pi`.

Node's process model gives Brainstorming Pro a better option in many cases: `process.execPath` points to the current Node executable and `process.argv[1]` commonly points to the current CLI entry script. For npm global pi installs, `process.argv[1]` may be `.../@mariozechner/pi-coding-agent/dist/cli.js`; running `process.execPath process.argv[1] ...` avoids `PATH` lookup entirely and reuses the same pi version.

## Discovery

### Key Discoveries

- The core problem is not necessarily missing pi installation; it is the difference between interactive shell `PATH` and extension-process `PATH`.
- First-run and subagent command construction are currently inconsistent, so fixing only first-run can leave later subagent execution broken.
- Mature Node CLI patterns favor `process.execPath` for relaunching the current Node runtime and `process.argv[1]` for identifying the current entry script.
- VS Code/extension ecosystems often use shell-based CLI detectors for diagnostics, but running login shells on a normal execution path adds side effects, latency, and testing complexity.
- Letting pi's LLM tools inspect the environment is useful for troubleshooting, but extension command handlers cannot reliably depend on LLM tool calls during first-run setup.

### Scope Decisions

- Include a shared structured resolver used by both first-run setup and subagent execution.
- Include current pi CLI detection through `process.execPath + process.argv[1]` when the entry script is recognized as pi's CLI.
- Include sibling-bin and package-local-bin detection as deterministic fallback candidates.
- Include `/clarify-doctor` with deeper diagnostics and shell probing, but keep shell probing out of the main resolver.
- Keep `PI_COMMAND` as a high-priority explicit override for advanced users and tests.

## Proposed Solution

Add a shared Pi invocation layer that returns a structured invocation instead of a single command string. All pi subprocess callers use this invocation by prepending `argsPrefix` to their normal pi arguments. The main resolver is synchronous and deterministic, so it can be used inside existing command-building paths without adding async complexity. A separate doctor module performs active probes, command test runs, and optional login-shell detection for troubleshooting.

### Architecture

```text
/clarify first-run setup
        |
        v
  listPiModels()
        |
        v
  resolvePiInvocationSync()
        |
        v
  spawn(invocation.command, [...invocation.argsPrefix, "--list-models"])

subagent runner
        |
        v
  buildPiProcessArgs()
        |
        v
  resolvePiInvocationSync()
        |
        v
  spawn(invocation.command, [...invocation.argsPrefix, "--print", "--mode", "json", ...])

/clarify-doctor
        |
        v
  collectPiDoctorReport()
        |
        +--> deterministic resolver candidate report
        +--> active spawn probes
        +--> optional $SHELL -lc 'command -v pi' diagnostic only
```

The resolver selects one invocation for execution. The doctor reports all meaningful candidates and their observed status.

### Components

#### `extensions/clarification-orchestrator/pi-command.ts`

Responsibilities:

- Define `PiInvocation` and candidate metadata types.
- Resolve the invocation used for normal execution.
- Detect current pi CLI entrypoint from `process.argv[1]`.
- Detect sibling pi binaries near `process.execPath`.
- Detect package-local `node_modules/.bin/pi` candidates.
- Format display commands for errors and diagnostics.

Proposed public interface:

```ts
export type PiInvocationSource =
  | "explicit"
  | "env"
  | "current-cli"
  | "sibling-bin"
  | "package-bin"
  | "path";

export type PiInvocation = {
  command: string;
  argsPrefix: string[];
  displayCommand: string;
  source: PiInvocationSource;
};

export type PiInvocationResolverOptions = {
  piCommand?: string;
  env?: NodeJS.ProcessEnv;
  argv?: string[];
  execPath?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
  fileExists?: (path: string) => boolean;
  isExecutable?: (path: string) => boolean;
};

export function resolvePiInvocationSync(options?: PiInvocationResolverOptions): PiInvocation;
export function deriveCurrentPiCliScript(argv?: string[]): string | undefined;
export function formatPiInvocationCommand(invocation: PiInvocation, args?: string[]): string;
```

Resolution order:

1. Explicit `piCommand` option.
2. `env.PI_COMMAND`.
3. Current pi CLI entrypoint: recognized absolute `process.argv[1]` such as `.../@mariozechner/pi-coding-agent/dist/cli.js` or `.../pi-coding-agent/dist/cli.js`, executed with `process.execPath`.
4. Sibling npm bin next to `process.execPath`, typically `dirname(process.execPath)/pi` for npm-style installs where the pi bin is placed beside the Node executable.
5. Package-local bin such as `<cwd>/node_modules/.bin/pi` and package-root-relative candidates if available.
6. Bare `pi` as `PATH` fallback.

#### `extensions/clarification-orchestrator/first-run-config.ts`

Responsibilities:

- Use `resolvePiInvocationSync()` in `listPiModels()`.
- Spawn `invocation.command` with `[..., "--list-models"]`.
- Include selected invocation source and display command in startup errors.
- Keep parse and config-writing behavior unchanged.

#### `extensions/clarification-orchestrator/runner.ts`

Responsibilities:

- Use the same resolver in `buildPiProcessArgs()`.
- Return `command` and args with `argsPrefix` included.
- Preserve `BRAINSTORMING_PRO_SUBAGENT=1` and existing subagent arguments.
- Continue supporting explicit `piCommand` for tests and advanced callers.

#### `extensions/clarification-orchestrator/pi-doctor.ts`

Responsibilities:

- Collect full diagnostic information for `/clarify-doctor`.
- Probe deterministic resolver candidates and selected invocation.
- Optionally run shell diagnostic probes, but only inside doctor.
- Render a human-readable report suitable for copying into a pi conversation.

Suggested report fields:

- Platform, cwd, package version if available.
- `process.execPath`, `process.argv0`, `process.argv`, `process.argv[1]`.
- `PI_COMMAND` status, redacted only if necessary.
- Extension-process `PATH` split into entries.
- Selected resolver invocation and source.
- Candidate table with status: detected, exists, executable, selected, failed reason.
- Active probe results for selected invocation:
  - `--list-models` exit status, timeout status, parseable model count, stderr summary.
- Shell diagnostic:
  - `$SHELL` value.
  - Result of `$SHELL -lc 'command -v pi'` with timeout.
  - Note that shell result is diagnostic only and not used automatically by the main resolver.
- Recommendations.

#### `extensions/clarification-orchestrator/commands/doctor.ts`

Responsibilities:

- Register handler for `/clarify-doctor`.
- Call doctor report collection and notify/render the report.
- Avoid modifying config or environment.

#### `extensions/clarification-orchestrator/index.ts`

Responsibilities:

- Register `/clarify-doctor` as an advanced troubleshooting command.
- Keep public lifecycle command registration unchanged otherwise.
- Do not re-register `/clarify-diff` or `/clarify-clean`.

### Data Flow

#### First-run model discovery

1. User invokes `/clarify <request>` with no Brainstorming Pro config file loaded.
2. `ensureFirstRunConfig()` calls `listPiModels()`.
3. `listPiModels()` resolves a `PiInvocation`.
4. It spawns the invocation with `--list-models` appended.
5. If the command succeeds, existing model parsing and config prompts continue.
6. If spawn emits `ENOENT` or the command fails to start, the user receives a concise failure summary with selected invocation details and a `/clarify-doctor` recommendation.

#### Subagent execution

1. Workflow phase calls `runSubagent()`.
2. `buildPiProcessArgs()` resolves the same `PiInvocation`.
3. It constructs args as `invocation.argsPrefix + ["--print", "--mode", "json", "--no-session", ...]`.
4. `spawnPiProcess()` runs the command with existing timeout, registry, cancellation, and output-limit behavior.
5. Existing subagent result parsing and retry logic remain unchanged.

#### Doctor command

1. User invokes `/clarify-doctor`.
2. Doctor collects process/environment information.
3. Doctor computes deterministic candidates and selected invocation.
4. Doctor runs bounded active probes where safe.
5. Doctor runs `$SHELL -lc 'command -v pi'` with timeout as a diagnostic-only shell probe.
6. Doctor prints a report with recommendations.

## Error Handling

- **Selected invocation spawn `ENOENT`**: show selected source, display command, concise process context, and prompt to run `/clarify-doctor`. Mention `PI_COMMAND` only as a fallback.
- **Current CLI script detected but not usable**: doctor marks it failed and reports stderr/exit code. Main resolver may still select it if detection says it is valid; active failure is handled by caller.
- **No deterministic candidate except bare `pi`**: resolver returns `source: "path"`; if it fails, error explains that extension-process `PATH` could not find `pi`.
- **`PI_COMMAND` invalid or missing**: because it is explicit override, errors should name the configured value and remind users it must be a single executable path.
- **Shell probe failure in doctor**: report timeout, missing `$SHELL`, non-zero exit, or empty output without failing the whole doctor command.
- **Doctor active probe timeout**: mark probe as timed out and continue rendering partial diagnostics.

## Testing

### Unit Tests

Add `tests/unit/pi-command.test.ts`:

- explicit `piCommand` wins over all other sources.
- `PI_COMMAND` wins over current-cli and fallback sources.
- recognized `process.argv[1]` pi CLI returns `source: "current-cli"`, `command: process.execPath`, and `argsPrefix: [argv[1]]`.
- unrecognized `process.argv[1]` is ignored.
- sibling bin is selected when current-cli is not detected and candidate exists/executable.
- package-local bin is selected before bare `pi`.
- fallback returns `source: "path"`, `command: "pi"`, `argsPrefix: []`.
- display command formatting includes prefix args and appended runtime args.

Update `tests/unit/first-run-config.test.ts`:

- `listPiModels()` can run a fake current-cli invocation using `node fake-pi-cli.js --list-models` even when `PATH` does not contain `pi`.
- missing selected invocation emits a friendly Brainstorming Pro setup message that references `/clarify-doctor`.
- explicit `piCommand` and `PI_COMMAND` behavior remains supported.

Update `tests/unit/runner.test.ts`:

- `buildPiProcessArgs()` prepends current-cli `argsPrefix` before `--print`.
- `buildPiProcessArgs()` no longer falls directly to `process.env.PI_COMMAND ?? "pi"` outside the shared resolver.
- subagent env behavior is preserved.

Add doctor tests, either in `tests/unit/pi-doctor.test.ts` or command tests:

- doctor report includes process fields and selected invocation.
- shell probe success is reported as diagnostic-only.
- shell probe timeout/failure does not fail the whole report.

### Integration Tests

Update `tests/integration/clarify-first-run.test.ts`:

- first-run succeeds when extension `PATH` lacks `pi` but current-cli detection points to a fake pi CLI.
- existing user/project config still bypasses first-run model discovery.
- first-run failure message includes `/clarify-doctor`.

Update command registration tests:

- `/clarify-doctor` is registered.
- `/clarify`, `/clarify-status`, `/spec-plan`, and `/spec-exec` remain registered.
- `/clarify-diff` and `/clarify-clean` remain unregistered.

## Open Questions

- Should `/clarify-doctor` be documented as a public command in the main command list or only in an advanced troubleshooting section?
  - Recommendation: advanced troubleshooting section only.
- Should doctor actively run `--list-models` by default, or require an option to avoid model/provider startup latency?
  - Recommendation: run it with a short timeout because model discovery is the first-run failure point.
- Should the resolver cache the selected invocation?
  - Recommendation: no cache initially; resolution is cheap and avoiding cache prevents stale path issues after `/reload`.
- Should future versions allow shell-detected paths to be used automatically after user confirmation?
  - Recommendation: defer; current scope keeps shell probing diagnostic-only.
