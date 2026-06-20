# Migration Plan — TUI & CLI Process

> **Implements HLD ADR**: ADR-002 (SQLite WAL for sessions), ADR-007 (audit
> logging).

This is a **greenfield** migration. The `data/sessions.db` file does not
exist on first launch; the manager creates it. There is no prior schema to
migrate from.

---

## Migration list

### M-001: Create `data/sessions.db` with WAL mode + engine-lib session schema

- **Type**: greenfield
- **Risk**: low
- **Owned by**: `engine-lib/session-stores` `createSqliteSessionStore` +
  `forge/data/dialects/sqlite`
- **Algorithm** (logical, not DDL):
  1. Open `data/sessions.db` via `forge/data/dialects/sqlite` driver.
  2. Issue `PRAGMA journal_mode=WAL;` (satisfies NFR-REL-004 / FR-SES-002).
  3. Issue `PRAGMA foreign_keys=ON;`.
  4. Run the engine-lib session-store migration (v3 schema) — creates
     `sessions` + `session_messages` tables with the indexes listed in
     `data-model.md`.
  5. Run `forgeDataAuditLog({db, table: 'audit_entries'}).migrate()` —
     creates `audit_entries` table with the columns and indexes listed in
     `data-model.md`. If `tamperEvident: true` is configured, also adds
     `previousHash` and `hash` columns.
  6. Create `pruning_state` table (host-owned DDL, executed via
     `forge/data` `db.execute(...)`).
- **Estimated time**: < 100 ms on a local SSD.
- **Rollback**: delete `data/sessions.db`, `data/sessions.db-wal`,
  `data/sessions.db-shm`. Safe — no data was present before.
- **Cutover**: none. The manager creates the DB on first launch.

### M-002: Create `data/pids.json` (empty)

- **Type**: greenfield
- **Risk**: low
- **Owned by**: Lock & Lockout Service (host code)
- **Algorithm**: `Bun.write('data/pids.json', '{}')` if the file does not
  exist. Do NOT overwrite if it exists (may contain stale PIDs from a
  previous crash — those are processed by the stale-PID cleanup step, not
  the migration).
- **Estimated time**: < 1 ms.
- **Rollback**: delete `data/pids.json`.
- **Cutover**: none.

### M-003: Create `logs/` directory

- **Type**: greenfield
- **Risk**: low
- **Owned by**: `forge/telemetry` `stdout` exporter (configured with
  `logs/explorers-cli.log` path)
- **Algorithm**: `fs.mkdir('logs', { recursive: true })` at boot before
  `initTelemetry` is called.
- **Estimated time**: < 1 ms.
- **Rollback**: delete the directory.
- **Cutover**: none.

### M-004: Create `data/explorers.lock`

- **Type**: greenfield
- **Risk**: low
- **Owned by**: Lock & Lockout Service (host code)
- **Algorithm**: open the file with `O_CREAT` and acquire an exclusive lock
  via `flock(LOCK_EX)` (POSIX) or `LockFileEx` (Windows). If the lock is
  held, exit with a clear error message (FR-SRV-020 / AC-035).
- **Estimated time**: < 1 ms.
- **Rollback**: release the lock and delete the file.
- **Cutover**: none.

---

## Migration ordering

All four migrations run at boot, in this order:

1. **M-004** (`explorers.lock`) — first, because if another instance is
   already running, we must exit before touching any other file.
2. **M-002** (`pids.json`) — second, because the stale-PID cleanup must run
   before we spawn new servers (and before we open the DB, to avoid
   locking conflicts if a previous instance died mid-write).
3. **M-001** (`sessions.db`) — third, opens the DB and runs engine-lib +
   audit + pruning_state migrations.
4. **M-003** (`logs/`) — last, because telemetry is the first component to
   start in `forge/lifecycle`'s boot order, but it needs the directory to
   exist. (Alternative: have `forge/telemetry` create the directory itself;
   the LLD prefers explicit creation by the host to make the dependency
   visible.)

Dependencies: M-004 → M-002 → M-001 → M-003. Strictly sequential.

---

## Backfill strategy

N/A — greenfield. No existing data to backfill.

---

## Rollback strategy

For a full rollback (e.g. operator wants to wipe state and start over):

1. Stop the manager (`/stop` all servers, then `Ctrl+C`).
2. Delete `data/sessions.db`, `data/sessions.db-wal`, `data/sessions.db-shm`.
3. Delete `data/pids.json`.
4. Optionally delete `logs/explorers-cli.log*`; audit entries live in `data/sessions.db`.
5. Release `data/explorers.lock` (deleting the file is not enough — the OS
   lock must be released by the process holding it; if the process is dead,
   the OS releases automatically).
6. Restart the manager. All four migrations re-run greenfield.

**Data loss**: total. All session history, audit history, and PID state are
destroyed. This is the operator's "factory reset" path.

---

## Cutover plan

N/A — greenfield. No coordinated deploy needed.

---

## Future migrations (out of scope for v1)

The following migrations are anticipated but deferred to follow-up LLDs:

- **M-101: Add `previousHash` + `hash` to `audit_entries`** — if the operator
  enables `tamperEvident: true` after initial deployment. Additive, nullable
  columns; backfill computes hashes for existing rows. Low risk.
- **M-102: Schema v2 for sessions** — if engine-lib ships a v4 session
  schema. engine-lib's `migrateSessionStore` handles this; the LLD just
  bumps the dependency version.
- **M-103: Add `crash_reports` table** — if the operator wants crash reports
  in the DB instead of (or in addition to) `crash-<timestamp>.json` files.
  Additive. Low risk.

Each future migration will get its own entry in this file when scoped.
