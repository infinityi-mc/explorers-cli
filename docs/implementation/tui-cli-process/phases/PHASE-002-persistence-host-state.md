# PHASE-002 - Persistence And Host State

**Status**: Planned  
**Goal**: Add deploy-safe local state for lock ownership, PID registry, SQLite sessions, audit, and pruning metadata.  
**Depends on**: PHASE-001  
**LLD sources**: `data-model.md`; `migration-plan.md`; `design.md` Lock & Lockout Service mapping; `observability.md` Persistence metrics; ADR-LLD-002; ADR-LLD-004  
**Review findings addressed**: None

## Scope

- `data/explorers.lock` acquisition and release.
- `data/pids.json` creation, atomic rewrite, and stale PID verification model.
- `data/sessions.db` opening through forge/engine-lib, WAL mode, engine-lib session migrations, audit table migration, and `pruning_state` migration.
- Pruning job metadata and persistence metrics.

## Out Of Scope

- Killing stale PIDs for real Java processes; PHASE-004 completes process-tree kill behavior.
- Server start/stop commands; PHASE-004.
- Session list/resume command UX; PHASE-003 and PHASE-007.
- Tool and mention audit events; PHASE-006 through PHASE-009.

## Implementation Units

| Unit ID | Type        | Summary                                                                                                       | Source                                     | Risk   |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| IU-006  | reliability | Acquire and release `data/explorers.lock` as the single-instance guard.                                       | `data-model.md`, `migration-plan.md` M-004 | High   |
| IU-007  | data        | Create and atomically maintain `data/pids.json`; model stale PID verification.                                | `data-model.md`, `migration-plan.md` M-002 | High   |
| IU-008  | data        | Open `data/sessions.db`, run engine-lib session schema, audit table migration, and `pruning_state` migration. | `migration-plan.md` M-001                  | Medium |
| IU-009  | data        | Add 24-hour session pruning state and metrics without pruning audit rows.                                     | `data-model.md` `pruning_state`            | Medium |
| IU-034  | test        | Cover migrations and filesystem state with isolated temp directories.                                         | `tests.md` Integration tests               | Medium |

## Work Items

1. Implement boot ordering so lock acquisition precedes PID, database, and log file state creation.
2. Implement single-instance lock acquisition with clear `LOCK_HELD` diagnostics and release on shutdown.
3. Implement `pids.json` create-if-missing, read, set, delete, and flush using write-to-temp plus rename.
4. Add stale-PID inspection interfaces that can verify command lines without killing unrelated processes; actual kill integration lands in PHASE-004.
5. Open `data/sessions.db` through the LLD-selected forge/engine-lib path and confirm WAL and foreign keys are applied by the dialect/store.
6. Run engine-lib session-store migration and `forgeDataAuditLog({db, table: 'audit_entries'}).migrate()`.
7. Create the host-owned `pruning_state` table via the forge data dialect.
8. Add the pruning scheduler seam, last-pruned tracking, and persistence metrics without deleting rows until session behavior is present.
9. Add integration tests that run migrations twice to prove idempotence.

## Data And Deployment Notes

- Migrations must run in LLD order: lock, PID registry, SQLite, logs.
- This is greenfield local state. Rollback during development can delete `data/sessions.db`, `data/sessions.db-wal`, `data/sessions.db-shm`, `data/pids.json`, and logs.
- Do not overwrite an existing `pids.json`; it may contain recovery state.

## Tests And Verification

- Unit tests: atomic PID registry writes, stale PID verification decisions, lock acquisition failure mapping.
- Integration tests: greenfield migrations in temp dirs, repeated migration idempotence, WAL/foreign key evidence, audit/pruning table existence.
- Contract tests: none unless router stubs expose state.
- End-to-end or smoke tests: boot and shutdown create expected files in a temp app home without spawning Java.
- Manual checks: inspect temp DB tables and `pids.json` after boot.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Emit persistence metrics for audit writes and pruning scheduler attempts when those code paths run.
- Log `LOCK_HELD`, `PID_STALE`, and `PID_REUSED` decisions with redacted details.
- Do not log raw config secrets or session message content.

## Acceptance Criteria

- A second manager instance cannot acquire the same lock and exits clearly.
- `pids.json` is created only when absent and atomically updated.
- SQLite opens in WAL mode with engine-lib session tables, `audit_entries`, and `pruning_state` available.
- Migration tests are isolated and can run repeatedly.
- No real process is killed by this phase.

## Review Packet

- Expected files or modules touched: persistence, lock, PID registry, migrations, lifecycle component registration, tests.
- LLD sections reviewers should compare against: `migration-plan.md` M-001 through M-004, `data-model.md` per-shape descriptions, ADR-LLD-002, ADR-LLD-004.
- Expected evidence: migration logs, DB inspection output, lock contention test output, PID registry atomic-write test output.

## Risks And Questions

- Filesystem locking APIs differ by platform; keep platform-specific code isolated.
- SQLite table names and migration APIs must be verified against actual engine-lib and forge exports before implementation starts.
