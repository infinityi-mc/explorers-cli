# Error Catalog — TUI & CLI Process

Every error this component can return is listed below. Codes are **stable
forever** — never rename, never renumber. New errors get new codes; old
errors stay even if the underlying cause is fixed (the code may be reused
for the same semantic in the future).

The error response shape is defined in `openapi.yaml` as the shared `Error`
schema (`{code, message, details?}`). Operator commands return `Error`
directly. Agent tools return `ToolResult = {ok:false, error:"<code>: <detail>"}` —
the `code` is embedded in the `error` string so the model can branch on it.

---

## Error table

| Code                       | HTTP / Surface                                               | Message (machine)                                                                       | User-facing text                                                                                                 | Retry policy                                   | Mapped from                                                                                                            |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `PORT_CONFLICT`            | 422 operator `/start`                                        | Port {port} is already in use                                                           | Server "{name}" cannot start: port {port} is already in use.                                                     | no-retry                                       | `isPortFree()` returned false (FR-SRV-008)                                                                             |
| `JAR_NOT_FOUND`            | 422 operator `/start`                                        | JAR file "{jarFile}" not found inside {path}                                            | Server "{name}" cannot start: the JAR file is missing.                                                           | no-retry                                       | `fileExists(canonicalJar)` returned false                                                                              |
| `JAVA_NOT_FOUND`           | 422 operator `/start`                                        | Java executable "{javaPath}" not found or not executable                                | Server "{name}" cannot start: Java is not installed at the configured path.                                      | no-retry                                       | `isExecutable(server.javaPath)` returned false (NFR-SEC-004)                                                           |
| `PATH_TRAVERSAL_BLOCKED`   | 422 operator `/start` / 422 agent `read_file` / `write_file` | Path resolves outside the canonical server.path                                         | The agent tried to access a file outside the server sandbox. This is blocked.                                    | no-retry                                       | `CanonicalPath.contains()` returned false (FR-TOOL-008/009, NFR-SEC-001/002/003)                                       |
| `ALREADY_RUNNING`          | 409 operator `/start`                                        | Server "{serverId}" is already in state {currentState}                                  | Server "{name}" is already running.                                                                              | no-retry                                       | `serverState[serverId] in (RUNNING, STARTING)`                                                                         |
| `NOT_RUNNING`              | 409 operator `/stop`                                         | Server "{serverId}" is not running                                                      | Server "{name}" is not running.                                                                                  | no-retry                                       | `serverState[serverId] === STOPPED`                                                                                    |
| `STARTUP_TIMEOUT`          | 422 operator `/start`                                        | Server "{serverId}" did not print "Done!" within {startupTimeout}s                      | Server "{name}" took too long to start. Check the JAR file and Java version.                                     | retry-after-backoff                            | `startupTimer` fired before "Done!" line seen (FR-SRV-010)                                                             |
| `SERVER_NOT_FOUND`         | 404 operator (any)                                           | No server named "{serverId}" is configured                                              | Server "{serverId}" is not in the configuration.                                                                 | no-retry                                       | `config.servers[serverId]` is undefined                                                                                |
| `AGENT_NOT_FOUND`          | 404 operator `/chat`                                         | No agent named "{agentId}" is configured                                                | Agent "{agentId}" is not in the configuration.                                                                   | no-retry                                       | `config.agents[agentId]` is undefined                                                                                  |
| `PROVIDER_TIMEOUT`         | 504 operator `/chat` / in-game mention                       | LLM provider did not respond within {timeoutMs}ms                                       | The AI provider is taking too long. Please try again in a moment.                                                | retry-after-backoff                            | `forge/resilience` `timeout` policy fired (FR-INV-003)                                                                 |
| `PROVIDER_UNAVAILABLE`     | 503 operator `/chat` / in-game mention                       | LLM provider is currently unavailable                                                   | The AI provider is temporarily unavailable. Please try again later.                                              | retry-after-30s                                | `engine-lib/resilience` `circuitBreaker` open                                                                          |
| `PROVIDER_RATE_LIMITED`    | 429 operator `/chat` / in-game mention                       | LLM provider rate-limited the request                                                   | The AI provider is busy. Please slow down.                                                                       | retry-after-N (from `Retry-After` header)      | Provider returned 429; retry budget exhausted                                                                          |
| `CONTEXT_WINDOW_EXCEEDED`  | 500 operator `/chat` / in-game mention                       | Context window cannot be reduced to fit the model's limit                               | The conversation is too long for the AI to process. Use `/clear` to reset the session.                           | no-retry                                       | `engine-lib/context` `applyContextWindow` threw `ContextWindowError`                                                   |
| `MAX_STEPS_EXCEEDED`       | 500 operator `/chat` / in-game mention                       | Agent run exceeded {maxSteps} steps                                                     | The agent took too many steps without finishing. Try simplifying the request.                                    | no-retry                                       | `engine-lib/execution` `MaxStepsExceededError`                                                                         |
| `MAX_HANDOFFS_EXCEEDED`    | 500 operator `/chat`                                         | Agent run exceeded {maxHandoffs} handoffs                                               | The agent handed off too many times. Check the handoff graph for cycles.                                         | no-retry                                       | `engine-lib/execution` `MaxHandoffsExceededError`                                                                      |
| `BUDGET_EXCEEDED`          | 500 operator `/chat`                                         | Token budget exceeded ({field}={used}/{limit})                                          | The agent used too many tokens. Try simplifying the request.                                                     | no-retry                                       | `engine-lib/resilience` `BudgetExceededError`                                                                          |
| `SESSION_NOT_FOUND`        | 404 operator `/resume`                                       | No session with id "{sessionId}"                                                        | That session no longer exists.                                                                                   | no-retry                                       | `SessionStore.load(sessionId)` returned empty                                                                          |
| `READ_ONLY_BLOCKED`        | 403 operator (mutating command)                              | This command is blocked in --read-only mode                                             | This action is not allowed in read-only (observer) mode.                                                         | no-retry                                       | `MutatingCommandClassifier` rejected (ADR-008, ADR-LLD-003)                                                            |
| `CONFIG_INVALID`           | 422 boot / hot-reload                                        | Config validation failed: {issues}                                                      | The configuration file has errors. See the TUI banner for details.                                               | no-retry                                       | `forge/config` `defineConfig` threw `ConfigValidationError`                                                            |
| `CONFIG_FROZEN`            | 500 internal                                                 | Cannot mutate frozen config                                                             | (no user-facing surface — internal bug)                                                                          | no-retry                                       | `forge/config` `ConfigFrozenError`                                                                                     |
| `HOT_RELOAD_REJECTED`      | 200 (warning) hot-reload                                     | Hot-reload rejected: {reason}; retaining last known good config                         | The config file was changed but the new version is invalid. The manager is still running on the previous config. | no-retry                                       | `tryReload()` returned `{ok:false}` (NFR-REL-007)                                                                      |
| `COMMAND_BLOCKED`          | 200 (ToolFailure) agent `run_command`                        | Command "{token}" is not in the allowlist                                               | (the agent sees this and can retry with a different command)                                                     | no-retry (agent may retry with different args) | `engine-lib/tools-shell` policy denial (FR-TOOL-002/004)                                                               |
| `FILE_BLOCKED`             | 200 (ToolFailure) agent `read_file` / `write_file`           | File access blocked: {reason}                                                           | (the agent sees this)                                                                                            | no-retry (agent may retry with different path) | `engine-lib/tools-fs` policy denial (FR-TOOL-006/008/009)                                                              |
| `OFFLINE_FAIL`             | 200 (ToolFailure) agent `run_command`                        | Server "{serverId}" is not running                                                      | (the agent sees this)                                                                                            | no-retry                                       | `Server.state !== RUNNING` when `run_command` invoked                                                                  |
| `TELLRAW_FALLBACK`         | (audit) in-game response                                     | `/tellraw` failed; fell back to `/say` for chunk {chunkIndex}                           | (operator sees TUI warning)                                                                                      | no-retry                                       | Algorithm 6 `/tellraw` write returned false (FR-INV-005)                                                               |
| `CHUNK_SPLIT_FAILED`       | (audit) in-game response                                     | Agent response could not be split into chat chunks                                      | (operator sees TUI warning)                                                                                      | no-retry                                       | Algorithm 6 produced zero chunks unexpectedly                                                                          |
| `UNEXPECTED_STDIN_CLOSE`   | (warning) runtime                                            | Server "{serverId}" stdin closed unexpectedly                                           | (operator sees TUI warning)                                                                                      | no-retry                                       | `child.stdin` closed while RUNNING; `lastError` set; state transitions to `FAILED` (FR-SRV-017)                        |
| `RATE_LIMITED_PLAYER`      | (silent) in-game mention                                     | (no surface — silently ignored per FR-CHAT-010)                                         | (player sees nothing)                                                                                            | retry-after-cooldown                           | `forge/resilience` `slidingWindowRateLimiter` denied (FR-CHAT-009)                                                     |
| `PERMISSION_DENIED_PLAYER` | (silent) in-game mention                                     | (no surface — silently ignored per FR-CHAT-010)                                         | (player sees nothing)                                                                                            | no-retry                                       | Player not in `permissions.<serverId>.players` or agent not in `allowedAgents` (FR-CHAT-008)                           |
| `LOCK_HELD`                | 1 (exit) boot                                                | Another instance of explorers-cli is already running (lock file held)                   | Another instance is already running. Exit the other instance first.                                              | no-retry                                       | `flock(LOCK_EX)` or `LockFileEx` failed (FR-SRV-020, AC-035)                                                           |
| `PID_STALE`                | (warning) boot                                               | Stale PID {pid} for server "{serverId}" — killed                                        | (operator sees in TUI banner)                                                                                    | no-retry                                       | Stale-PID cleanup on boot (NFR-REL-002)                                                                                |
| `PID_REUSED`               | (warning) boot                                               | Stale PID {pid} for server "{serverId}" belongs to an unrelated process — skipping kill | (operator sees in TUI banner)                                                                                    | no-retry                                       | Stale-PID verification: process command line does not contain `java` and `jar`                                         |
| `LOG_DROPPED`              | (gauge) runtime                                              | Dropped {count} log lines on server "{serverId}" in the last second                     | (operator sees dropped count in TUI panel)                                                                       | n/a                                            | `forge/resilience` `tokenBucketRateLimiter` denied (ADR-005)                                                           |
| `CRASH`                    | (audit) runtime                                              | Server "{serverId}" crashed (exit code {code})                                          | (operator sees state=FAILED in TUI)                                                                              | no-retry                                       | `child.exited` with non-zero code while state was `RUNNING` (NFR-REL-005)                                              |
| `INTERNAL_ERROR`           | 500 operator (any) / 500 agent run                           | An unexpected error occurred                                                            | Something went wrong. Check `logs/explorers-cli.log` with the request ID for details.                            | retry-after-backoff                            | Unhandled exception (catch-all); internal exception details are logged after redaction, never returned in the response |

---

## Retry semantics

### Operator commands

Clients (the TUI) should retry on:

- `5xx` errors with `retry-after-backoff` (exponential, jittered, max 3 attempts)
- `PROVIDER_TIMEOUT` after the provider's cooldown

Clients should NOT retry on:

- `4xx` errors (the request is wrong; retrying won't help)
- `READ_ONLY_BLOCKED` (the operator must restart without `--read-only`)
- `LOCK_HELD` (another instance must exit first)
- `CONFIG_INVALID` (the operator must fix `config.yaml`)

### Agent tool calls

Tools return `ToolFailure` for recoverable domain errors. The agent (LLM)
sees the `error` string and can retry with different arguments. The engine-lib
run loop does NOT retry tool calls automatically — the model decides.

Tools throw only for unexpected implementation faults (e.g.
`ShellPolicyError` at factory-build time, `DataError` from the SQLite store).
These surface as `INTERNAL_ERROR` in the run loop and terminate the run.

### In-game mentions

Mentions that fail permission or rate-limit checks are **silently ignored**
(FR-CHAT-010). The player sees no feedback. The operator can see rejected
mentions in the audit log (`mention_denied` entries).

---

## Error code stability

Codes are part of the public contract. Once shipped:

- Never rename (`PROVIDER_TIMEOUT` → `LLM_TIMEOUT` is a breaking change).
- Never reuse for a different meaning.
- Can be **deprecated** (still returned, documented as such) but never removed.
- New codes are appended; existing codes keep their position.

The only exception is `LOG_DROPPED`, `CRASH`, `PID_STALE`, `PID_REUSED`,
`RATE_LIMITED_PLAYER`, `PERMISSION_DENIED_PLAYER`, `HOT_RELOAD_REJECTED` —
these are **observability/audit codes**, not API response codes. They appear
in the audit log and the TUI but are never returned in an HTTP-style error
response. They follow the same stability rule (never rename, never reuse).

---

## Mapping internal exceptions to error codes

| Internal exception / condition                                | Error code                                                           | Notes                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| `forge/config` `ConfigValidationError`                        | `CONFIG_INVALID`                                                     | Boot or hot-reload                                      |
| `forge/config` `ConfigFrozenError`                            | `CONFIG_FROZEN`                                                      | Internal bug — should never happen                      |
| `forge/resilience` `TimeoutError`                             | `PROVIDER_TIMEOUT`                                                   | From the agent run's `combine(retry, timeout)` pipeline |
| `forge/resilience` `CircuitOpenError`                         | `PROVIDER_UNAVAILABLE`                                               | From `engine-lib/resilience` `circuitBreaker`           |
| `forge/resilience` `RateLimitedError`                         | `RATE_LIMITED_PLAYER` (in-game) / `PROVIDER_RATE_LIMITED` (provider) | Different surfaces, same underlying error class         |
| `engine-lib` `ProviderError` (status 429)                     | `PROVIDER_RATE_LIMITED`                                              | After retry budget exhausted                            |
| `engine-lib` `ProviderError` (status 5xx)                     | `PROVIDER_UNAVAILABLE`                                               | After retry budget exhausted                            |
| `engine-lib` `ProviderError` (status 4xx other)               | `PROVIDER_UNAVAILABLE`                                               | Auth/quota issues; surfaced as unavailable              |
| `engine-lib` `ContextWindowError`                             | `CONTEXT_WINDOW_EXCEEDED`                                            |                                                         |
| `engine-lib` `MaxStepsExceededError`                          | `MAX_STEPS_EXCEEDED`                                                 | Default 16 steps                                        |
| `engine-lib` `MaxHandoffsExceededError`                       | `MAX_HANDOFFS_EXCEEDED`                                              | Default 8 handoffs                                      |
| `engine-lib` `BudgetExceededError`                            | `BUDGET_EXCEEDED`                                                    |                                                         |
| `engine-lib` `CancelledError`                                 | `INTERNAL_ERROR` (with `details.aborted=true`)                       | Operator cancelled via `Ctrl+C` or signal               |
| `engine-lib` `ToolValidationError`                            | `COMMAND_BLOCKED` or `FILE_BLOCKED`                                  | Depending on which tool's schema failed                 |
| `engine-lib/tools-shell` `ShellPolicyError`                   | (thrown at factory build time, not at call time)                     | Crashes boot — fix config                               |
| `engine-lib/tools-fs` `FilesystemPolicyError`                 | (thrown at factory build time)                                       | Crashes boot                                            |
| `engine-lib/tools-sandbox` `SandboxError`                     | `FILE_BLOCKED`                                                       | Network downgrade denied                                |
| `forge/data` `QueryError` / `PoolError`                       | `INTERNAL_ERROR`                                                     | SQLite errors                                           |
| `forge/data` `ConcurrencyError`                               | `INTERNAL_ERROR`                                                     | CAS mismatch (should not happen in v1 — single process) |
| `forge/security` `AuthenticationError` / `AuthorizationError` | N/A — not used in v1 (no inbound HTTP server)                        |                                                         |
| `forge/lifecycle` `StartupError`                              | `LOCK_HELD` or `CONFIG_INVALID` (depending on cause)                 | Boot failure                                            |
| `forge/lifecycle` `ShutdownError` / `ShutdownTimeoutError`    | (logged, not surfaced as an error code)                              | Process is exiting anyway                               |
| Host: `isPortFree()` returns false                            | `PORT_CONFLICT`                                                      | FR-SRV-008                                              |
| Host: `fileExists(jar)` returns false                         | `JAR_NOT_FOUND`                                                      |                                                         |
| Host: `isExecutable(javaPath)` returns false                  | `JAVA_NOT_FOUND`                                                     | NFR-SEC-004                                             |
| Host: `CanonicalPath.contains()` returns false                | `PATH_TRAVERSAL_BLOCKED`                                             | FR-TOOL-008/009                                         |
| Host: `serverState[id] in (RUNNING, STARTING)` on `/start`    | `ALREADY_RUNNING`                                                    |                                                         |
| Host: `serverState[id] === STOPPED` on `/stop`                | `NOT_RUNNING`                                                        |                                                         |
| Host: `startupTimer` fires                                    | `STARTUP_TIMEOUT`                                                    | FR-SRV-010                                              |
| Host: `child.exited` with non-zero code while RUNNING         | `CRASH` (audit) + state transition to FAILED                         | NFR-REL-005                                             |
| Host: `flock` / `LockFileEx` fails                            | `LOCK_HELD`                                                          | FR-SRV-020                                              |
| Host: stale-PID process command line does not match           | `PID_REUSED`                                                         | Defensive — don't kill unrelated processes              |
| Host: `MutatingCommandClassifier` rejects                     | `READ_ONLY_BLOCKED`                                                  | ADR-008, ADR-LLD-003                                    |
| Unhandled exception                                           | `INTERNAL_ERROR`                                                     | Catch-all                                               |
