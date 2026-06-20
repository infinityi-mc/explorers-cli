# Traceability Matrix — TUI & CLI Process

> **Implements HLD**: `docs/hld/08-nfr-traceability.md` (the HLD-level NFR
> matrix) and `docs/hld/00-requirements.md` (FR/NFR extraction).

This matrix lists every in-scope FR and NFR, the LLD section that addresses
it, and the residual risk. It is filtered to requirements that the `TUI &
CLI Process` container owns. Requirements owned by other containers (the
Minecraft Java Server child process; the LLM provider) are out of scope.

---

## FR traceability

| FR ID | Requirement (one-line) | Addressed by | Residual risk |
|---|---|---|---|
| FR-CFG-001 | Allow up to 10 servers in config | `design.md` §Algorithm 4 (tryReload), `errors.md` `CONFIG_INVALID` | Low |
| FR-CFG-002 | > 10 servers fails validation | `design.md` §Algorithm 4, `errors.md` `CONFIG_INVALID` | Low |
| FR-CFG-003 | Server names unique | `design.md` (forge/config `t.*` schema) | Low |
| FR-CFG-004 | Server entry required fields | `data-model.md` `servers` table | Low |
| FR-CFG-005 | ID format `^[a-zA-Z0-9_-]{1,32}$` | `data-model.md` `ServerId`/`AgentId`, `openapi.yaml` schemas | Low |
| FR-CFG-006 | serverPort 1024..65535 | `data-model.md` `servers.serverPort`, `design.md` §Algorithm 2 (isPortFree) | Low |
| FR-CFG-010 | schemaVersion optional, default 1 | `design.md` (forge/config schema) | Low |
| FR-CFG-011 | Newer schemaVersion warns + best-effort | `errors.md` `HOT_RELOAD_REJECTED` | Low |
| FR-CFG-012 | `${ENV_VAR}` resolution | `design.md` (forge/config env source + secret resolution via `engine-lib/runtime` `resolveSecret`) | Low |
| FR-HOT-001..010 | Watch, validate, apply hot-reload safely | `design.md` §Algorithm 4, `sequences.md` §5, `errors.md` `HOT_RELOAD_REJECTED` | Low |
| FR-HOT-009 | Port/RAM/JAR apply on next restart | `design.md` §Algorithm 4 apply-now/apply-on-restart classification, `observability.md` `explorers_cli_pending_restart` | Low |
| FR-SRV-001 | Start server with configured Java params | `design.md` §Algorithm 2, `sequences.md` §1, `openapi.yaml` `/operator/start` | Low |
| FR-SRV-008 | Port check via TCP bind (no RCON) | `design.md` §Algorithm 2, `errors.md` `PORT_CONFLICT` | Low |
| FR-SRV-010 | Startup timeout | `design.md` §Algorithm 2, `errors.md` `STARTUP_TIMEOUT` | Low |
| FR-SRV-013 | Force-kill on stop timeout | `design.md` `Server.stop(force)`, ADR-LLD-002, `sequences.md` §1 | Medium (OS-specific code) |
| FR-SRV-014 | Non-zero exit → FAILED within 2 s | `design.md` `child.exited` listener, `sequences.md` §2, `observability.md` `explorers_cli_server_crash_total` | Low |
| FR-SRV-016 | Clear `lastError` on successful restart | `data-model.md` `RuntimeServerState`, `design.md` §Algorithm 2 | Low |
| FR-SRV-017 | Stdin close handling | `design.md` §Algorithm 2 stdin watcher, `errors.md` `UNEXPECTED_STDIN_CLOSE` | Low |
| FR-SRV-018 | Track PIDs in `data/pids.json` | `data-model.md` `pids.json`, `design.md` §Algorithm 2, `migration-plan.md` M-002 | Low |
| FR-SRV-019 | On boot, kill stale PIDs | `design.md` (Lock & Lockout Service), `errors.md` `PID_STALE`/`PID_REUSED`, `tests.md` §Reliability | Low |
| FR-SRV-020 | `explorers.lock` single-instance | `data-model.md` `explorers.lock`, `migration-plan.md` M-004, `errors.md` `LOCK_HELD` | Low |
| FR-CHAT-001 | Vanilla chat line format | `design.md` §Algorithm 1, `openapi.yaml` `/ingame/chat` | Low |
| FR-CHAT-002 | Skip non-matching lines | `design.md` §Algorithm 1, `openapi.yaml` `IngameChatParseResult.ignored` | Low |
| FR-CHAT-003 | Full parsing pipeline | `design.md` §Algorithm 1, `sequences.md` §3 | Low |
| FR-CHAT-004 | First matching @alias only | `design.md` §Algorithm 1 step 4 | Low |
| FR-CHAT-005 | Strip team prefix/suffix | `design.md` §Algorithm 1 step 2 | Low |
| FR-CHAT-006 | Sanitize player name | `design.md` §Algorithm 1 step 3, `domain.md` `PlayerName` | Low |
| FR-CHAT-007 | Case-insensitive perm check | `design.md` §Algorithm 1 step 5 | Low |
| FR-CHAT-008 | Deny-by-default if not in permissions | `design.md` §Algorithm 1 step 5, `errors.md` `PERMISSION_DENIED_PLAYER` | Low |
| FR-CHAT-009 | Per-agent rpm + cooldown | `design.md` §Algorithm 1 step 6, `idempotency.md` (forge/resilience slidingWindowRateLimiter) | Low |
| FR-CHAT-010 | Silently ignore unauthorized/invalid/rate-limited | `design.md` §Algorithm 1, `errors.md` `PERMISSION_DENIED_PLAYER`/`RATE_LIMITED_PLAYER` | Low |
| FR-CHAT-011 | Inject N preceding chat lines excluding trigger | `sequences.md` §3 staticContext step, `design.md` Agent Executor row, engine-lib `staticContext` | Low |
| FR-INV-001 | Offline chat (server stopped) | `openapi.yaml` `/operator/chat` (serverId nullable) | Low |
| FR-INV-002 | Stream tokens to TUI | `design.md` (engine-lib `runAgent({stream:true})`), `sequences.md` §3 | Low |
| FR-INV-003 | Timeout abort | `design.md` (forge/resilience `timeout`), `sequences.md` §4, `errors.md` `PROVIDER_TIMEOUT` | Low |
| FR-INV-004 | Send response to server stdin | `design.md` §Algorithm 6, `sequences.md` §4c | Low |
| FR-INV-005 | `/say` fallback on `/tellraw` failure | `design.md` §Algorithm 6, `errors.md` `TELLRAW_FALLBACK` | Low |
| FR-INV-006 | Retry `/tellraw` on each response | `design.md` §Algorithm 6 | Low |
| FR-INV-007 | Broadcast to all players | `openapi.yaml` `/ingame/tellraw` selector default `@a` | Low |
| FR-INV-008 | Strip Minecraft formatting markers | `design.md` §Algorithm 6 | Low |
| FR-INV-009 | Chunked `/tellraw` delivery ≤200 chars | `design.md` §Algorithm 6, `openapi.yaml` `TellrawRequest.text.maxLength`, `sequences.md` §4c | Low |
| FR-INV-010 | Prefer sentence/clause/word chunk boundaries | `design.md` §Algorithm 6 | Low |
| FR-INV-011 | 500 ms between chunks | `design.md` §Algorithm 6, `sequences.md` §4c | Low |
| FR-SES-001 | Persist sessions in SQLite | `data-model.md` `sessions`/`session_messages`, `migration-plan.md` M-001 (engine-lib session-stores) | Low |
| FR-SES-002 | WAL mode for concurrent writes | `data-model.md` (forge/data dialect applies WAL), `migration-plan.md` M-001 | Low |
| FR-SES-004 | Shared session key `(serverId, agentId)` | `data-model.md` `sessions`, ADR-LLD-004 | Low |
| FR-SES-006 | Session IDs append timestamp + random suffix | ADR-LLD-004, `data-model.md` `sessions.sessionId` | Low |
| FR-SES-007 | Session entries include `playerContext` | `data-model.md` `session_messages.playerContext`, `openapi.yaml` `SessionDetailResponse.messages[].playerContext` | Low |
| FR-SES-008 | Extensible `playerContext` object | `data-model.md` `session_messages.playerContext` JSON object | Low |
| FR-SES-011 | `/resume` no args lists last 20 sessions | `openapi.yaml` `/operator/resume`, `api.md` | Low |
| FR-TOOL-002 | Deny tool execution by default | `design.md` (engine-lib tools-shell/tools-fs policy), `errors.md` `COMMAND_BLOCKED`/`FILE_BLOCKED` | Low |
| FR-TOOL-004 | Token-prefix command allowlist | `design.md` (engine-lib tools-shell `ShellPolicy.allow`), `sequences.md` §6 | Low |
| FR-TOOL-006 | Block move/delete/NBT while RUNNING | `design.md` (engine-lib tools-fs + host `nbtFileExtension` deny rule), `openapi.yaml` `WriteFileNbtBlocked` | Low |
| FR-TOOL-008 | Sandbox to `server.path` | `design.md` (engine-lib tools-fs `allowedRoots`), `errors.md` `PATH_TRAVERSAL_BLOCKED` | Low |
| FR-TOOL-009 | Block symlinks outside root | `design.md` (engine-lib tools-fs canonicalization), `tests.md` §Security | Low |
| FR-TOOL-010 | Block cross-server filesystem access | `design.md` Tool Sandbox Broker per-server `allowedRoots:[server.path]`, `tests.md` §Security | Low |
| FR-TOOL-011 | Audit tool calls | `observability.md` `audit_writes_total`, `design.md` (engine-lib governance `auditSubscriber`), `data-model.md` `audit_entries.actionType` including `tellraw_sent`/`say_fallback` | Low |
| FR-FLG-001 | Support feature flags in config | `data-model.md` `RuntimeConfig.featureFlags` | Low |
| FR-FLG-002 | `audioplayer` defaults false | `data-model.md` `RuntimeConfig.featureFlags.audioplayer` | Low |
| FR-FLG-003 | Hide music UI when disabled | `data-model.md` `RuntimeConfig.featureFlags`, `design.md` §Algorithm 4 apply-now list | Low |
| FR-DEF-001 | Music/audio deferred | Out of scope (NFR-COMP-007) | Deferred |

---

## NFR traceability

| NFR ID | Category | Requirement (one-line) | Addressed by | Residual risk |
|---|---|---|---|---|
| NFR-COMP-001 | Platform | Windows 10+ and Linux | ADR-LLD-002 (OS-specific process cleanup), `tests.md` §Reliability (POSIX process groups + Windows Job Objects) | Medium (Windows Job Object native addon) |
| NFR-COMP-002 | Distribution | Single binary or npm package | HLD `06-deployment.md` (Bun `--compile`); LLD doesn't add constraints | Low |
| NFR-COMP-003 | Minecraft | Vanilla 1.20+ | `design.md` §Algorithm 1 (regex targets vanilla format), `errors.md` `HOT_RELOAD_REJECTED` | Low |
| NFR-COMP-004 | Privileges | Non-admin user | `migration-plan.md` (all paths under operator's home), `design.md` (no privileged ports — serverPort ≥ 1024) | Low |
| NFR-PERF-001 | Latency | Log render < 100 ms p99 | `observability.md` (no direct metric; TUI render budget is implementation), ADR-005 bounds ingestion | Medium (TUI render budget is implementation) |
| NFR-PERF-002 | Hot-reload | < 2 s for 10 servers | `design.md` §Algorithm 4, `observability.md` `explorers_cli_config_reload_duration_seconds`, `tests.md` §Performance | Low |
| NFR-PERF-003 | Memory | RSS < 200 MB idle, < 500 MB load | `design.md` §Algorithm 3 (16 MB ring buffer per server), ADR-005, `tests.md` §Performance | Low |
| NFR-PERF-004 | Log ingestion | 5000 lines/s, show dropped count | `design.md` §Algorithm 3 (forge/resilience tokenBucketRateLimiter), `observability.md` `explorers_cli_log_lines_dropped_total` | Low |
| NFR-PERF-005 | Cold start | < 3 s | `migration-plan.md` (M-001..M-004 < 100 ms total), `tests.md` §Performance | Low |
| NFR-PERF-006 | Session DB indexes | `(serverId, agentId)`, `(timestamp)`, `(sessionId)` | `data-model.md` (engine-lib session-stores creates these) | Low |
| NFR-CAP-001 | Server count | ≤ 10 | `design.md` §Algorithm 4 (tryReload rejects > 10) | Low |
| NFR-CAP-002 | Session length | 10,000 messages | `data-model.md` `session_messages`, `tests.md` §Performance | Low |
| NFR-REL-001 | Process cleanup on exit | Kill all children via process groups / Job Objects | ADR-LLD-002, `design.md` `Server.stop`, `forge/lifecycle` reverse-stop | Medium (OS-specific) |
| NFR-REL-002 | Stale PIDs on boot | Kill from `data/pids.json` | `design.md` (Lock & Lockout Service), `errors.md` `PID_STALE`/`PID_REUSED`, `tests.md` §Reliability | Low |
| NFR-REL-003 | PID tracking | Maintain `data/pids.json` | `data-model.md` `pids.json`, `design.md` §Algorithm 2 | Low |
| NFR-REL-004 | WAL mode | SQLite WAL | `data-model.md`, `migration-plan.md` M-001 (forge/data dialect) | Low |
| NFR-REL-005 | Crash status in TUI | < 2 s | `design.md` `child.exited` listener, `sequences.md` §2 | Low |
| NFR-REL-006 | Log buffer cap | 16 MB per server | `design.md` §Algorithm 3, `observability.md` `explorers_cli_log_buffer_bytes` | Low |
| NFR-REL-007 | Config deletion stability | Keep state, don't crash | `design.md` §Algorithm 4 (tryReload retains last known good), `errors.md` `HOT_RELOAD_REJECTED`, `tests.md` §Reliability | Low |
| NFR-SEC-001 | Sandbox root canonicalization | `realpath(server.path)` | `design.md` §Algorithm 2, `domain.md` `CanonicalPath` | Low |
| NFR-SEC-002 | jarFile inside canonical path | Containment check | `design.md` §Algorithm 2, `errors.md` `PATH_TRAVERSAL_BLOCKED` | Low |
| NFR-SEC-003 | Symlink block | tools-fs canonicalization | `design.md` (engine-lib tools-fs), `tests.md` §Security | Low |
| NFR-SEC-004 | javaPath validation | Existing executable, not constrained | `design.md` §Algorithm 2, `errors.md` `JAVA_NOT_FOUND` | Low |
| NFR-SEC-005 | Case-insensitive player check | Lowercase map | `design.md` §Algorithm 1 step 5 | Low |
| NFR-SEC-006 | Player name format | `^[a-zA-Z0-9_]{1,16}$` | `design.md` §Algorithm 1 step 3, `domain.md` `PlayerName` | Low |
| NFR-SEC-007 | Secrets in env only, not logged | `t.secret` + redact middleware | `design.md` (forge/config `t.secret`), `observability.md` §Redaction | Low |
| NFR-SEC-008 | No prompt/response at INFO | DEBUG-only | `observability.md` §Redaction, `errors.md` (no prompt content in audit `detail`) | Low |
| NFR-SEC-009 | `--read-only` mode | Blocks TUI mutations | ADR-LLD-003, `design.md` §Algorithm 5, `sequences.md` §8, `errors.md` `READ_ONLY_BLOCKED` | Low |
| NFR-SEC-010 | UTF-8 everywhere | Bun + SQLite UTF-8 | `design.md` (Bun + SQLite native UTF-8) | Low |
| NFR-OBS-001 | Structured JSON logs, 50 MB rotation | `logs/explorers-cli.log` | `observability.md` §Logs/§Log rotation, `design.md` (forge/telemetry createLog + redact) | Low |
| NFR-OBS-002 | Telemetry opt-in, off by default | Config flag | `observability.md` preamble, `design.md` (forge/telemetry nullExporter when off) | Low |
| NFR-OBS-003 | Crash reports | `crash-<timestamp>.json` | `observability.md` §Per-event `crash_report`, `design.md` (process.on uncaughtException + redact) | Low |
| NFR-OBS-004 | Audit log fields | timestamp, agentId, serverId, playerName | `data-model.md` `audit_entries`, `observability.md` `audit_writes_total` | Low |
| NFR-OBS-005 | No MC server logs | Manager doesn't touch MC `logs/` | `design.md` §Responsibilities (does NOT own) | Low |
| NFR-MNT-001 | Custom tool registration docs | Documentation only | Out of scope (documentation, not design) | Low |
| NFR-MNT-003 | `--validate-config` exit code | 0 success, non-zero failure | `design.md` (forge/config `defineConfig` + `writeFailFast`), `README.md` Assumption 10 | Low |
| NFR-PRV-001 | Local-only storage | SQLite at `data/sessions.db` | `data-model.md`, `migration-plan.md` | Low |
| NFR-PRV-002 | No player content in telemetry | Redact before export | `observability.md` §Redaction, `design.md` (engine-lib governance `messageBusSubscriber` `redaction:"digest"`) | Low |

---

## Out-of-scope requirements (deferred)

| Requirement | Reason | Target |
|---|---|---|
| FR-DEF-001 (music / audio search) | Won't-have for v1 (SRS §2.7, NFR-COMP-007) | Future v2 |
| NFR-COMP-007 (future music redistribution) | Out of scope | Future v2 |
| NFR-MNT-001 (custom tool registration SDK) | Documentation-only in v1; no LLD surface needed | Follow-up LLD if SDK is built |
| NFR-MNT-002 (CHANGELOG + semver) | Repo-level process, not design | Repo convention |
| NFR-COMP-005 (installation docs) | README, not LLD | `README.md` |
| NFR-COMP-006 (EULA note) | README, not LLD | `README.md` |

---

## Orphan requirements

There are **no orphan requirements** in this LLD. Every in-scope FR and NFR
is mapped to at least one LLD section. Out-of-scope requirements are
explicitly listed above with rationale and target.

---

## HLD ADR coverage

Every HLD ADR that touches the `TUI & CLI Process` container is either
implemented or explicitly superseded by an LLD ADR:

| HLD ADR | Status in LLD | LLD ADR (if superseded) |
|---|---|---|
| ADR-001 (REST+SSE) | Implemented (via engine-lib providers) | — |
| ADR-002 (SQLite WAL) | Implemented (via engine-lib session-stores + forge/data) | — |
| ADR-003 (Bun.spawn + process groups) | Implemented (host code; justified in ADR-LLD-002) | — |
| ADR-004 (sandboxed tool broker) | Implemented (via engine-lib tools-shell + tools-fs) | — |
| ADR-005 (bounded log ingestion) | Implemented (via forge/resilience rate-limit + host ring buffer) | — |
| ADR-006 (chat parser + permissions) | Implemented (host regex pipeline + engine-lib context + forge/resilience rate-limit) | — |
| ADR-007 (audit + observability) | Implemented (via forge/telemetry + engine-lib governance + engine-lib events) | — |
| ADR-008 (runtime mode + config gateway) | Implemented (via forge/config + host MutatingCommandClassifier — ADR-LLD-003) | — |

No HLD ADR is superseded. The LLD adds four LLD-level ADRs
(ADR-LLD-001 through ADR-LLD-004) that codify LLD-specific decisions within
the HLD ADR constraints.
