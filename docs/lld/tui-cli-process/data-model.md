# Data Model — TUI & CLI Process

> **Implements HLD**: `docs/hld/04-data-model.md` (conceptual ER).
> **Implements HLD ADRs**: ADR-002 (SQLite WAL for sessions), ADR-003
> (`data/pids.json` PID registry), ADR-008 (`config.yaml` schema).

This is the **logical** data model. Types are SQL-flavored lingua franca
(`uuid`, `varchar(N)`, `text`, `int`, `bigint`, `numeric(p,s)`, `timestamptz`,
`jsonb`, `boolean`). No vendor DDL — `CREATE TABLE` statements are forbidden
in the LLD (see `references/data-design.md`).

The container owns four data shapes:

1. **`data/sessions.db`** — SQLite WAL, the only persistent DB. Owned via
   `engine-lib/session-stores`'s `createSqliteSessionStore` (which delegates
   to `forge/data/dialects/sqlite`). **The LLD does NOT define a custom
   session table** — engine-lib's store already creates and migrates the
   v3 schema including indexes on `(serverId, agentId)`, `(timestamp)`, and
   `(sessionId)`. The LLD defines only the additional host-owned tables that
   engine-lib does not provide: `audit_entries` and `pruning_state`.
2. **`config.yaml`** — in-memory after load (via `forge/config`'s
   `defineDynamicConfig` + a YAML source adapter). Not a DB table.
3. **`data/pids.json`** — flat JSON file, atomically rewritten on each
   change. Owned by the Lock & Lockout Service.
4. **`data/explorers.lock`** — exclusive OS lock file. No content; presence +
   lock handle are the state.

---

## ER diagram

```mermaid
erDiagram
    sessions ||--o{ session_messages : "has messages (engine-lib owned)"
    sessions }o--|| servers : "scoped to (serverId, agentId)"
    sessions }o--|| agents : "scoped to (serverId, agentId)"

    audit_entries ||--|| servers : "references serverId"
    audit_entries ||--|| agents : "references agentId"
    audit_entries }o--o|| players : "references playerName"

    pruning_state ||--|| sessions : "tracks last prune per session"

    servers {
        varchar id PK "^[a-zA-Z0-9_-]{1,32}$"
        varchar name UK "Unique across active config"
        text path "Canonicalized absolute path"
        varchar jarFile "Relative to path"
        int ram "512..32768 MB"
        text javaPath "Absolute executable path"
        int serverPort "1024..65535"
        int maxPlayers "1..100"
        int startupTimeout "30..600 s"
    }

    agents {
        varchar id PK "^[a-zA-Z0-9_-]{1,32}$"
        varchar alias UK "^[a-zA-Z0-9_-]{2,}$"
        varchar provider "References provider.name"
        text systemPrompt "Persona instruction"
        jsonb tools "Tool capability flags"
        jsonb commandAllowlist "Prefix token patterns"
        int timeout "Default 120 s"
        int rpm "Rate limit"
        int cooldown "Rate limit (s)"
        int ingameMessageWindow "Context line count"
    }

    players {
        varchar name PK "Case-insensitive vanilla name"
        varchar serverId FK "References servers.id"
        varchar teamPrefix "Stripped prefix"
        varchar teamSuffix "Stripped suffix"
        boolean inGameAdmin "Elevated admin flag"
        jsonb agents "Agent IDs allowed for this player"
    }

    sessions {
        varchar sessionId PK "engine-lib owned (serverId:agentId:timestamp-rand)"
        varchar serverId FK "References servers.id"
        varchar agentId FK "References agents.id"
        varchar tenantId "engine-lib claim: same as serverId"
        timestamptz createdAt "engine-lib owned"
        timestamptz updatedAt "engine-lib owned"
        int version "engine-lib owned (CAS)"
    }

    session_messages {
        bigint rowid PK "engine-lib owned (SQLite autoincrement)"
        varchar sessionId FK "engine-lib owned"
        varchar role "user | assistant | system | tool"
        text content "Verbatim message text"
        timestamptz timestamp "engine-lib owned"
        jsonb playerContext "{ playerName, ... }"
    }

    audit_entries {
        uuid id PK "gen_random_uuid()"
        timestamptz occurredAt "NOT NULL, default now()"
        varchar serverId FK "References servers.id (or 'system')"
        varchar agentId FK "References agents.id (or 'system')"
        varchar playerName "Vanilla name or 'operator'"
        varchar actionType "command_exec | file_read | file_write | mention_authorized | mention_denied | tellraw_sent | say_fallback | tellraw_skipped | start | stop | restart | hot_reload | crash | provider_timeout | stdin_closed"
        varchar target "Command text, file path, or mention line"
        varchar outcome "ok | blocked | failed"
        text detail "Redacted free-text (secrets scrubbed)"
        varchar argumentsDigest "FNV-1a hash of structured args (no raw args)"
    }

    pruning_state {
        varchar sessionId PK "References sessions.sessionId"
        timestamptz lastPrunedAt "Last time pruning ran for this session"
        int messageCountAtPrune "Count at last prune (for rate limiting)"
    }
```

---

## Per-table description

### `sessions` (engine-lib owned — included for context only)

The session metadata table. Created and migrated by
`engine-lib/session-stores`'s `createSqliteSessionStore`. The host code does
NOT write to it directly; the `Session` handle from `createSession({id, store})`
abstracts it.

| Column      | Type        | Constraints                         | Notes                                                                                      |
| ----------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `sessionId` | varchar     | PK                                  | Composite key `serverId:agentId:<timestamp>-<randomSuffix>` per ADR-LLD-004 and FR-SES-006 |
| `serverId`  | varchar     | FK → servers.id (logical), NOT NULL | engine-lib uses this as the `tenantId` for tenant scoping                                  |
| `agentId`   | varchar     | NOT NULL                            |                                                                                            |
| `tenantId`  | varchar     | NOT NULL                            | engine-lib tenant claim; equals `serverId`                                                 |
| `createdAt` | timestamptz | NOT NULL, default `now()`           | engine-lib owned                                                                           |
| `updatedAt` | timestamptz | NOT NULL                            | engine-lib owned; updated on every append                                                  |
| `version`   | int         | NOT NULL, default 1                 | engine-lib CAS counter (opt-in via `appendIfVersion`)                                      |

**Indexes** (engine-lib owned, satisfy NFR-PERF-006):

- `idx_sessions_server_agent` on `(serverId, agentId)` — for context fetch by composite key
- `idx_sessions_timestamp` on `(createdAt)` — for pruning scans
- `idx_sessions_sessionId` on `(sessionId)` — for `/resume` lookups

**Volume estimate**: ≤ 50 sessions active (10 servers × 5 agents). Retained
indefinitely; rows pruned when their messages exceed retention.

**Access patterns**:

- Lookup by `sessionId` (primary key) — 95% of reads (engine-lib `SessionStore.load`)
- List by `(serverId, agentId)` — `/session` operator command
- List by `createdAt` ordered — pruning scan

**Soft-delete**: no. Sessions are hard-pruned via `DELETE` when their oldest
message exceeds `EXPLORERS_CLI_SESSION_RETENTION` (default 30 d).

### `session_messages` (engine-lib owned — included for context only)

The message rows. Each row is one `Message` from the engine-lib
`messages` module. engine-lib's store appends rows via
`SessionStore.append(id, messages)`.

| Column          | Type        | Constraints                                                | Notes                                                                                                                                                                         |
| --------------- | ----------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rowid`         | bigint      | PK, autoincrement                                          | SQLite implicit PK                                                                                                                                                            |
| `sessionId`     | varchar     | FK → sessions.sessionId, NOT NULL                          | Indexed                                                                                                                                                                       |
| `role`          | varchar     | NOT NULL, CHECK in (`user`, `assistant`, `system`, `tool`) |                                                                                                                                                                               |
| `content`       | text        | NOT NULL                                                   | Verbatim message text; tool results are JSON-serialized                                                                                                                       |
| `timestamp`     | timestamptz | NOT NULL, default `now()`                                  | engine-lib owned                                                                                                                                                              |
| `playerContext` | jsonb       | NOT NULL, default `{}`                                     | Extensible object per FR-SES-007/008. For `user` rows, includes `{playerName}` where playerName is the vanilla name or `operator`; assistant/system/tool rows may store `{}`. |

**Indexes** (engine-lib owned, satisfy NFR-PERF-006):

- `idx_session_messages_session_ts` on `(sessionId, timestamp DESC)` — for
  "fetch last N messages in this session" (FR-SES-004)
- `idx_session_messages_timestamp` on `(timestamp)` — for retention pruning

**Volume estimate**: up to 10,000 messages per session before pruning
(NFR-CAP-002). With 50 sessions, max ~500,000 rows.

**Access patterns**:

- Append (write) — every chat turn
- Fetch last N by `(sessionId, timestamp DESC)` — every agent invocation
  (FR-CHAT-011 / `ingameMessageWindow`)
- Range scan by `timestamp` for pruning

**Soft-delete**: no. Rows are hard-deleted by the pruning job.

### `audit_entries` (host-owned)

Append-only audit trail. Written by the `engine-lib/governance`
`auditSubscriber` (which subscribes to the `EventHub` and maps `RunEvent`s to
`AuditEntry`s). The table is created by `forgeDataAuditLog({db, table:
'audit_entries'}).migrate()` at boot.

| Column            | Type        | Constraints                                                                                                                                                                                                                                      | Notes                                                                                            |
| ----------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `id`              | uuid        | PK, default `gen_random_uuid()`                                                                                                                                                                                                                  |                                                                                                  |
| `occurredAt`      | timestamptz | NOT NULL, default `now()`                                                                                                                                                                                                                        |                                                                                                  |
| `serverId`        | varchar     | NOT NULL                                                                                                                                                                                                                                         | `'system'` for manager-level events (boot, hot-reload, crash)                                    |
| `agentId`         | varchar     | NOT NULL                                                                                                                                                                                                                                         | `'system'` for non-agent events                                                                  |
| `playerName`      | varchar     | NULL                                                                                                                                                                                                                                             | Vanilla name for in-game triggers; `'operator'` for operator actions; NULL for system events     |
| `actionType`      | varchar     | NOT NULL, CHECK in (`command_exec`, `file_read`, `file_write`, `mention_authorized`, `mention_denied`, `tellraw_sent`, `say_fallback`, `tellraw_skipped`, `start`, `stop`, `restart`, `hot_reload`, `crash`, `provider_timeout`, `stdin_closed`) |                                                                                                  |
| `target`          | varchar     | NOT NULL                                                                                                                                                                                                                                         | Command text, file path, or mention line. Redacted by `redactTextForPersistence` before storage. |
| `outcome`         | varchar     | NOT NULL, CHECK in (`ok`, `blocked`, `failed`)                                                                                                                                                                                                   |                                                                                                  |
| `detail`          | text        | NULL                                                                                                                                                                                                                                             | Redacted free-text context                                                                       |
| `argumentsDigest` | varchar     | NULL                                                                                                                                                                                                                                             | FNV-1a hash of structured args (no raw args persisted)                                           |

**Indexes**:

- `idx_audit_entries_occurredAt` on `(occurredAt DESC)` — for "show recent
  audit events" in the TUI audit panel
- `idx_audit_entries_server_agent` on `(serverId, agentId, occurredAt DESC)`
  — for "show audit history for this server+agent"
- `idx_audit_entries_player` on `(playerName, occurredAt DESC)` WHERE
  `playerName IS NOT NULL` — partial index for "show what a specific player
  did"

**Volume estimate**: ~1 row per agent tool call + ~1 row per mention + ~1
row per server lifecycle event. At peak (10 servers, 5 agents each, 1 tool
call per minute per agent), ~50 rows/min = ~72,000 rows/day. Retained
indefinitely; operator can manually truncate.

**Access patterns**:

- Append (write) — every audit-worthy event
- Range scan by `occurredAt DESC LIMIT N` — TUI audit panel
- Range scan by `(serverId, agentId, occurredAt DESC)` — per-server drill-down

**Soft-delete**: no. Audit entries are never deleted (tamper-evident chain
via `engine-lib/governance`'s `forgeDataAuditLog` — `hashAuditEvent` is
optional; if enabled, the `previousHash`/`hash` columns are added by the
migrator).

### `pruning_state` (host-owned)

Tracks the last pruning pass per session, so the 24-hour prune job
(ADR-002 mitigation) doesn't re-scan the full table.

| Column                | Type        | Constraints                                     | Notes                                                   |
| --------------------- | ----------- | ----------------------------------------------- | ------------------------------------------------------- |
| `sessionId`           | varchar     | PK, FK → sessions.sessionId (ON DELETE CASCADE) |                                                         |
| `lastPrunedAt`        | timestamptz | NOT NULL, default `now()`                       |                                                         |
| `messageCountAtPrune` | int         | NOT NULL                                        | For rate-limiting future prunes if the session is quiet |

**Indexes**: PK only (the table is small — ≤ 50 rows).

**Volume estimate**: one row per active session (≤ 50).

**Access patterns**:

- Upsert by `sessionId` — at the end of each pruning pass
- Range scan `WHERE lastPrunedAt < now() - 24h` — to find sessions needing a prune

---

## In-memory shapes (not persisted)

### `config.yaml` → `RuntimeConfig`

The full schema is in SRS §6.1. The `forge/config` `t.*` builder mirrors it.
Loaded at boot via `defineConfig`; hot-reloaded via `defineDynamicConfig` +
`pollingProvider`. The resolved shape is:

```
RuntimeConfig = {
  schemaVersion?: number (default 1, FR-CFG-010)
  servers: Record<ServerId, ServerConfig>    // max 10 (FR-CFG-001/002)
  agents:  Record<AgentId, AgentConfig>
  providers: Record<ProviderName, ProviderConfig>
  permissions: Record<ServerId, { players: PlayerConfig[] }>
  featureFlags: { audioplayer?: boolean }     // default false; hides music UI when false
  telemetry: { enabled: boolean, endpoint?: string }
  logging: { level: 'info'|'debug'|'trace', rotationBytes: number }
  sessionRetention: string (ISO 8601 duration, default 'P30D')
}
```

**Lifecycle**: parsed at boot, atomically swapped on valid hot-reload,
retained when invalid (ADR-008). Never written by the manager; the operator
owns the file.

### `data/pids.json` → `PidRegistry`

```json
{
  "survival": 4242,
  "creative": 4243
}
```

| Field        | Type | Notes                                   |
| ------------ | ---- | --------------------------------------- |
| `<serverId>` | int  | OS process ID of the spawned Java child |

**Lifecycle**: atomically rewritten (write-to-temp + rename) on every spawn
and every stop. On boot, the Lock & Lockout Service reads this file and
kills stale PIDs before the rest of the manager starts (NFR-REL-002).

**Access patterns**:

- Read at boot — stale-PID cleanup
- Read on `forceKillChildTree` — emergency fallback
- Write on `Bun.spawn` success — record PID immediately (NFR-REL-003)
- Delete on child exit — cleanup

### `RuntimeServerState` (in-memory, not persisted)

The runtime state of a single server. Per SRS §6.2.

| Field                 | Type                | Notes                                                          |
| --------------------- | ------------------- | -------------------------------------------------------------- |
| `serverId`            | ServerId            | Primary key                                                    |
| `status`              | enum                | `STOPPED`/`STARTING`/`RUNNING`/`STOPPING`/`FAILED`             |
| `pid`                 | int \| null         | OS process ID; null when `STOPPED` or `FAILED`                 |
| `startTime`           | timestamptz \| null | Set when transition `STARTING → RUNNING`                       |
| `lastSuccessfulStart` | timestamptz \| null | Most recent `STARTING → RUNNING` transition; survives restarts |
| `restartCount`        | int                 | Increments on each `/restart` invocation                       |
| `lastError`           | string \| null      | Cleared on successful restart (FR-SRV-016)                     |

**Lifecycle**: Held in-memory by the Server Process Manager. Not persisted;
the PID registry captures the recovery pointer, and per-server runtime state
is reconstructed at boot. Reset to `STOPPED` with `pid: null` at boot.

### `data/explorers.lock`

Empty file; the OS lock handle is the state. Acquired at boot via `flock`
(POSIX) or `LockFileEx` (Windows). Released on shutdown. If acquisition
fails, the manager exits with a clear error message (FR-SRV-020 / AC-035).

---

## Cross-cutting notes

- **All timestamps** are `timestamptz` (UTC storage). No `timestamp without
time zone` — that's a footgun.
- **All UUIDs** use `gen_random_uuid()` (SQLite's `lower(hex(randomblob(16)))`
  equivalent — the dialect driver handles this).
- **All string IDs** (`serverId`, `agentId`, `providerName`) match
  `^[a-zA-Z0-9_-]{1,32}$` (FR-CFG-005). Enforced at config validation time,
  not via DB CHECK (the DB only stores already-validated config).
- **No money types** — this is a Minecraft server manager, not an e-commerce
  app. No floats anywhere.
- **`jsonb` usage**: only for genuinely semi-structured fields (`tools`,
  `commandAllowlist`, `agents` on `players`). If a field appears in a WHERE
  clause, it's a column.
- **WAL mode**: applied by the `forge/data/dialects/sqlite` driver on
  connection open via `PRAGMA journal_mode=WAL;`. The LLD does not issue
  this pragma directly.
- **Retention**: sessions pruned at 30 d (configurable via
  `EXPLORERS_CLI_SESSION_RETENTION`). Audit entries retained indefinitely.
- **Backup**: the operator is responsible for backing up `data/sessions.db`.
  The manager does not ship a backup mechanism in v1.
