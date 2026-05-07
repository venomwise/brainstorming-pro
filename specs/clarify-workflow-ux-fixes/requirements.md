# Requirements Document: Clarify Workflow UX Fixes

## Introduction

Clarify Workflow UX Fixes improves the Brainstorming Pro `/clarify` command so users can move from a natural-language request to a reviewable `design.md` through a reliable, explicit lifecycle. The change addresses first-run model selection confusion, unsafe or unreadable topic slug generation for Chinese and mixed-language requests, and the current orchestration gap where workflow metadata advances to the design gate without executing the discovery/design phases.

The scope is limited to `/clarify` startup, topic proposal/validation, V0 discovery/design execution, design review gate routing, final approval handoff messaging, and regression tests. It does not add a custom model selector UI, support Chinese topic directory names, expand static translation glossaries, auto-run `/spec-plan`, or change the public command surface of `/clarify`, `/spec-plan`, or `/spec-exec`.

## Glossary

- **Clarification topic**: The repository-safe topic slug used under `specs/<topic>/` for a clarification run.
- **English kebab-case**: Lowercase ASCII letters and numbers separated by single hyphens, with no leading/trailing hyphen or repeated hyphen.
- **First-run setup**: Interactive configuration flow in `first-run-config.ts` that discovers Pi models and writes the user config.
- **LLM topic proposal**: Model-backed generation of semantic English kebab-case topic candidates from Chinese or mixed-language requests.
- **Manual topic fallback**: Interactive user entry of an English kebab-case topic when automatic proposal cannot produce valid candidates.
- **V0 discovery/design**: Initial designer-agent phase that writes discovery artifacts and version `v0` design artifacts.
- **Design review gate**: Interactive gate that lets the user choose `approve`, `review`, `revise`, or `save` for the current design.
- **Lifecycle handoff**: Final `/clarify` approval behavior that prints `/spec-plan <topic>` for the user to run manually.
- **Run artifacts**: Files under `specs/<topic>/clarification/run-*`, including state, metadata, versions, gate decisions, and final approval output.

## Requirements

### Requirement 1: First-run model selection guidance

**User Story:** As an end user running `/clarify` for the first time, I want model selection prompts to clearly ask for list numbers, so that I do not accidentally enter a provider/model name and fail setup without understanding why.

#### Acceptance Criteria

1. WHEN first-run setup displays discovered Pi models, THEN the system SHALL state that users must enter the number shown in the list.
2. WHEN the default model prompt is displayed, THEN the system SHALL include numeric-choice wording and a numeric placeholder such as `1`.
3. WHEN the fallback model prompt is displayed, THEN the system SHALL describe comma-separated numbers and allow a blank value for no fallback models.
4. IF a user enters a model name or any non-numeric token for a model choice, THEN the system SHALL throw a clear error explaining to enter the number from the list, for example `1`, not the model name.
5. IF no provider-qualified models are discovered, THEN the system SHALL preserve the existing failure behavior and guidance for configuring Pi models before rerunning `/clarify`.
6. WHEN first-run setup succeeds, THEN the system SHALL preserve the current config file shape with `version`, `models.default`, and `models.fallback` fields.

### Requirement 2: Strict clarification topic validation

**User Story:** As a package maintainer, I want clarification topics to be constrained to safe English kebab-case, so that generated spec paths remain readable, portable, and protected from path traversal.

#### Acceptance Criteria

1. WHEN a candidate topic is `task-dispatch-status`, `payment-integration`, or `user-auth-v2`, THEN the clarification topic validator SHALL accept it.
2. WHEN a candidate contains Chinese text, Unicode non-ASCII letters, uppercase letters, spaces, underscores, path separators, dots as path prefixes, leading/trailing hyphens, repeated hyphens, or is empty, THEN the clarification topic validator SHALL reject it with an explicit English kebab-case format message.
3. WHEN a candidate contains traversal or absolute-path patterns such as `../x`, `/tmp/x`, `foo/bar`, or `foo\\bar`, THEN the system SHALL reject it before resolving `specs/<topic>/` paths.
4. WHEN other repository code still needs general topic/path safety checks, THEN the implementation SHALL preserve existing path traversal guards instead of weakening them.
5. WHEN `/clarify` confirms or manually accepts a topic, THEN the confirmed value SHALL pass the strict clarification topic validator before `resolveSpecPaths()` and `createRun()` are called.
6. IF validation fails during manual topic entry, THEN the system SHALL report the allowed English kebab-case format and avoid creating artifacts for the invalid topic.

### Requirement 3: Deterministic English topic proposal

**User Story:** As an English-language user, I want `/clarify` to continue proposing useful topic names deterministically, so that ordinary English requests remain fast and predictable.

#### Acceptance Criteria

1. WHEN a request contains only English/Latin text, THEN the system SHALL generate up to three deterministic English kebab-case candidates without invoking LLM topic proposal.
2. WHEN deterministic generation extracts generic words, THEN the system SHALL continue filtering weak generic terms such as `build`, `create`, `feature`, and `workflow` where practical.
3. WHEN deterministic candidates conflict with existing topics, THEN the system SHALL mark exact conflicts and include safe similar-topic reuse choices.
4. WHEN deterministic generation produces invalid or empty candidates, THEN the system SHALL filter them out before presenting choices to the user.
5. IF no valid deterministic candidate remains, THEN the system SHALL use manual topic fallback rather than inventing an unsafe or unreadable slug.

### Requirement 4: LLM topic proposal for Chinese and mixed-language requests

**User Story:** As a Chinese-language user, I want to describe a feature naturally in Chinese while receiving English kebab-case topic candidates, so that my spec paths are readable and repository-compatible.

#### Acceptance Criteria

1. WHEN a request contains Chinese Han characters or mixed-language content requiring semantic translation, THEN `/clarify` SHALL request two to three English kebab-case topic candidates from the configured model after first-run config is available.
2. WHEN building the LLM topic proposal prompt, THEN the system SHALL instruct the model to derive names from feature/project meaning, not perform word-for-word translation.
3. WHEN the LLM returns JSON candidate data, THEN the system SHALL parse the response and keep only candidates that pass strict English kebab-case validation.
4. WHEN the LLM returns duplicates, existing-topic conflicts, or similar topics, THEN the system SHALL deduplicate candidates and preserve safe conflict/similarity metadata for the topic gate.
5. IF the LLM call fails, times out, returns invalid JSON, or yields no valid candidates, THEN `/clarify` SHALL notify the user and request manual English kebab-case topic entry.
6. WHEN LLM topic proposal runs, THEN it SHALL not create spec directories, run artifacts, or design artifacts by itself.
7. WHEN a Chinese request lacks recognized glossary terms, THEN the system SHALL never generate codepoint fallback slugs such as `topic-itv-g99-i61`.

### Requirement 5: Topic confirmation UX and manual fallback

**User Story:** As a `/clarify` user, I want to choose from only safe topic candidates or enter my own safe topic, so that I understand where artifacts will be written.

#### Acceptance Criteria

1. WHEN safe candidates exist, THEN the topic confirmation prompt SHALL display only strict English kebab-case candidate slugs and their relevant warnings.
2. WHEN no safe candidates exist, THEN the topic confirmation prompt SHALL clearly say automatic generation failed or produced no safe candidates and ask for manual English kebab-case entry.
3. WHEN the user selects a candidate number, THEN the system SHALL use the associated validated topic or route to manual entry for edit/manual choices.
4. WHEN the user types `manual`, THEN the system SHALL prompt for an English kebab-case topic and validate it strictly.
5. IF the user enters an invalid manual topic, THEN the system SHALL reject it with the format rule and, if supported by the interactive UI, allow a bounded retry.
6. IF the user cancels topic confirmation or manual entry, THEN the system SHALL stop without creating a clarification run.

### Requirement 6: `/clarify` startup orchestration order

**User Story:** As a package maintainer, I want `/clarify` startup to execute setup, topic proposal, confirmation, and artifact creation in a safe order, so that model-backed topic proposal and run creation are deterministic and recoverable.

#### Acceptance Criteria

1. WHEN `/clarify <request>` starts without `--resume`, THEN it SHALL load configuration and run first-run setup before any LLM topic proposal that requires a configured model.
2. WHEN project-local security-sensitive config changes require confirmation, THEN non-interactive execution SHALL fail before topic confirmation or artifact creation.
3. WHEN `/clarify` is not a dry run and no interactive UI is available, THEN it SHALL fail early with guidance because topic confirmation and design gates require interaction.
4. WHEN topic confirmation succeeds, THEN `/clarify` SHALL resolve `specs/<topic>/` and create run artifacts only after strict topic validation.
5. WHEN `--dry-run` is used, THEN `/clarify` SHALL validate/propose the topic and write a dry-run debug plan without running designer execution or design gates.
6. IF startup encounters a topic generation or validation error, THEN it SHALL notify the user and avoid partial run creation unless a topic was already confirmed.

### Requirement 7: V0 discovery/design phase execution

**User Story:** As an end user, I want `/clarify` to produce an actual `design.md` after topic confirmation, so that the design review gate is based on reviewable artifacts rather than metadata-only phase changes.

#### Acceptance Criteria

1. WHEN a confirmed topic enters V0 brainstorming, THEN workflow orchestration SHALL call `runDiscoveryPhase()` with the resolved designer agent and configured model context.
2. WHEN designer execution succeeds, THEN the system SHALL write `specs/<topic>/design.md`, `specs/<topic>/clarification/run-*/versions/v0/design.md`, discovery markdown, discovery JSON, and update completed artifact metadata.
3. WHEN V0 design artifacts are written, THEN workflow state SHALL set the phase to `DESIGN_REVIEW_GATE`, set `resumeStatus` to `awaiting-design-gate-decision`, and increment `execution.agentRuns`.
4. WHEN designer execution fails or returns invalid structured output, THEN workflow state SHALL record a workflow error, mark execution failed or aborted according to existing policy, and print a resume/status hint where available.
5. IF the design review gate would be presented without an existing design artifact, THEN the system SHALL treat it as an orchestration error and SHALL NOT claim the workflow reached a reviewable gate.
6. WHEN a mocked designer runner is used in tests, THEN topic confirmation SHALL still lead to `agentRuns > 0` and V0 design artifacts before gate routing.

### Requirement 8: Design review gate routing and lifecycle handoff

**User Story:** As an end user reviewing the generated design, I want approve/review/revise/save actions to route through the existing lifecycle correctly, so that I can either finish clarification, improve the design, or resume later.

#### Acceptance Criteria

1. WHEN the workflow reaches `DESIGN_REVIEW_GATE`, THEN it SHALL call `presentDesignReviewGate()` with the latest design version and the generated design path.
2. WHEN the user chooses `save`, THEN the system SHALL persist `resumeStatus: awaiting-design-gate-decision`, stop without marking the workflow complete, and provide a resume hint.
3. WHEN the user chooses `approve` and there are no unresolved blocking decisions, THEN the system SHALL run `runFinalApprovalPhase()` and mark the workflow complete.
4. WHEN final approval completes, THEN the system SHALL print or notify the lifecycle handoff command `/spec-plan <topic>` and SHALL NOT auto-run `/spec-plan`.
5. WHEN the user chooses `review`, THEN the system SHALL route into the existing cross-review lifecycle phases rather than completing immediately.
6. WHEN the user chooses `revise`, THEN the system SHALL route into the existing conversational revision phase and then return to the design review gate with updated artifacts.
7. IF approval is attempted while blocking decisions remain unresolved, THEN the system SHALL preserve the existing blocking issue check and report the issue IDs.

### Requirement 9: Regression test coverage and command stability

**User Story:** As a maintainer, I want automated regression coverage for first-run prompts, topic validation/proposal, orchestration, and security, so that future changes do not reintroduce unreadable slugs or metadata-only workflow advancement.

#### Acceptance Criteria

1. WHEN unit tests run, THEN they SHALL cover first-run numeric prompt copy and non-numeric model-choice errors.
2. WHEN unit tests run, THEN they SHALL cover strict clarification topic validation acceptance and rejection cases.
3. WHEN unit tests run, THEN they SHALL verify Chinese requests do not produce codepoint fallback slugs and invalid LLM outputs trigger manual fallback behavior.
4. WHEN integration tests run, THEN they SHALL cover first-run config followed by Chinese LLM topic proposal and artifact creation under an English topic.
5. WHEN integration tests run, THEN they SHALL verify topic confirmation leads to designer execution, V0 design artifacts, design gate `save`, and design gate `approve` handoff behavior.
6. WHEN security tests run, THEN they SHALL verify malicious LLM-generated topics and Unicode homoglyph attempts are rejected.
7. WHEN validation commands run, THEN `npm run typecheck`, `npm test`, and `npm run validate-package` SHALL pass without public command surface changes.
