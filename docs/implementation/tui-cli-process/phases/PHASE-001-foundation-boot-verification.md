# PHASE-001 - Foundation, Boot, And Verification

**Status**: Planned  
**Goal**: Establish the repo foundation, boot lifecycle, config validation path, TUI shell, and baseline verification before feature work.  
**Depends on**: None  
**LLD sources**: `README.md` Stack inference and Assumptions; `design.md` Forge/engine-lib mapping, Architecture, Concurrency model, Algorithm 4; `observability.md` Logs, Redaction, Log rotation, Traces; ADR-LLD-001; ADR-LLD-003  
**Review findings addressed**: OQ-001, OQ-002, OQ-003, OQ-004

## Scope

- Project scripts, dependency metadata, source directories, and test harness needed for implementation.
- `forge/lifecycle` boot shell with ordered component registration and shutdown seams.
- `forge/config` schema with YAML source adapter, env/secret handling, CLI mode parsing, and `--validate-config` short-circuit.
- Starter OpenTUI replacement with a minimal app shell wired to view-model seams.
- Structured logging, redaction, rotation wrapper, null telemetry exporters, and crash-report redaction hook.
- Readiness checkpoint for the missing LLD review report.

## Out Of Scope

- SQLite database creation and PID/lock file behavior; handled in PHASE-002.
- Command router and read-only enforcement; handled in PHASE-003.
- Spawning Minecraft processes; handled in PHASE-004.
- Agent execution, chat parsing, and tool sandbox behavior; handled later.

## Implementation Units

| Unit ID | Type | Summary | Source | Risk |
| ------- | ---- | ------- | ------ | ---- |
| IU-001 | delivery | Expand project scripts, dependency metadata, TypeScript strict checks, test command, and source layout. | `README.md` Stack inference; `package.json` | Medium |
| IU-002 | delivery | Establish forge lifecycle boot, ordered startup/shutdown, signal handling, and validation-only short-circuit. | `design.md` Architecture and Concurrency model | Medium |
| IU-003 | contract | Build runtime config schema, YAML adapter, env/secret resolution, and `--validate-config` diagnostics. | `design.md` Algorithm 4; ADR-LLD-003 | High |
| IU-004 | contract | Replace starter OpenTUI app with TUI shell and view-model subscription seams. | `design.md` TUI View Engine mapping | Medium |
| IU-005 | observability | Add structured log baseline, redaction, rotating file writer, telemetry null exporters, and crash report hook. | `observability.md` Logs and Redaction | High |
| IU-034 | test | Establish unit and contract test harness used by later phases. | `tests.md` Test pyramid | Medium |

## Work Items

1. Add or update scripts for test, type check, dev, and eventual build verification.
2. Reconcile the TypeScript version and strictness with the LLD stack claim; if the repo remains on TypeScript 5, record an LLD correction before merging.
3. Add the selected YAML parser dependency required by the LLD and wire a YAML source adapter for `forge/config`.
4. Create source module boundaries for config, lifecycle, telemetry, TUI, domain, router, persistence, process, log, chat, agent, and tools without filling later-phase behavior.
5. Implement config schema leaves for servers, agents, providers, permissions, feature flags, telemetry, logging, and retention.
6. Implement CLI mode parsing for normal, `--read-only`, and `--validate-config`; make validation-only exit before starting TUI, DB, Java, or LLM components.
7. Create `forge.boot` component registration with ordered start/stop seams and signal handling.
8. Replace the starter OpenTUI screen with a minimal app shell that can render boot status, config errors, and placeholder panels.
9. Configure structured JSON logging with redaction, 50 MB rotation wrapper, telemetry off-by-default null exporters, and redacted uncaught exception crash reports.
10. Add unit tests for config schema defaults, invalid config diagnostics, secret redaction, validation-only side-effect avoidance, and crash report redaction.

## Data And Deployment Notes

- No persistent database or PID file should be created in this phase.
- `--validate-config` must not create `data/sessions.db`, spawn Java, initialize providers, or start the TUI.
- Rollback is a normal code revert; generated logs or crash reports in temp test directories can be deleted.

## Tests And Verification

- Unit tests: config schema defaults, validation errors, env secret redaction, CLI mode parsing, crash redaction.
- Integration tests: boot in normal mode with mocked components; boot in `--validate-config` success and failure paths.
- Contract tests: initial OpenAPI parser loads the spec without validating command handlers yet.
- End-to-end or smoke tests: `bun run dev` renders the TUI shell with no configured servers in a temp config.
- Manual checks: run `--validate-config` against a valid and invalid sample config and verify exit codes.
- Commands: `bun test`; `bun run check` after PHASE-001 adds it.

## Observability And Operations

- Log entries include required fields from `observability.md`.
- Redaction patterns scrub secrets, tokens, PEM blocks, emails, and known key names.
- Telemetry export is disabled by default but the app log remains enabled.
- Crash report output uses the same redactor as logs.

## Acceptance Criteria

- The repo has repeatable test and type-check commands.
- A valid config boots to the TUI shell.
- Invalid config fails fast with diagnostics and no side effects.
- `--validate-config` exits 0 on valid config and non-zero on invalid config.
- Secrets are redacted in logs, diagnostics, and crash reports.
- The phase PR explicitly records whether an LLD review was run or deferred.

## Review Packet

- Expected files or modules touched: `package.json`, `tsconfig.json`, `src/index.tsx`, config/lifecycle/telemetry/TUI modules, tests, sample configs.
- LLD sections reviewers should compare against: `README.md` Stack inference, `design.md` Algorithm 4, `observability.md` Logs/Redaction, ADR-LLD-001, ADR-LLD-003.
- Expected evidence: test output, type-check output, validation-only terminal output, redacted log sample, TUI shell capture.

## Risks And Questions

- OQ-003: the YAML parser dependency is not currently present.
- OQ-004: TypeScript version metadata conflicts with the LLD and must be reconciled.
- If `forge/telemetry` cannot support file output directly, keep the host rotating writer isolated and covered by tests.
