# Review Checklist - TUI & CLI Process Implementation

## Per-Phase Checklist

Use this checklist for every implementation PR tied to a phase card.

- The PR states the phase ID and links to the phase card.
- The PR scope matches the phase goal and does not implement deferred phase behavior.
- Every changed behavior cites the LLD source named in the phase card.
- Tests cover happy path, documented error paths, and security/reliability branches touched by the phase.
- Contract-shaped responses validate against `docs/lld/tui-cli-process/openapi.yaml` where applicable.
- Error codes come from `docs/lld/tui-cli-process/errors.md` and are not renamed.
- Idempotency behavior is included for mutating operator commands touched by the phase.
- Observability is included with the behavior: logs, metrics, traces, audit rows, and redaction as applicable.
- Security-sensitive behavior fails closed.
- Rollback or remediation is documented for any data, process, or deployment change.
- The repo is buildable and tests pass after the phase.

## Cross-Phase Consistency Checks

- Forge and engine-lib primitives are used before adding host-owned infrastructure.
- No inbound HTTP server is introduced for OpenAPI contract tests.
- `--read-only` enforcement remains centralized in the command router.
- `--validate-config` exits before TUI, Java, DB, LLM, or mutable filesystem side effects.
- SQLite session access goes through engine-lib session-store abstractions.
- Tool sandboxing uses engine-lib tool packs and policy composition instead of hand-rolled path or command enforcement.
- Player and prompt content is not logged at INFO level and is redacted or digested for telemetry/audit.
- A valid hot-reload cannot remove or mutate process-affecting fields for running servers without pending-restart semantics.
- Process cleanup paths do not kill unrelated processes when PIDs are reused.
- Tests do not rely on shared temp state between runs.

## Required Verification Evidence

| Evidence | Required when |
| -------- | ------------- |
| `bun test` output | Every phase after PHASE-001 adds the test script. |
| TypeScript strict check output | Every phase after PHASE-001 adds the check script. |
| Contract validation output | Any phase changing command, parser, session, tellraw, or tool response shapes. |
| Migration output or DB inspection | PHASE-002 and later phases changing persistence. |
| Process cleanup evidence | PHASE-004 and PHASE-010. |
| Log/metric/audit sample | Any phase adding instrumented behavior. |
| TUI screenshot or terminal capture | Any phase changing visible TUI state. |
| Security negative test output | Any phase touching permissions, sandboxing, secrets, paths, commands, or read-only mode. |
| Performance/load output | PHASE-010 or any earlier phase claiming an NFR-PERF target. |

## Phase-Specific Gates

| Phase | Gate |
| ----- | ---- |
| PHASE-001 | Scripts, config validation, telemetry baseline, and crash redaction are in place before feature PRs. |
| PHASE-002 | Greenfield migrations run in LLD order and are safe to rerun. |
| PHASE-003 | Every router command is classified as mutating or non-mutating. |
| PHASE-004 | No orphan child process remains after tests, including failure and timeout paths. |
| PHASE-005 | Invalid hot-reload retains last-known-good config and surfaces a TUI warning. |
| PHASE-006 | Unauthorized and rate-limited mentions are silently ignored for players but audited for operators. |
| PHASE-007 | Provider timeouts persist partial response per LLD and map to stable error codes. |
| PHASE-008 | `/tellraw` chunks are <= 200 characters and fallback behavior is audited. |
| PHASE-009 | Command and filesystem tools fail closed on deny cases and return ToolFailure instead of throwing for domain failures. |
| PHASE-010 | Windows and Linux cleanup evidence, performance profile, and release packaging evidence are attached. |

## Definition Of Done

- All phase cards are implemented or explicitly superseded by an approved plan revision.
- Every implementation unit in `phase-plan.md` is complete or marked out of scope with an LLD-backed reason.
- Every applicable FR/NFR group in `traceability.md` has passing verification evidence.
- No open design blocker remains hidden in code comments or PR notes.
- Release artifacts, runbooks, and operator docs reflect the shipped behavior.
