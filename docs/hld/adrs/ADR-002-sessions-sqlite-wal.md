# ADR-002: Use SQLite in WAL Mode for Session Persistence

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: data, persistence, concurrency

## Context

The system must persist agent session histories across restarts and crashes (FR-SES-001). Under active multiplayer conditions, multiple players can trigger agent aliases concurrently on the same server thread.
If multiple async threads attempt to write text logs to a single shared file at the same millisecond, file write collisions, corruptions, or blocking lock conditions can occur (AC-022).
The persistent storage engine must reside locally (NFR-PRV-001), have a small memory foot-print, and support fast indexing by server ID, agent ID, and timestamps.

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `FR-SES-001` — Persist agent sessions in SQLite at `data/sessions.db`.
- `FR-SES-002` — Prevent corruption during concurrent writes using WAL mode.
- `NFR-REL-004` — SQLite persistence in WAL mode for database durability.
- `NFR-PRV-001` — Storing player data locally to guarantee privacy.
- `NFR-PERF-006` — Session DB indexes on `(serverId, agentId)`, `(timestamp)`, and `(sessionId)`.
- `NFR-CAP-002` — Session support for up to 10,000 messages before archival/pruning.
- `C-01` — Execution on the Bun runtime environment.

## Options considered

### Option 1: File-Based JSONL (JSON Lines) Logs

Record each chat row as a separate line inside a flat text file (e.g. `sessions.jsonl`).

- **Pros**:
  - Human-readable, simple filesystem appends.
  - Zero database drivers required.
- **Cons**:
  - No built-in transaction isolation; simultaneous writes can result in interleaved characters or corruption.
  - Reading historical logs requires loading and parsing the entire file or scanning lines, which incurs O(N) performance overhead.
  - Keying indices by `serverId + agentId` requires complex memory maps.
- **Satisfies**: `NFR-PRV-001`
- **Tensions**: `FR-SES-002`, `NFR-REL-004`

### Option 2: SQLite File Database (Default Journaling Mode)

Store entries inside a standard local relational database utilizing traditional rollback journals.

- **Pros**:
  - Relational storage with SQL indexing on compound keys `(serverId, agentId)`.
  - Guarantees transactional ACID properties.
- **Cons**:
  - Reader/writer locking; a write operation locks the database file, blocking concurrent reads or other writes, which can crash during concurrent multiplayer mention storms.
- **Satisfies**: `FR-SES-001`, `NFR-PRV-001`
- **Tensions**: `FR-SES-002`

### Option 3: SQLite File Database in Write-Ahead Log (WAL) Mode

Store entries in SQLite with Write-Ahead Logging (WAL) enabled (`PRAGMA journal_mode=WAL;`).

- **Pros**:
  - Fully satisfies the customer/SRS specification (FR-SES-001 / FR-SES-002).
  - Highly concurrent; allows multiple readers and a writer to access the database file simultaneously without blocking.
  - Rapid append performance.
  - Relational indexing on compound keys `(serverId, agentId, timestamp)` keeps history lookups sub-millisecond.
- **Cons**:
  - Creates auxiliary files (`.db-wal` and `.db-shm`) on disk alongside `sessions.db` during operations.
- **Satisfies**: `FR-SES-001`, `FR-SES-002`, `NFR-REL-004`, `NFR-PRV-001`
- **Tensions**: None.

---

## Decision

We will use a local SQLite database file at `data/sessions.db` with Write-Ahead Log (WAL) mode enabled as the session persistence engine.

---

## Rationale

Option 3 satisfies all specified requirements, including the strict requirement for WAL mode configuration (`FR-SES-002`). Because C-01 mandates the Bun runtime, the implementation will use Bun's native `bun:sqlite` bindings rather than an external SQLite driver. This keeps the persistence layer aligned with the single-runtime distribution model and avoids external binary compilation blocks.
WAL mode decouples write locks from read locks: when the agent writes an output token stream to the database, in-game chat parser scans of other player mentions can read history entries simultaneously without block errors.

---

## Consequences

**Positive**:

- Concurrent writes from multiple player agents do not result in lock conflicts or schema corruptions.
- Structured relational queries enable simple session pruning based on time offsets (`sessionRetention`).
- Lookups by session compound keys are indexed.

**Negative**:

- The directory `data/` will contain transient `.db-wal` and `.db-shm` files during run.

**Neutral**:

- The SQLite file must be kept in local sandboxed workspace files to protect player message privacy.

---

## Mitigations for negative consequences

- **Transient WAL files** → Configure the SQLite connection pool to checkpoint and merge the WAL logs back into the main database file during application graceful shutdown or idle phases.
- **Database Size Growth** → Execute automated pruning SQL commands (`DELETE FROM sessions WHERE timestamp < ...`) at startup and on a 24-hour interval to purge stale logs.

---

## Links

- Related ADRs: None
- SRS sections: Section 4.8 (Session Requirements), Section 6.3 (Session Store Model)
- External references: [SQLite WAL Mode documentation](https://www.sqlite.org/wal.html)
