# Test Strategy — TUI & CLI Process

> **Implements HLD NFRs**: NFR-OBS-004 (audit), NFR-SEC-001..010 (security),
> NFR-PERF-001..006 (performance), NFR-REL-001..007 (reliability).
> **Implements SRS §10**: Verification and Test Strategy.

The test pyramid for `explorers-cli` is tuned for a local terminal
application: heavy on unit tests (cheap, fast, exhaustive), moderate on
integration tests (real SQLite, real child-process spawning with stub Java
scripts), light on e2e (one critical user journey through the TUI). Contract
tests validate the OpenAPI spec against the in-process router.

The test runner is `bun:test` (forge/engine-lib convention; SRS §10 implies
Bun-native).

---

## Test pyramid

### Unit tests

**Coverage target**: 85% line coverage overall, 100% on domain logic
(`Server.start`/`stop` state machine, `Mention` parsing pipeline,
`MutatingCommandClassifier`, `tryReload` validation, `CanonicalPath.contains`).

**What's tested**:
- Domain entity methods — `Server` state transitions, `Player.canInvoke`,
  `Session.append`/`loadRecent` (against an in-memory `SessionStore`).
- Value object invariants — `PlayerName('Steve!')` throws, `Alias('@bad')`
  throws, `CanonicalPath.contains` correctly rejects `..` traversal.
- Pure functions — chat-line regex, team prefix/suffix stripper, command
  tokenizer for allowlist matching, idempotency hash function.
- Algorithm pseudocode from `design.md` — Algorithms 1-5 are each covered by
  at least one unit test per branch (happy path + each error branch).
- Redaction — `forge/telemetry/log` `redact` middleware applied to sample
  log entries containing each `defaultRedactionPatterns` pattern.
- `MutatingCommandClassifier` — full table from ADR-LLD-003, both in normal
  and read-only mode.

**What's mocked**:
- `Bun.spawn` — mocked to return a fake child process with a stub stdout
  that emits scripted lines.
- Filesystem — `Bun.file`, `realpath`, `fileExists`, `isExecutable` are
  mocked via a virtual fs.
- Time — inject a `Clock` (forge/lifecycle `realClock` in prod,
  `TestClock` in tests); never call `Date.now()` directly.
- `engine-lib` provider — use `engine-lib/testing`'s `mockProvider` with
  `scriptedProvider` for deterministic multi-turn runs.
- `forge/telemetry` — use `forge/telemetry/testing`'s `createTestTelemetry`
  which wires recording exporters; assert on recorded spans/metrics/logs.

**What's NOT tested at unit level**:
- TUI rendering (covered by snapshot tests at the integration layer).
- SQLite queries (covered by integration tests against a real `:memory:` DB).
- HTTP serialization (no inbound HTTP server; N/A).
- engine-lib internals (covered by engine-lib's own tests).

### Integration tests

**Coverage target**: every operator command has at least one integration
test for the happy path and one per error code in `errors.md`. Every
critical flow in `sequences.md` has at least one integration test.

**What's tested**:
- DB queries against a real `bun:sqlite` `:memory:` DB via
  `engine-lib/session-stores`'s `createSqliteSessionStore`.
- `forge/config` hot-reload against a real temp file (write-to-temp + rename
  to simulate editor atomic-save).
- Server Process Manager against a real `Bun.spawn` of a stub script
  (e.g. `bun -e 'console.log("[12:00:00] [Server thread/INFO]: Done (1.234s)! For help, type \"help\"")'`)
  that prints "Done!" and stays alive until killed.
- Agent Executor against `engine-lib/testing`'s `mockProvider` with
  scripted streaming events.
- Tool Sandbox Broker against a real filesystem temp dir.
- Audit log against the real `audit_entries` table in `data/sessions.db`.

**Test data setup**:
- Use factory functions: `ServerFactory.create({...})`, `AgentFactory.create({...})`,
  `PlayerFactory.create({...})`, `MentionFactory.create({...})`.
- Each test sets up its own config snapshot via `mockConfig({servers:{...}})`.
- Teardown: delete temp files (`data/sessions.db*`, `data/pids.json`,
  `logs/explorers-cli.log*`). The `forge/lifecycle`
  `Application.stop()` handles component teardown.

**What's mocked**:
- LLM provider (via `engine-lib/testing` `mockProvider` — no network).
- Time (still inject a `TestClock`).

### Contract tests

**Coverage target**: every endpoint in `openapi.yaml` is exercised by a
contract test.

**What's tested**:
- The in-process `CommandRouter` (which dispatches slash-commands) returns
  shapes that match the OpenAPI schemas for `StartServerResponse`,
  `StopServerResponse`, `AgentRunResponse`, `Error`, etc.
- The Chat Parser's `IngameChatParseResult` matches the schema for every
  regex branch (mention, help trigger, ignored).
- The agent tool argument schemas (`RunCommandArgs`, `ReadFileArgs`,
  `WriteFileArgs`) validate sample model outputs.

**Tooling**: a lightweight schema validator built on `engine-lib/schema`
(`validateJsonSchema`). The test suite loads `openapi.yaml`, extracts the
schemas, and asserts each router response validates against the appropriate
one.

**Why**: catches drift between the spec and the implementation. A change to
the router that violates the spec is caught in CI, not in production.

### End-to-end tests

**Coverage target**: 3-5 critical user journeys. Don't aim for
comprehensive coverage at this layer — it's slow and brittle.

**What's tested**:
1. **Boot → start server → player mentions agent → response delivered →
   stop server → shutdown** — the full happy-path journey from `sequences.md`
   §1 + §3 + §2. Uses a stub Java script that emits the "Done!" line and
   echoes stdin to stdout (so `/tellraw` shows up as a chat line the parser
   can re-parse, closing the loop).
2. **Boot → config edit (add agent) → hot-reload → /chat with new agent** —
   the hot-reload journey from `sequences.md` §5.
3. **Boot in `--read-only` → attempt `/start` → rejected → attempt
   `/session` → allowed** — the read-only mode journey from `sequences.md` §8.
4. **Boot → start server → agent runs `run_command` blocked by allowlist →
   agent retries with allowed command → success** — the tool sandboxing
   journey from `sequences.md` §6.
5. **Boot → /chat with mock provider that hangs → timeout fires → TUI shows
   PROVIDER_TIMEOUT** — the timeout journey from `sequences.md` §4.

**Environment**: a real Bun process with real filesystem (temp dir), real
`bun:sqlite`, real `Bun.spawn` of stub scripts. The only mock is the LLM
provider (via `mockProvider` with a scripted hang).

---

## Key scenarios (must-not-break)

These scenarios must always pass; failure is a release blocker.

### Happy paths

- `/start survival` → server reaches `RUNNING` within `startupTimeout`
  (FR-SRV-001, FR-SRV-010, NFR-REL-005).
- `@assistant hello` from authorized player → agent run starts, tokens
  stream to TUI, `/tellraw` writes ≤200-character chunks to MC server stdin,
  response persisted to `data/sessions.db`, and the prompt excludes the
  triggering mention line (FR-CHAT-001..011, FR-INV-002/009, FR-SES-001).
- `/chat assistant hello` from operator → same as above but with operator
  as the source (FR-INV-001).
- `/resume <id>` → TUI loads session history (FR-SES-004).
- Hot-reload adds an agent → new agent is invocable within 2 s (NFR-PERF-002).

### Error paths (one per error code in `errors.md`)

- `PORT_CONFLICT` — start a server, then start another with the same port
  → second start returns 422 `PORT_CONFLICT`.
- Port bind hangs for >1 s → `/start` returns `PORT_CONFLICT` within 2 s;
  the TUI remains responsive.
- `JAR_NOT_FOUND` — start a server with a missing `jarFile` → 422.
- `PATH_TRAVERSAL_BLOCKED` — agent `read_file` with `../../etc/passwd` →
  ToolFailure `PATH_TRAVERSAL_BLOCKED`.
- `COMMAND_BLOCKED` — agent `run_command` with `op Steve` (not in
  allowlist) → ToolFailure `COMMAND_BLOCKED`.
- `PROVIDER_TIMEOUT` — mock provider hangs → 504 `PROVIDER_TIMEOUT`.
- `OFFLINE_FAIL` — agent `run_command` while server is `STOPPED` →
  ToolFailure `OFFLINE_FAIL`.
- `READ_ONLY_BLOCKED` — `/start` in `--read-only` mode → 403.
- `ALREADY_RUNNING` — `/start` while `RUNNING` → 409.
- `NOT_RUNNING` — `/stop` while `STOPPED` → 409.
- `SESSION_NOT_FOUND` — `/resume` with unknown id → 404.
- `HOT_RELOAD_REJECTED` — edit config to add an 11th server → reload
  rejected, last known good retained (NFR-REL-007).

### Idempotency

- Double-Enter on `/start survival` within 5 s → only one spawn, both
  presses get the same `pid` (see `sequences.md` §7).
- Double `/chat assistant hello` within 5 s → only one `runAgent` call,
  both presses subscribe to the same `RunHandle`.
- `/stop survival` then `/stop survival` within 5 s → only one stdin write.

### Retry storms

- Mock provider returns 429 → engine-lib retries up to 3 times with
  exponential backoff → after 3 retries, returns `PROVIDER_RATE_LIMITED`.
- No infinite loop (engine-lib's `withProviderRetry` caps attempts).
- Mock provider returns 500 → same retry path → `PROVIDER_UNAVAILABLE`
  after retries exhausted.

### Concurrency

- Two players on different servers mention `@assistant` simultaneously →
  two concurrent `runAgent` calls, two separate sessions, no interleaving.
- Two players on the **same** server mention `@assistant` simultaneously →
  two concurrent `runAgent` calls on the **same** session. SQLite WAL
  serializes the appends (ADR-002). The agent runs see each other's
  messages only after the first append commits (engine-lib `Session.append`
  is atomic).
- `/start survival` then immediately `/stop survival` while still
  `STARTING` → server is force-killed, state goes `STARTING → STOPPED`
  (not `FAILED`).

### Security

- Agent `read_file` with a symlink pointing outside `server.path` →
  `PATH_TRAVERSAL_BLOCKED` (FR-TOOL-009, NFR-SEC-003).
- Agent on server B reads an absolute/relative path inside server A's folder
  → `PATH_TRAVERSAL_BLOCKED` (FR-TOOL-010).
- Agent `write_file` to a `.nbt` file while server is `RUNNING` →
  `FILE_BLOCKED` (FR-TOOL-006).
- Player `Steve` not in `permissions.survival.players` mentions `@assistant`
  → silently ignored (FR-CHAT-008/010). Audit entry `mention_denied` written.
- Player `Steve` mentions `@assistant` 100 times in 1 minute when `rpm=10`
  → 90 mentions silently ignored after the rate limit is hit (FR-CHAT-009).
- `--read-only` mode blocks `/start`, `/stop`, `/restart`, `/chat`, `/clear`,
  raw stdin, config edits; allows `/help`, `/session`, `/resume`, log
  viewing, navigation (ADR-LLD-003).
- API key in `config.yaml` is loaded via `forge/config` `t.secret` →
  `String(secret)` returns `[REDACTED]` (NFR-SEC-007). Log entry containing
  the secret is scrubbed by the `redact` middleware.

### Reliability

- Manager crash mid-`/start` → on next boot, `data/pids.json` contains the
  stale PID → stale-PID cleanup kills it (NFR-REL-002).
- Stale PID in `pids.json` that now belongs to an unrelated process (PID
  reused) → verification step (process command line must contain `java` and
  `jar`) skips the kill, logs `PID_REUSED` warning (defensive — don't kill
  unrelated processes).
- `config.yaml` deleted mid-run → manager keeps running on last known good
  config, TUI shows warning banner (NFR-REL-007).
- Server crash (non-zero exit while `RUNNING`) → state `FAILED` within 2 s
  (NFR-REL-005), audit `crash` entry written, TUI shows `FAILED`.
- Log flood (10,000 lines/s from a misbehaving server) → rate limiter drops
  lines beyond 5000/s, dropped counter increments, TUI stays responsive
  (ADR-005, NFR-PERF-004).
- 16 MB scrollback cap → oldest entries evicted, eviction counter increments
  (NFR-REL-006).

---

## Test data

- Use factory functions, not fixtures files. Factories compose; fixture
  files rot.
- Default factories produce valid objects; tests override only the fields
  they care about:
  ```ts
  const server = ServerFactory.create({ id: 'survival', ram: 4096 });
  const player = PlayerFactory.create({ serverId: 'survival', allowedAgents: ['assistant'] });
  const mention = MentionFactory.create({ serverId: 'survival', agentId: 'assistant', playerName: 'Steve' });
  ```
- Reference data (servers, agents, players, providers) is seeded once per
  test via `mockConfig({...})` from `forge/config/testing`.
- No shared state between tests — each test calls `forge.boot({...})` and
  `app.stop()` to get a fresh component graph.

---

## Performance tests

Run weekly (not on every PR — too slow).

**What's measured**:
- `/start` cold-start latency (Bun spawn to "Done!" line) — target < 3 s
  for a stub Java script (NFR-PERF-005 measures cold start of the manager
  itself, not the spawned server).
- Hot-reload latency for a 10-server config — target < 2 s (NFR-PERF-002).
- Log ingestion throughput — sustain 5000 lines/s for 60 s without TUI
  render lag (NFR-PERF-001/004).
- Memory under load — 10 servers each emitting 1000 lines/s for 10 min →
  RSS stays < 500 MB (NFR-PERF-003, NFR-REL-006).
- Agent run latency (mock provider, 100-token response) — target P95 < 500
  ms (no NFR directly; sanity check).

**Load profile**:
- Ramp from 0 to 10 active servers over 2 minutes.
- Hold at 10 servers with mixed load (some idle, some logging, some running
  agents) for 10 minutes.
- Ramp down (stop all servers) over 1 minute.

**Failure criteria**: any NFR-PERF target exceeded, or RSS > 500 MB, or TUI
becomes unresponsive (> 1 s render lag).
