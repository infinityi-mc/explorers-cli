# LLD — TUI & CLI Process

> **Container in scope**: `TUI & CLI Process` — the single Bun runtime container
> defined in `docs/hld/02-architecture.md` (C4 L2) and decomposed into 8 internal
> components in `docs/hld/03-components.md` (C4 L3).
>
> **Codename**: `explorers-cli` (Minecraft Server Manager TUI), v1.0.

This is the **Low-Level Design** for the `TUI & CLI Process` container. It
takes the HLD's container-level decisions and produces an implementation-ready
design: API contracts, logical data model, sequence diagrams for critical
flows, domain class diagram, error catalog, idempotency rules, observability
spec, test strategy, and LLD-level ADRs.

This is **design, not implementation**. Pseudocode for non-trivial algorithms
appears in `design.md`; no real code is written.

---

## Component summary

The `TUI & CLI Process` is the single Bun process that hosts the terminal UI,
watches `config.yaml`, spawns up to 10 local Minecraft Java child processes,
parses in-game chat for `@alias` agent triggers, runs the LLM agent loop via
`@infinityi/engine-lib`, enforces tool sandboxing, persists sessions to a local
SQLite WAL database, and emits structured logs + opt-in telemetry via
`@infinityi/forge`. It owns one of the two runnable containers in the HLD (the
other being the Minecraft Java Server child process, which is out of scope for
this LLD).

---

## Forge-first / engine-lib-first principle

The HLD's `package.json` already pins `@infinityi/forge ^1.0.1` and
`@infinityi/engine-lib ^2.0.0` as direct dependencies. This LLD treats those
two libraries as the **primary source of infrastructure**: every capability
they already provide is **imported, not re-implemented**. Anything that would
require writing infrastructure code (HTTP client, structured logging,
resilience policies, SQLite dialect, transactional outbox, audit log,
rate-limit token bucket, JWT verifier, etc.) MUST first be checked against the
forge and engine-lib API surfaces. Re-implementing a capability the libraries
already ship is a design defect.

The mapping table in `design.md` (`§ Forge/engine-lib capability mapping`)
lists, for every HLD component, the exact forge/engine-lib import that
satisfies it. LLD ADR-LLD-001 codifies this as a design rule.

---

## HLD linkage

| HLD ADR   | Decision                                                                                                                                     | LLD constraint                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-001` | REST + SSE for LLM provider comms                                                                                                            | Use `engine-lib` provider adapters (`createOpenAI`/`createAnthropic`/`createGoogle`/`createOpenAICompatible`) which speak REST+SSE natively; do NOT write a hand-rolled SSE parser.                                                                                                                                                                                                                                                     |
| `ADR-002` | SQLite WAL at `data/sessions.db` for session persistence                                                                                     | Use `engine-lib/session-stores`'s `createSqliteSessionStore` (built on `forge/data/dialects/sqlite`); do NOT hand-roll `bun:sqlite` tables. WAL pragma applied via the dialect driver.                                                                                                                                                                                                                                                  |
| `ADR-003` | Native `Bun.spawn` + POSIX process groups / Windows Job Objects / `taskkill` fallback / `data/pids.json`                                     | `Bun.spawn` is used directly (no forge/engine-lib primitive covers child-process lifecycle). PID registry and lock file are host-owned. Process-group / Job-Object wrappers are the ONLY non-library code in this container.                                                                                                                                                                                                            |
| `ADR-004` | Sandboxed path containment + token-prefix allowlisting for agent tools                                                                       | Use `engine-lib/tools-fs` (`filesystemTools({allowedRoots:[server.path]})`) and `engine-lib/tools-shell` (`shellTools({allowedCwds:[server.path], policy:{allow:[...]}})`) — they already canonicalize paths, block symlinks outside roots, and enforce token-prefix command allowlists. Compose run-level policy via `composePolicies(shellPolicySource(...), filesystemPolicySource(...))`. Do NOT hand-roll the broker.              |
| `ADR-005` | Bounded log ingestion: 5000 lines/s + 16 MB scrollback per server                                                                            | Use `forge/resilience/rate-limit` (`tokenBucketRateLimiter({capacity:5000, refillPerSec:5000})`) on the stdout reader; use a fixed-capacity ring buffer (`Array` with index modulo `maxBufferBytes`) for scrollback. The rate limiter is the only forge import; the ring buffer is trivial enough to write inline.                                                                                                                      |
| `ADR-006` | Multi-step chat parser: regex → team-strip → name sanitize → alias lookup → case-insensitive perm check → rate-limit → context-window inject | Use `engine-lib/context` (`staticContext`/`dynamicContext`) for the N preceding chat lines injection; use `forge/resilience/rate-limit` `slidingWindowRateLimiter({limit:rpm, windowMs:60_000})` per `(playerId, agentId)` for `rpm`, plus a `Map<key, lastInvokedAt>` for cooldown. The regex pipeline itself is host-owned (no library covers it).                                                                                    |
| `ADR-007` | Structured JSON logs at `logs/explorers-cli.log` (50 MB rotation), audit channel with redaction, opt-in telemetry, crash reports             | Use `forge/telemetry` (`initTelemetry`, `createLog` with `stdout` exporter, `redact` middleware) for the app log; use `engine-lib/governance` (`auditSubscriber` + `jsonlAuditLog` or `forgeDataAuditLog`) for the audit trail; use `engine-lib/events` (`messageBusSubscriber` with `redaction:"digest"`) for telemetry fan-out. Crash reports are written by a `process.on('uncaughtException')` handler that runs the same redactor. |
| `ADR-008` | Centralized runtime mode + configuration gateway (normal / `--read-only` / `--validate-config`) with hot-reload, last-known-good snapshot    | Use `forge/config` (`defineConfig` with `t.*` schema, `defineDynamicConfig` + `pollingProvider` for hot-reload, `mockConfig` for tests). The runtime mode gate is a host-owned command classifier (`MutatingCommandClassifier`) that consumes the resolved mode and rejects mutating commands when `readOnly`. `validate-config` mode short-circuits `forge.boot` after `defineConfig` resolves.                                        |

---

## Scope

### In scope (this iteration)

- API contracts for the three interface surfaces defined in HLD `05-api-surface.md`:
  1. **Operator TUI slash-command interface** (`/start`, `/stop`, `/restart`,
     `/chat`, `/session`, `/resume`, `/clear`, `/help`)
  2. **In-game chat interface** (the log-line parsing contract — pattern,
     player-name shape, alias shape, help-trigger shape)
  3. **Agent tool-call schema** (`run_command`, `read_file`, `write_file`)
- Logical data model for `data/sessions.db` (the SQLite WAL store owned by this
  container) plus the in-memory shapes for `config.yaml`, `data/pids.json`,
  and `data/explorers.lock`.
- Migration plan for the session DB (greenfield v1; forward-only).
- Sequence diagrams for the 8 critical flows enumerated in `sequences.md`.
- Domain class diagram for the core domain types (`Server`, `Agent`,
  `Player`, `Session`, `Mention`, `Tool`).
- Error catalog (every error code from HLD `05-api-surface.md` § "High-Level
  Error Categories" plus LLD-discovered ones).
- Idempotency rules for the mutating operator commands and tool executions.
- Observability spec (metrics, logs, traces, alerts) — implements ADR-007.
- Test strategy (unit / integration / contract / e2e) mirroring the design.
- LLD ADRs for the consequential LLD-level decisions.

### Out of scope (deferred to follow-up LLDs)

- Internals of the Minecraft Java Server child process (black box; HLD
  explicitly skips its L3 decomposition).
- Music / audio search feature (`FR-DEF-001`, `NFR-COMP-007` — Won't-have v1).
- Remote / network-facing API for the manager itself (NG-5; the manager is a
  local terminal app, no inbound HTTP server).
- Multi-region / multi-host clustering (the manager is single-process on one
  host; `explorers.lock` enforces single-instance).
- Plugin SDK for third-party tool packs beyond the three built-in tools
  (`NFR-MNT-001` documentation-only).
- Future SQLite schema migrations beyond v1 (the migration plan covers v1
  greenfield; a follow-up LLD will own v2+).

---

## Stack inference

The stack is **fully constrained by the SRS, HLD ADRs, and repo conventions**.
No stack selection ADR is needed.

| Layer         | Choice                                             | Source of truth                                          |
| ------------- | -------------------------------------------------- | -------------------------------------------------------- |
| Runtime       | Bun ≥ 1.3                                          | `package.json` `engines.bun` (forge peer), HLD `ADR-003` |
| Language      | TypeScript 6 strict, ESM                           | `package.json` `peerDependencies.typescript`, forge peer |
| TUI framework | `@opentui/react` + `@opentui/core`                 | `package.json` `dependencies`, SRS §3.1                  |
| UI paradigm   | React 19 (function components, hooks)              | `package.json` `dependencies`                            |
| Infra toolkit | `@infinityi/forge ^1.0.1`                          | `package.json` `dependencies`, HLD ADRs 002/005/007/008  |
| Agent runtime | `@infinityi/engine-lib ^2.0.0`                     | `package.json` `dependencies`, HLD ADRs 001/004          |
| Persistence   | `bun:sqlite` (via `forge/data/dialects/sqlite`)    | HLD `ADR-002`, SRS §6.3                                  |
| Test runner   | `bun:test`                                         | forge/engine-lib convention, SRS §10                     |
| Distribution  | `bun build --compile` single binary or npm package | HLD `06-deployment.md`, `ADR-003`                        |

---

## File TOC

| File                                                  | Purpose                                                                                                                                                                                |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                           | This file. Entry point, HLD linkage, scope, assumptions.                                                                                                                               |
| `design.md`                                           | Component design narrative, forge/engine-lib capability mapping, key algorithms (pseudocode), concurrency model, external dependencies.                                                |
| `api.md`                                              | Human-readable companion to `openapi.yaml`. Endpoint table, common patterns, versioning.                                                                                               |
| `openapi.yaml`                                        | OpenAPI 3.1 spec for the three interface surfaces (operator commands, in-game chat protocol, agent tool schemas).                                                                      |
| `data-model.md`                                       | Logical ER for `data/sessions.db`, plus in-memory shapes for `config.yaml`, `data/pids.json`, `data/explorers.lock`. Indexes, constraints, access patterns.                            |
| `migration-plan.md`                                   | v1 greenfield migration for the session DB; cutover plan; rollback.                                                                                                                    |
| `sequences.md`                                        | 8 Mermaid sequence diagrams for critical flows (server start, server stop/crash, mention-trigger, manual `/chat`, hot-reload, tool sandboxing, idempotent `/start`, read-only reject). |
| `domain.md`                                           | Mermaid class diagram for `Server`, `Agent`, `Player`, `Session`, `Mention`, `Tool`, plus value objects and enums.                                                                     |
| `errors.md`                                           | Error catalog (codes, mapping to internal exceptions, retry policy).                                                                                                                   |
| `idempotency.md`                                      | Per-mutating-operation idempotency rules (operator commands + tool executions).                                                                                                        |
| `observability.md`                                    | Metrics, logs, traces, alerts. Implements `ADR-007`.                                                                                                                                   |
| `tests.md`                                            | Unit / integration / contract / e2e strategy; must-not-break scenarios.                                                                                                                |
| `traceability.md`                                     | FR/NFR × LLD-section matrix; orphan/out-of-scope requirements.                                                                                                                         |
| `adrs/ADR-LLD-001-forge-first-engine-lib-first.md`    | Codifies the forge-first / engine-lib-first design rule.                                                                                                                               |
| `adrs/ADR-LLD-002-process-lifecycle-is-host-owned.md` | `Bun.spawn` + process groups / Job Objects / PID registry are the only non-library code; justifies why no forge primitive covers this.                                                 |
| `adrs/ADR-LLD-003-runtime-mode-command-classifier.md` | The shared command router's mutating/non-mutating classification table for `--read-only` enforcement.                                                                                  |
| `adrs/ADR-LLD-004-shared-session-key-multi-tenant.md` | One session per `(serverId, agentId)` shared by all players + operator; uses `engine-lib/session` tenant claim.                                                                        |

---

## How to review this LLD

Suggested reading order:

1. **This README** — scope, HLD linkage, assumptions.
2. **`adrs/ADR-LLD-001-forge-first-engine-lib-first.md`** — the design rule
   that drives every other decision.
3. **`design.md`** — the narrative + the forge/engine-lib capability mapping
   table. This is the single most important file.
4. **`openapi.yaml`** — the machine-checkable contract for the three interface
   surfaces.
5. **`sequences.md`** — how the critical flows unfold.
6. **`data-model.md`** + **`migration-plan.md`** — what's persisted and how it
   gets there safely.
7. **`errors.md`** + **`idempotency.md`** + **`observability.md`** +
   **`tests.md`** — the cross-cutting specs.
8. **`traceability.md`** — every in-scope NFR/FR mapped to an LLD section.
9. **`adrs/ADR-LLD-002` through `ADR-LLD-004`** — the consequential LLD-level
   decisions.

---

## Status & ownership

- **Author**: Engineering (LLD pass)
- **Date**: 2026-06-19
- **Status**: Accepted
- **HLD baseline**: `docs/hld/` as of 2026-06-19 (status: Ready for LLD)

---

## Assumptions

The HLD + SRS are detailed enough that most LLD-level gaps are mechanical. The
following assumptions are stated explicitly so reviewers can challenge them;
none of them warrant a blocking question round.

1. **Single-process, single-host**. The manager runs as one Bun process on one
   host. `explorers.lock` prevents a second instance. No clustering, no
   remote procedure calls between manager instances. (From HLD §02 + ADR-003.)
2. **Operator is trusted in normal mode; `--read-only` is the only shared-host
   guard**. There is no per-operator authentication; the OS account is the
   trust boundary. (From ADR-008.)
3. **`config.yaml` is the single source of truth for servers, agents,
   providers, permissions, feature flags, and telemetry consent.** No
   database-backed configuration; no runtime mutation API beyond hot-reload.
   (From SRS §3.4, ADR-008.)
4. **The Minecraft Java Server is a black box.** The manager only interacts
   with it via stdin/stdout/stderr pipes and process signals. RCON is
   intentionally not used (SRS FR-SRV-008). (From HLD §02, ADR-001.)
5. **Vanilla Minecraft Java Edition 1.20+ log format.** The chat parser
   targets exactly the format `[HH:MM:SS] [Server thread/INFO]: <playername> message`
   and the variants for join/leave. Custom log-format plugins (EssentialsChat
   etc.) are not supported. (From ADR-006.)
6. **Sessions are shared "group chat" rooms**, keyed by `(serverId, agentId)`.
   All authorized players plus the operator see the same context window for a
   given key. There are no per-player private sessions. (From SRS §6.3,
   HLD `04-data-model.md` "Shared Multi-Tenant Session Key".)
7. **`@infinityi/forge` and `@infinityi/engine-lib` are pinned at the versions
   in `package.json`** (`^1.0.1` and `^2.0.0` respectively). The LLD assumes
   their public API surfaces as documented in their respective GUIDE.md /
   docs/guide/ — see `design.md`'s capability mapping for the exact imports.
8. **The three built-in agent tools (`run_command`, `read_file`, `write_file`)
   are the only tools in v1.** Custom tool registration is documented
   (NFR-MNT-001) but no LLD surface is defined for it in this iteration.
9. **Telemetry is opt-in and off by default.** When off, no forge telemetry
   exporter is initialized; the `forge/telemetry` handle is a no-op. (From
   NFR-OBS-002, ADR-007.)
10. **`--validate-config` exits with code `0` on success, non-zero on
    failure** and prints a human-readable diagnostic table to stderr (reusing
    `forge/config/diagnostics`'s `formatDiagnostics` + `writeFailFast`).
    (From NFR-MNT-003, ADR-008.)
11. **Idempotency for operator slash-commands is enforced via a per-command
    dedup window** (default 5 s) keyed by `(command, target, args)` hash, kept
    in-process — no DB-backed idempotency store. Rationale: operator commands
    are interactive; a 5 s window covers accidental double-Enter without
    persisting state. Tool executions get their idempotency from
    `engine-lib`'s session append + `Idempotency-Key`-style hashing of the
    tool-call arguments within the run loop. (See `idempotency.md`.)
12. **No new external systems are introduced.** All participants in the
    sequence diagrams come from the HLD L2 view (operator, player, manager,
    Minecraft server, LLM provider, `config.yaml`, SQLite DB, PID/lock
    files). No Redis, no Kafka, no external cache. (From HLD §02.)
