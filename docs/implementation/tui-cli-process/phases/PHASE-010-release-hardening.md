# PHASE-010 - Release Hardening

**Status**: Planned  
**Goal**: Complete cross-platform, performance, packaging, runbook, and release-readiness evidence after feature slices are implemented.  
**Depends on**: PHASE-001 through PHASE-009  
**LLD sources**: `tests.md` Performance tests and E2E journeys; `observability.md` Alerts and Dashboard; HLD `06-deployment.md`; ADR-LLD-002 mitigations; `README.md` Stack inference  
**Review findings addressed**: None

## Scope

- Full E2E journey set from `tests.md`.
- Performance/load profiles for hot-reload, log ingestion, memory, and agent latency.
- Windows/Linux CI matrix and process cleanup evidence.
- Packaging script and release artifact decision: npm package or Bun compiled binary per HLD deployment constraints.
- Operator docs, runbooks, and release notes.
- Final traceability evidence sweep.

## Out Of Scope

- New features not already in PHASE-001 through PHASE-009.
- Future music/audio, plugin SDK, or remote API work.
- Alert evaluation in the manager process; alerts remain collector-side per LLD.

## Implementation Units

| Unit ID | Type     | Summary                                                                                        | Source                       | Risk   |
| ------- | -------- | ---------------------------------------------------------------------------------------------- | ---------------------------- | ------ |
| IU-035  | test     | Add performance/load profiles for hot-reload, log ingestion, memory, and agent run latency.    | `tests.md` Performance tests | Medium |
| IU-036  | delivery | Add packaging/release scripts for npm package or Bun compiled binary, release notes, and docs. | HLD `06-deployment.md`       | Medium |
| IU-037  | delivery | Add Windows/Linux CI matrix and evidence for process cleanup parity.                           | ADR-LLD-002 mitigations      | High   |
| IU-034  | test     | Complete E2E test coverage and final verification evidence.                                    | `tests.md` E2E journeys      | High   |

## Work Items

1. Add E2E journey for boot, start server, player mention, response delivery, stop, and shutdown.
2. Add E2E journey for config edit, hot-reload, and `/chat` with new agent.
3. Add E2E journey for read-only mode rejection and allowed session inspection.
4. Add E2E journey for tool allowlist block, model retry, and allowed command success.
5. Add E2E journey for provider hang and `PROVIDER_TIMEOUT` display.
6. Add performance profile for 10-server config hot-reload under 2 seconds.
7. Add log ingestion load profile for 5000 lines/s and memory cap evidence.
8. Add weekly or manual performance script that reports RSS under idle and load targets.
9. Configure CI matrix for Windows and Linux, including process cleanup tests.
10. Add packaging script for the selected distribution format and document the alternative if deferred.
11. Write runbooks referenced by `observability.md` alerts or create documented placeholders with operator actions.
12. Update README/operator docs for install, config, EULA note, validation, read-only mode, telemetry opt-in, and troubleshooting.
13. Perform final traceability sweep from `traceability.md` and close open questions.

## Data And Deployment Notes

- Release packaging must not change local storage locations without an LLD revision.
- Performance tests can run outside normal PR checks if marked as weekly/manual, but release evidence must include results.
- Rollback for packaging changes is reverting release scripts/artifacts; no runtime data migration is introduced here.

## Tests And Verification

- Unit tests: no new unit-only requirement unless hardening uncovers gaps.
- Integration tests: all previous phase integration tests pass on Windows and Linux where applicable.
- Contract tests: all OpenAPI surfaces still validate.
- End-to-end or smoke tests: all 5 LLD E2E journeys pass.
- Manual checks: release artifact starts, validates config, and exits cleanly.
- Commands: `bun test`; `bun run check`; packaging command added in this phase; performance command added in this phase.

## Observability And Operations

- Metrics names match `observability.md` and alert/runbook references are documented.
- Dashboard guidance is documented, not implemented in-process.
- Crash reports, logs, telemetry opt-in, and redaction are covered in release docs.

## Acceptance Criteria

- All LLD must-not-break scenarios have automated or documented verification evidence.
- Windows and Linux CI pass, including process cleanup tests.
- Performance scripts produce evidence for hot-reload, log ingestion, and memory targets.
- Release packaging is reproducible.
- Operator documentation explains install, config validation, read-only mode, telemetry opt-in, and troubleshooting.

## Review Packet

- Expected files or modules touched: CI config, performance/e2e tests, packaging scripts, README/docs, runbooks.
- LLD sections reviewers should compare against: `tests.md`, `observability.md` Alerts, HLD `06-deployment.md`, ADR-LLD-002 mitigations.
- Expected evidence: CI matrix output, E2E output, performance report, packaged artifact smoke output, docs diff.

## Risks And Questions

- Performance tests may be too slow for per-PR CI. If so, mark them weekly/manual but require latest output before release.
- Bun compile behavior for OpenTUI and native Windows cleanup must be validated on actual target platforms.
