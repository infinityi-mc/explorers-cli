# ADR-LLD-004: Shared session key prefix `(serverId, agentId)` — multi-tenant by server

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: Engineering (LLD pass)
- **Tags**: data, sessions, multi-tenancy, engine-lib
- **Implements HLD ADR(s)**: ADR-002 (SQLite WAL for sessions)
- **Supersedes HLD ADR(s)**: none
- **Affects LLD files**: `data-model.md` (`sessions` table; tenantId column), `domain.md` (`Session` aggregate), `design.md` (Agent Executor row in capability mapping), `sequences.md` (§3 — shared session key), `idempotency.md` (per-session idempotency), `tests.md` (§Concurrency — same-session concurrent mentions)

## Context

The SRS (§6.3) and HLD (`04-data-model.md` "Shared Multi-Tenant Session
Key") specify that all players and the TUI operator share the **same**
session context window for a given `(serverId, agentId)` combination. This
acts as a "single-room group chat" — every authorized player who mentions
`@assistant` on the `survival` server joins the same conversation the
operator sees via `/chat assistant` on `survival`.

The alternative interpretations are:

1. **Per-player sessions** — each player has their own private conversation
   with each agent. The SRS explicitly rejects this (§6.3: "single-room
   group chat environment rather than private message silos").
2. **Per-server sessions** — one session per server, shared across all
   agents on that server. Rejected because different agents have different
   personas and instructions; mixing them in one context window would
   confuse the model.
3. **Per-(server, agent) sessions** — the SRS's chosen model. All players
   - the operator share one session per `(serverId, agentId)` pair.
4. **Per-(server, agent, player) sessions** — per-player private sessions
   (option 1 rephrased). Rejected by SRS.

`engine-lib/session`'s `Session` handle has a `tenantId` field and the
`SessionStore.claimTenant` atomic operation. engine-lib's multi-tenancy
model is designed for exactly this kind of "scoped conversation" pattern.

The LLD must decide:

- What is the `Session.id`? (The composite `serverId:agentId`, or a fresh
  UUID per session?)
- What is the `Session.tenantId`? (The `serverId`, to scope all sessions
  on a server together? Or `null`, because there's no per-tenant
  isolation requirement?)
- How does the `SessionStore` enforce the shared-key invariant (two
  players mentioning the same agent on the same server get the same
  session)?

## Requirements driving this decision

- `FR-SES-001` — Persist sessions in SQLite.
- `FR-SES-004` — Shared session key `(serverId, agentId)` (SRS §6.3, HLD
  `04-data-model.md` "Shared Multi-Tenant Session Key").
- `FR-CHAT-011` — Inject N preceding chat lines (the N lines come from
  the shared session).
- `NFR-PERF-006` — Indexes on `(serverId, agentId)`, `(timestamp)`,
  `(sessionId)`.
- `NFR-PRV-001` — Local-only storage (sessions stay in `data/sessions.db`).
- `NFR-CAP-002` — Up to 10,000 messages per session before pruning.

## Options considered

### Option 1: Per-player sessions (rejected by SRS)

Each player gets a private session per agent. The `Session.id` is a fresh
UUID per player.

**Pros**:

- Strongest privacy — players don't see each other's prompts.

**Cons**:

- Directly contradicts SRS §6.3 and HLD `04-data-model.md`.
- Defeats the "group chat" use case — players can't see what other players
  asked the agent.

**Satisfies**: `NFR-PRV-001`.
**Tensions**: `FR-SES-004`.

### Option 2: Session ID = fresh UUID, looked up by `(serverId, agentId)` index

Generate a fresh UUID for each new session, but look up the active session
by `(serverId, agentId)`. If none exists, create one; if one exists,
append to it.

**Pros**:

- Decouples the storage key (UUID) from the lookup key (composite).
- Allows future "fork" or "archive" semantics (a session can be archived
  and a new one started for the same `(serverId, agentId)` pair).

**Cons**:

- Requires an extra index and a lookup-before-append on every mention.
- The "active session" concept is implicit — the LLD has to define when
  a session becomes inactive (timeout? explicit `/clear`? never?).
- engine-lib's `Session` handle already has a `tenantId` field designed
  for exactly this scoping — using a fresh UUID ignores it.

**Satisfies**: `FR-SES-001`, `FR-SES-004` (via index), `NFR-PERF-006`.
**Tensions**: complexity (the "active session" concept).

### Option 3: Session ID = composite `serverId:agentId:<timestamp>-<randomSuffix>`, tenantId = serverId — chosen

Use the composite `serverId:agentId:<timestamp>-<randomSuffix>` as the
`Session.id` directly. The `serverId:agentId:` prefix preserves the shared
lookup key, and the timestamp+random suffix satisfies FR-SES-006. Set
`Session.tenantId = serverId` so engine-lib's `tenantScopedStore` (from
`engine-lib/session-stores`) can enforce that sessions on server A are
isolated from sessions on server B (defensive — a bug in the manager
shouldn't let server A's agent see server B's history).

The composite prefix is stable. The active session for a `(serverId, agentId)`
pair is the newest non-pruned session whose ID starts with that prefix. If the
operator wants to "reset" a session, they use `/clear`, which drops the
in-memory handle and causes the next run to create a new suffixed session ID.
Older persisted rows remain resumable by exact `sessionId`.

**Pros**:

- Direct implementation of SRS §6.3 and HLD `04-data-model.md`.
- The composite ID is the lookup key — no extra index needed beyond
  engine-lib's default `(serverId, agentId)` index.
- `tenantId = serverId` enables engine-lib's `tenantScopedStore` for
  defensive isolation.
- The `Session` handle is stable — `createSession({id:
'survival:assistant:1760704496123-a1b2c3', store})` returns the same handle
  (after LRU eviction, re-opens the same row).
- Forking (`Session.fork()`) creates a new session with a fresh UUID and
  a prefix of messages — useful for branching conversations without
  losing the original.

**Cons**:

- The composite ID is not a UUID — slightly unconventional. Mitigation:
  the format `^[a-zA-Z0-9_-]{1,32}:[a-zA-Z0-9_-]{1,32}:[0-9]{13}-[a-z0-9]{6}$`
  fits within engine-lib's `sessionId` string type and satisfies FR-SES-006.
- "Reset" semantics require `/clear` (in-memory) or pruning (persisted)
  — there's no "delete this session" operator command in v1. This is
  acceptable for v1 (the pruning job handles retention); a follow-up
  LLD may add `/delete-session`.

**Satisfies**: `FR-SES-001`, `FR-SES-004` (directly), `FR-SES-006`, `FR-CHAT-011`,
`NFR-PERF-006`, `NFR-PRV-001`, `NFR-CAP-002`.
**Tensions**: none.

## Decision

We adopt **Option 3**. The session key is the composite
`serverId:agentId:<timestamp>-<randomSuffix>`. The `serverId:agentId:` prefix
is the shared-session lookup key; the suffix satisfies FR-SES-006. The
`tenantId` is the `serverId` (enabling engine-lib's `tenantScopedStore` for
defensive cross-server isolation).

The `SessionStore` is created via `engine-lib/session-stores`'
`createSqliteSessionStore`, wrapped in `tenantScopedStore(store, serverId)`
per server (or, alternatively, the manager passes the `tenantId` on each
`createSession` call and relies on the store's `claimTenant` for atomic
first-use).

The `Session` handle is cached in an LRU (`Map<sessionId, Session>`,
capacity 100) to avoid re-opening the SQLite row on every mention. On
eviction, `session.flush()` is awaited.

`/clear` drops the in-memory handle but keeps the persisted rows. The next
run for that `(serverId, agentId)` creates a new suffixed session ID. `/resume
<sessionId>` reloads the exact history into the TUI without starting a new
run. The pruning job (every 24 h) deletes rows older than
`EXPLORERS_CLI_SESSION_RETENTION` (default 30 d).

## Rationale

Option 3 directly implements the SRS's "single-room group chat" model while
also conforming to FR-SES-006's timestamp+random-suffix requirement. The
composite prefix is the lookup key, and the active session is the newest
non-pruned row for that prefix. engine-lib's `tenantScopedStore` provides defensive
isolation between servers at the storage layer, so a bug in the manager
can't leak server A's history into server B's agent run.

The composite prefix is stable for the lifetime of the data, which keeps
lookup simple. Exact suffixed IDs remain stable for `/resume` and pruning.

`Session.fork()` (engine-lib built-in) covers the "branching conversation"
use case without needing a custom mechanism.

## Consequences

**Positive**:

- Direct SRS §6.3 implementation.
- engine-lib's `tenantScopedStore` gives free defensive isolation.
- LRU cache is simple (exact suffixed session IDs are stable).
- Pruning job is simple (scan by `timestamp`).
- Forking is free (engine-lib built-in).

**Negative**:

- No "delete this session" operator command in v1. Mitigation: pruning
  job + manual DB intervention for edge cases.
- Composite ID is not a UUID (minor — fits engine-lib's string type).

**Neutral**:

- The operator's `/chat assistant` on `survival` joins the same session
  as a player's `@assistant` mention on `survival`. This is the intended
  "group chat" behavior, but it means the operator sees player prompts
  (and vice versa). NFR-SEC-008 (no prompt content at INFO log level)
  is still satisfied — the session DB is not the log.

## Mitigations for negative consequences

- **No delete command** → The pruning job handles retention. For
  "delete now" use cases, the operator can `/clear` (in-memory) and wait
  for pruning, or manually `sqlite3 data/sessions.db "DELETE FROM
session_messages WHERE sessionId LIKE 'survival:assistant:%'"`. A
  follow-up LLD may add `/delete-session` if operator demand warrants.
- **Composite ID format** → Documented in `data-model.md` and validated at
  `createSession` time (regex `^[a-zA-Z0-9_-]{1,32}:[a-zA-Z0-9_-]{1,32}:[0-9]{13}-[a-z0-9]{6}$`).

## Links

- Implements HLD ADR: ADR-002
- Related LLD ADRs: ADR-LLD-001 (engine-lib session-stores is the
  imported primitive)
- SRS sections: §4.8 (Session Requirements — FR-SES-001/002/004),
  §6.3 (Session Store Model — "Shared Multi-Tenant Session Key"),
  §7.4 (Response Delivery Flow)
- Affected LLD files: `data-model.md`, `domain.md`, `design.md`,
  `sequences.md`, `idempotency.md`, `tests.md`
