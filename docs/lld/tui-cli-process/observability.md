# Observability Spec — TUI & CLI Process

> **Implements HLD ADR**: ADR-007 (audit logging, structured observability,
> telemetry privacy controls).
> **Implements HLD NFRs**: NFR-OBS-001 through NFR-OBS-005, NFR-SEC-007,
> NFR-SEC-008, NFR-PRV-002.

This spec defines what to instrument in the `TUI & CLI Process` container.
The specific tools (`forge/telemetry` with stdout exporter + opt-in OTLP
exporter) are the implementation; the metric, log, and span names here are
the contract.

When `config.telemetry.enabled === false` (the default — NFR-OBS-002), the
`forge/telemetry` handle is initialized with `nullExporter()` for meter,
trace, and (for the audit subscriber) message-bus subscribers. The app log
still goes to `logs/explorers-cli.log` (NFR-OBS-001 is unconditional); only
telemetry **export** is opt-in.

---

## Metrics

All metrics use the `explorers_cli_<metric>` naming convention. Labels are
listed per metric. The `forge/telemetry/meter`'s default histogram boundaries
(`DEFAULT_HISTOGRAM_BOUNDARIES`) are used for duration histograms.

### Server lifecycle metrics

| Name                                          | Type      | Labels                                | Unit    | Description                                                           |
| --------------------------------------------- | --------- | ------------------------------------- | ------- | --------------------------------------------------------------------- |
| `explorers_cli_servers_state`                 | gauge     | `serverId`, `state`                   | 1       | Current count of servers in each state (0 or 1 per server-state pair) |
| `explorers_cli_server_start_total`            | counter   | `serverId`, `outcome` (`ok`/`failed`) | 1       | Server start attempts                                                 |
| `explorers_cli_server_stop_total`             | counter   | `serverId`, `outcome`                 | 1       | Server stop attempts                                                  |
| `explorers_cli_server_crash_total`            | counter   | `serverId`, `exitCode`                | 1       | Server crashes (non-zero exit while RUNNING)                          |
| `explorers_cli_server_start_duration_seconds` | histogram | `serverId`                            | seconds | Time from `Bun.spawn` to "Done!" line                                 |

### Log ingestion metrics (ADR-005)

| Name                                      | Type    | Labels                                              | Unit  | Description                                  |
| ----------------------------------------- | ------- | --------------------------------------------------- | ----- | -------------------------------------------- |
| `explorers_cli_log_lines_ingested_total`  | counter | `serverId`                                          | 1     | Lines successfully pushed to the ring buffer |
| `explorers_cli_log_lines_dropped_total`   | counter | `serverId`, `reason` (`rate_limited`/`buffer_full`) | 1     | Lines dropped (NFR-PERF-004 / NFR-REL-006)   |
| `explorers_cli_log_buffer_bytes`          | gauge   | `serverId`                                          | bytes | Current ring buffer size per server          |
| `explorers_cli_log_buffer_capacity_bytes` | gauge   | `serverId`                                          | bytes | Configured max (default 16 MB)               |

### Chat parser metrics (ADR-006)

| Name                                               | Type    | Labels                                                        | Unit         | Description                                    |
| -------------------------------------------------- | ------- | ------------------------------------------------------------- | ------------ | ---------------------------------------------- |
| `explorers_cli_chat_lines_parsed_total`            | counter | `serverId`, `outcome` (`mention`/`help`/`ignored`)            | 1            | Lines processed by the parser                  |
| `explorers_cli_chat_mentions_authorized_total`     | counter | `serverId`, `agentId`                                         | 1            | Authorized mentions (passed perm + rate check) |
| `explorers_cli_chat_mentions_denied_total`         | counter | `serverId`, `agentId`, `reason` (`permission`/`rate_limited`) | 1            | Denied mentions                                |
| `explorers_cli_chat_rate_limit_window_utilization` | gauge   | `serverId`, `agentId`, `playerName`                           | ratio (0..1) | Current rpm / configured rpm                   |

### Agent executor metrics (engine-lib bridge)

| Name                                        | Type      | Labels                                                          | Unit    | Description                                                  |
| ------------------------------------------- | --------- | --------------------------------------------------------------- | ------- | ------------------------------------------------------------ |
| `explorers_cli_agent_runs_total`            | counter   | `agentId`, `serverId`, `outcome` (`ok`/`failed`/`cancelled`)    | 1       | Agent runs started (mirrors engine-lib `agent.runs`)         |
| `explorers_cli_agent_run_duration_seconds`  | histogram | `agentId`, `outcome`                                            | seconds | End-to-end agent run duration (mirrors `agent.run.duration`) |
| `explorers_cli_agent_tokens_total`          | counter   | `agentId`, `token.type` (`input`/`output`/`reasoning`/`cached`) | 1       | Token usage (mirrors `agent.tokens`)                         |
| `explorers_cli_agent_tool_calls_total`      | counter   | `agentId`, `toolName`, `outcome` (`ok`/`blocked`/`failed`)      | 1       | Tool calls                                                   |
| `explorers_cli_agent_tool_duration_seconds` | histogram | `toolName`                                                      | seconds | Tool execution duration (mirrors `agent.tool.duration`)      |
| `explorers_cli_agent_provider_errors_total` | counter   | `agentId`, `provider`, `status`                                 | 1       | Provider errors (4xx/5xx/network)                            |

### Persistence metrics

| Name                                            | Type      | Labels                           | Unit    | Description                   |
| ----------------------------------------------- | --------- | -------------------------------- | ------- | ----------------------------- |
| `explorers_cli_session_append_total`            | counter   | `serverId`, `agentId`, `outcome` | 1       | Session appends               |
| `explorers_cli_session_append_duration_seconds` | histogram |                                  | seconds | SQLite WAL append latency     |
| `explorers_cli_session_prune_total`             | counter   | `outcome`                        | 1       | Pruning job runs (every 24 h) |
| `explorers_cli_session_rows_pruned_total`       | counter   |                                  | 1       | Rows deleted by pruning       |
| `explorers_cli_audit_writes_total`              | counter   | `actionType`, `outcome`          | 1       | Audit entries written         |
| `explorers_cli_audit_write_duration_seconds`    | histogram |                                  | seconds | Audit write latency           |

### Config metrics (ADR-008)

| Name                                           | Type      | Labels                      | Unit            | Description                                                             |
| ---------------------------------------------- | --------- | --------------------------- | --------------- | ----------------------------------------------------------------------- |
| `explorers_cli_config_reloads_total`           | counter   | `outcome` (`ok`/`rejected`) | 1               | Hot-reload attempts                                                     |
| `explorers_cli_config_reload_duration_seconds` | histogram | `outcome`                   | seconds         | Hot-reload latency (must be < 2 s, NFR-PERF-002)                        |
| `explorers_cli_config_last_reload_timestamp`   | gauge     |                             | seconds (epoch) | Last successful reload time                                             |
| `explorers_cli_pending_restart`                | gauge     | `serverId`                  | 1               | 1 when process-affecting config fields are pending restart (FR-HOT-009) |

---

## Logs

### Required fields on every log entry

| Field        | Type     | Notes                                                                                 |
| ------------ | -------- | ------------------------------------------------------------------------------------- |
| `timestamp`  | ISO 8601 | UTC, millisecond precision                                                            |
| `level`      | enum     | `DEBUG`, `INFO`, `WARN`, `ERROR`                                                      |
| `service`    | string   | Always `explorers-cli` for this component                                             |
| `trace_id`   | uuid     | From the request's trace context (forge/telemetry context)                            |
| `span_id`    | uuid     | The span this log entry belongs to                                                    |
| `request_id` | uuid     | The request's correlation ID; for non-request logs, the boot id                       |
| `channel`    | string   | `app` (default), `audit` (audit events) — separates audit from diagnostic per ADR-007 |
| `serverId`   | string   | If the event is server-scoped; `null` otherwise                                       |
| `agentId`    | string   | If the event is agent-scoped; `null` otherwise                                        |

### Redaction (NFR-SEC-007 / NFR-SEC-008)

`forge/telemetry/log` middleware `redact({patterns: defaultRedactionPatterns})`
is applied to every log entry. The default patterns (from
`engine-lib/governance` `defaultRedactionPatterns`) cover:

- API keys / bearer tokens / JWTs
- Email addresses
- Credit card numbers
- PEM private keys
- GitHub / AWS / Slack tokens
- `api_key` / `token` / `secret` / `password` assignments

Additionally, the LLD requires:

- Agent prompts and responses are NOT logged at `INFO` level (NFR-SEC-008).
  They are logged at `DEBUG` level only when `--verbose` is set.
- Player chat content (the `message` field of a `Mention`) is NOT logged at
  `INFO` level. The audit log records `target: '<mention redacted>'` and
  `argumentsDigest: <hash>` instead.

### Per-event fields

#### `server_started`

Emitted when a server reaches `RUNNING` state.

| Field               | Type   | Notes                      |
| ------------------- | ------ | -------------------------- |
| `serverId`          | string |                            |
| `pid`               | int    |                            |
| `startupDurationMs` | int    | Time from spawn to "Done!" |

#### `server_crashed`

| Field      | Type   | Notes               |
| ---------- | ------ | ------------------- |
| `serverId` | string |                     |
| `exitCode` | int    |                     |
| `signal`   | string | If killed by signal |

#### `mention_authorized`

| Field        | Type   | Notes                                            |
| ------------ | ------ | ------------------------------------------------ |
| `serverId`   | string |                                                  |
| `agentId`    | string |                                                  |
| `playerName` | string | (not redacted — it's a vanilla MC name, not PII) |
| `runId`      | string | engine-lib run id                                |

#### `mention_denied`

| Field        | Type   | Notes                         |
| ------------ | ------ | ----------------------------- |
| `serverId`   | string |                               |
| `agentId`    | string |                               |
| `playerName` | string |                               |
| `reason`     | string | `permission` / `rate_limited` |

#### `tool_blocked`

| Field      | Type   | Notes                                                               |
| ---------- | ------ | ------------------------------------------------------------------- |
| `agentId`  | string |                                                                     |
| `toolName` | string |                                                                     |
| `target`   | string | Command text or file path (redacted if it matches a secret pattern) |
| `reason`   | string | `COMMAND_BLOCKED` / `PATH_TRAVERSAL_BLOCKED` / `OFFLINE_FAIL`       |

#### `tellraw_sent`

Emitted when the Agent Executor delivers a response chunk via `/tellraw`.

| Field        | Type   | Notes                              |
| ------------ | ------ | ---------------------------------- |
| `serverId`   | string |                                    |
| `agentId`    | string |                                    |
| `runId`      | string | engine-lib run id                  |
| `chunkIndex` | int    | 0-based chunk position             |
| `byteLength` | int    | Chunk length, ≤ 200 per FR-INV-009 |

#### `say_fallback`

Emitted when `/tellraw` delivery fails and the system falls back to `/say`.

| Field        | Type   | Notes                             |
| ------------ | ------ | --------------------------------- |
| `serverId`   | string |                                   |
| `agentId`    | string |                                   |
| `runId`      | string |                                   |
| `chunkIndex` | int    |                                   |
| `reason`     | string | Failure reason from `sendCommand` |

#### `server_stdin_closed`

Emitted when a running Minecraft server's stdin closes unexpectedly.

| Field           | Type   | Notes                 |
| --------------- | ------ | --------------------- |
| `serverId`      | string |                       |
| `pid`           | int    | Last known process id |
| `previousState` | string | Expected `RUNNING`    |

#### `hot_reload`

| Field                   | Type     | Notes                                           |
| ----------------------- | -------- | ----------------------------------------------- |
| `outcome`               | string   | `ok` / `rejected`                               |
| `changedKeys`           | string[] | Dotted paths that changed                       |
| `pendingRestartServers` | string[] | Servers with changes that apply on next restart |
| `reason`                | string   | If rejected, the validation error               |

#### `crash_report`

| Field       | Type     | Notes                                     |
| ----------- | -------- | ----------------------------------------- |
| `crashFile` | string   | Path to `crash-<timestamp>.json`          |
| `error`     | string   | The uncaught exception message (redacted) |
| `stack`     | string[] | The stack frames (redacted)               |

### Log levels

- `DEBUG`: per-line log lines (rate-limited), per-token agent output, SQL
  queries. Off in production unless `--verbose` is set.
- `INFO`: significant business events (server started, mention authorized,
  hot-reload ok). On in production.
- `WARN`: degraded operation (log line dropped, mention denied, hot-reload
  rejected, provider timeout). On in production.
- `ERROR`: failed operations (server crash, audit write failure, uncaught
  exception). On in production, paged on if telemetry enabled.

### Log rotation (NFR-OBS-001)

`logs/explorers-cli.log` rotates at 50 MB. The `forge/telemetry/log` stdout
exporter does not natively rotate; the host code wraps it with a
`RotatingFileWriter` that closes the current file at 50 MB and opens a new
one with a `.1` suffix. Up to 5 rotations are kept; older are deleted.

The audit table (`audit_entries` in `data/sessions.db`, written by
`forgeDataAuditLog` per `data-model.md`) is high-volume. SQLite WAL mode
(ADR-002) handles concurrent writes; the `pruning_state` table (per
`data-model.md`) does NOT audit-row pruning because audit entries are retained
indefinitely (see "Soft-delete" in `data-model.md`).

---

## Traces

### Span naming convention

Spans are named `<operation>:<detail>`:

- `lifecycle:boot` — root span for the boot sequence
- `lifecycle:shutdown` — root span for the shutdown sequence
- `server:start:<serverId>` — server spawn + startup wait
- `server:stop:<serverId>` — server stop + force-kill
- `log:ingest:<serverId>` — per-chunk log ingestion (sampled)
- `chat:parse:<serverId>` — chat parser pipeline per line (sampled)
- `agent:run:<runId>` — engine-lib `agent.run` span (mirrored from
  `engine-lib/events` `SPAN_RUN`)
- `agent:provider:<runId>` — engine-lib `agent.provider.call` span
- `agent:tool:<toolName>` — engine-lib `agent.tool.execute` span
- `session:load:<sessionId>` — session load
- `session:append:<sessionId>` — session append
- `config:reload` — hot-reload validation + publish

### Key spans per flow

For the `/start survival` flow:

```
lifecycle:boot
└── server:start:survival
    ├── db:INSERT audit_entries (start)
    ├── spawn:Bun.spawn (java -jar ...)
    └── log:ingest:survival (loop until "Done!")
```

For the `@assistant hello` mention flow:

```
chat:parse:survival
└── agent:run:run_abc123
    ├── session:load:survival:assistant:1760704496123-a1b2c3
    ├── agent:provider:run_abc123
    │   └── http:POST /v1/chat/completions (stream)
    ├── session:append:survival:assistant:1760704496123-a1b2c3
    └── server:sendCommand:survival (chunked tellraw)
```

### Span attributes

Every span records:

- `request_id` (uuid) — correlates with logs
- `service.name` (string) — always `explorers-cli`
- `serverId` (string) — if server-scoped
- `agentId` (string) — if agent-scoped
- `playerName` (string) — if player-scoped
- `error` (bool) — if the span ended in error
- `error.message` (string) — if error=true

Per-span-type attributes:

- `server:start` — `pid`, `startupDurationMs`, `outcome`
- `agent:run` — `runId`, `agentId`, `inputTokens`, `outputTokens`, `finishReason`
- `agent:tool` — `toolName`, `outcome` (`ok`/`blocked`/`failed`)
- `config:reload` — `changedKeys`, `outcome`

---

## Alerts

When telemetry is enabled, the following alerts SHOULD be configured on the
OTLP collector side. The manager itself does not evaluate alerts; it emits
the metrics.

| Alert name                 | Condition                                                                                              | Severity | Runbook                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------- |
| `ServerCrashLoop`          | `rate(explorers_cli_server_crash_total[5m]) > 0.5` for a single `serverId`                             | P2       | runbooks/server-crash-loop.md                                                         |
| `LogDroppedFlood`          | `rate(explorers_cli_log_lines_dropped_total[1m]) > 100`                                                | P3       | runbooks/log-dropped-flood.md (operator should check server logs)                     |
| `MentionDeniedSpike`       | `rate(explorers_cli_chat_mentions_denied_total[5m]) > 10` for a single `serverId`                      | P3       | runbooks/mention-denied-spike.md (possible unauthorized player or rate-limit too low) |
| `ProviderErrorRate`        | `rate(explorers_cli_agent_provider_errors_total[5m]) / rate(explorers_cli_agent_runs_total[5m]) > 0.2` | P2       | runbooks/provider-error-rate.md                                                       |
| `HotReloadRejected`        | `increase(explorers_cli_config_reloads_total{outcome="rejected"}[1h]) > 0`                             | P3       | runbooks/hot-reload-rejected.md (operator edited config invalidly)                    |
| `AuditWriteFailure`        | `rate(explorers_cli_audit_writes_total{outcome="failed"}[5m]) > 0`                                     | P1       | runbooks/audit-write-failure.md (disk full or DB locked)                              |
| `SessionAppendLatencyHigh` | `histogram_quantile(0.95, rate(explorers_cli_session_append_duration_seconds_bucket[5m])) > 0.5`       | P2       | runbooks/session-append-latency.md (WAL checkpoint needed?)                           |

---

## Dashboard

(Dashboard layout is operational, not design. The metrics above are the
contract; how they're visualized is the operator's call.)

Reference dashboard should show:

- **Top row**: server state grid (one tile per server, colored by state),
  hot-reload status, audit write rate.
- **Middle row**: agent run rate + outcome breakdown, provider error rate,
  token usage by agent.
- **Bottom row**: log ingestion rate + dropped count, session append latency
  P95, mention authorized/denied ratio.
