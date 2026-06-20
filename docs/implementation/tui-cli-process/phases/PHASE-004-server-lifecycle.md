# PHASE-004 - Server Lifecycle

**Status**: Planned  
**Goal**: Implement safe Minecraft child-process lifecycle for `/start`, `/stop`, `/restart`, crash detection, and PID cleanup.  
**Depends on**: PHASE-002, PHASE-003  
**LLD sources**: `design.md` Algorithm 2; `sequences.md` sections 1 and 2; `errors.md` server lifecycle codes; `migration-plan.md` M-002/M-004; ADR-LLD-002; `tests.md` Reliability scenarios  
**Review findings addressed**: OQ-005

## Scope

- `/start`, `/stop`, and `/restart` handlers behind the command router.
- Server path, jar, Java executable, and port validation.
- `Bun.spawn` child creation, stdout/stderr handles, startup timeout, `Done!` detection, and PID recording.
- POSIX process group cleanup and Windows Job Object or approved fallback integration.
- Non-zero exit, stdin close, crash state, PID deletion, audit events, and TUI state updates.

## Out Of Scope

- Full bounded log ring buffer and scrollback UX; PHASE-005.
- Chat parsing; PHASE-006.
- Agent execution; PHASE-007 and PHASE-008.
- Tool `run_command`; PHASE-009.

## Implementation Units

| Unit ID | Type        | Summary                                                                                                     | Source                   | Risk |
| ------- | ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ | ---- |
| IU-015  | flow        | Implement server start validation, `Bun.spawn`, timeout, PID record, and `Done!` transition.                | `design.md` Algorithm 2  | High |
| IU-016  | reliability | Implement stop/restart and process-tree cleanup for POSIX and Windows.                                      | ADR-LLD-002              | High |
| IU-017  | reliability | Detect child exit, stdin close, crash status, PID deletion, audit events, and TUI updates within 2 seconds. | `sequences.md` section 2 | High |
| IU-037  | delivery    | Add cross-platform cleanup evidence planning for Windows/Linux CI.                                          | ADR-LLD-002 mitigations  | High |
| IU-034  | test        | Cover lifecycle commands and failure cases.                                                                 | `tests.md` Key scenarios | High |

## Work Items

1. Implement server runtime registry and state transitions for STOPPED, STARTING, RUNNING, STOPPING, and FAILED.
2. Implement canonical path and jar containment checks with `PATH_TRAVERSAL_BLOCKED`, `JAR_NOT_FOUND`, and `JAVA_NOT_FOUND` mapping.
3. Implement TCP bind port availability check with `PORT_CONFLICT` mapping.
4. Spawn Java with the LLD command shape and record PID immediately after successful spawn.
5. Attach stdout enough to detect the `Done!` startup line and signal Log Reader attachment for PHASE-005.
6. Implement startup timeout and force-kill behavior with `STARTUP_TIMEOUT` mapping.
7. Implement graceful `/stop`, forced stop, and `/restart` as sequential stop then start with idempotency keys from PHASE-003.
8. Implement POSIX negative-PID group termination and Windows Job Object/native fallback decision from ADR-LLD-002.
9. Implement stale PID recovery using command-line verification before kill.
10. Emit lifecycle audit entries, metrics, logs, and TUI state updates.
11. Add integration tests using stub child processes that print `Done!`, hang, crash, close stdin, and ignore stop.

## Data And Deployment Notes

- PID registry writes must happen before the startup timer so crash recovery can find children.
- Do not kill a PID from `pids.json` unless command-line verification confirms it is the expected Java/JAR process.
- Rollback requires stopping all managed child processes and clearing stale temp test PID files.

## Tests And Verification

- Unit tests: validation error mapping, state transitions, restart phase idempotency.
- Integration tests: stub spawn happy path, port conflict, missing jar, startup timeout, graceful stop, force kill, crash, stdin close, stale PID reused skip.
- Contract tests: `/start`, `/stop`, `/restart` success and error responses validate against OpenAPI.
- End-to-end or smoke tests: start a stub server, reach RUNNING, stop it, verify no child remains.
- Manual checks: process table inspection after forced stop and manager shutdown.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Metrics: server state gauge, start/stop counters, crash counter, start duration histogram.
- Logs: `server_started`, `server_crashed`, `server_stdin_closed` fields from `observability.md`.
- Audit: start, stop, restart, crash, PID stale/reused decisions.

## Acceptance Criteria

- `/start` reaches STARTING then RUNNING when the stub emits `Done!`.
- `/stop` sends `/stop`, waits, and force-kills after timeout.
- `/restart` composes stop then start and handles phase failure safely.
- A crashing child transitions to FAILED and removes its PID entry within 2 seconds.
- Cleanup tests leave no child process behind.
- Windows cleanup strategy is explicitly selected and reviewed before completion.

## Review Packet

- Expected files or modules touched: process manager, PID recovery, platform cleanup modules, router handlers, lifecycle tests, TUI state binding.
- LLD sections reviewers should compare against: `design.md` Algorithm 2, ADR-LLD-002, `sequences.md` sections 1 and 2, `errors.md` lifecycle rows.
- Expected evidence: lifecycle test output, process table cleanup proof, PID registry before/after sample, audit/log sample.

## Risks And Questions

- OQ-005: decide native addon versus `ffi-napi` for Windows Job Objects.
- Stub child tests must avoid platform-specific shell assumptions; use Bun scripts where possible.
