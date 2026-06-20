# Minecraft Server Manager TUI - Software Requirements Specification

| Field              | Value                                                                 |
| ------------------ | --------------------------------------------------------------------- |
| Document ID        | SRS-EXPLORERS-CLI                                                     |
| System             | Minecraft Server Manager TUI, codename `explorers-cli`                |
| Version            | 1.4 (formal SRS refactor of v1.3)                                     |
| Status             | Ready for HLD                                                         |
| Last updated       | 2026-06-17                                                            |
| Document type      | Software Requirements Specification                                   |
| Standard alignment | ISO/IEC/IEEE 29148-style SRS; not a certification claim               |
| Normative language | RFC 2119 / RFC 8174 keywords: MUST, MUST NOT, SHOULD, SHOULD NOT, MAY |
| Source baseline    | SRS v1.3 and Day 1-4 meeting resolutions                              |

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification defines the externally observable behavior, constraints, data contracts, non-functional requirements, and verification criteria for v1.0 of `explorers-cli`, a terminal-based Minecraft Java Edition server manager. The document is intended for product review, high-level design, implementation, test planning, and acceptance verification.

This SRS separates normative requirements from informative design notes. Sections 1 through 12 are normative unless explicitly marked otherwise. Appendices are informative unless a requirement in a normative section references them.

### 1.2 Scope

The system MUST provide a local terminal user interface for managing up to 10 vanilla Minecraft Java Edition servers from one process. The system MUST support server lifecycle management, live log viewing, configuration validation and hot-reload, LLM-backed agent interactions from in-game chat, TUI-based operator chat with agents, SQLite-backed session persistence, and deny-by-default agent tool authorization.

The system MUST run on Windows and Linux as a local application. Multi-host cluster operation, web UI operation, and RCON-based control are out of scope for v1.

### 1.3 Product Overview

`explorers-cli` is a single-process TypeScript/Bun application powered by `@infinityi/forge`, `@infinityi/engine-lib`. It starts and controls configured Minecraft Java server processes, displays server state and logs in a TUI, and provides an AI agent ecosystem that allows authorized in-game players and the TUI operator to interact with configured LLM agents.

### 1.4 Definitions, Acronyms, and Abbreviations

| Term              | Definition                                                                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Agent             | A configured LLM-backed persona with an alias, provider, tools, permissions, rate limits, and session context. |
| Agent tool        | A capability exposed to an agent, such as executing a Minecraft command or reading/editing a server file.      |
| HLD               | High-Level Design. The architecture document produced after SRS approval.                                      |
| In-game admin     | A configured Minecraft player with elevated permissions for restricted in-game commands or powerful agents.    |
| In-game player    | A Minecraft player who interacts with agents through chat messages containing `@alias` mentions.               |
| LLM               | Large Language Model.                                                                                          |
| Operator          | The person running the TUI. The operator has full control through TUI commands and configuration.              |
| RCON              | Minecraft remote console protocol. RCON is out of scope for v1.                                                |
| SRS               | Software Requirements Specification.                                                                           |
| TUI               | Terminal user interface.                                                                                       |
| Vanilla Minecraft | Official Minecraft Java Edition server behavior without plugin or mod changes to log format.                   |

### 1.5 References

| Reference                                                      | Description                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| ISO/IEC/IEEE 29148:2018                                        | Requirements engineering practices used as the structural model for this SRS. |
| RFC 2119 / RFC 8174                                            | Normative keyword definitions.                                                |
| `docs/reports/technical-spec-report.md`                        | Latest technical review report.                                               |
| `.agents/reports/minecraft-server-manager-day3-resolutions.md` | Day 3 requirement resolutions.                                                |
| `.agents/reports/minecraft-server-manager-day4-resolutions.md` | Day 4 requirement resolutions.                                                |

### 1.6 Normative Conventions

The keywords MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are normative only when written in uppercase. Requirement priorities use the following meanings:

| Priority | Meaning                                                                      |
| -------- | ---------------------------------------------------------------------------- |
| Must     | Required for v1 acceptance.                                                  |
| Should   | Strongly recommended for v1, but valid exceptions are allowed if documented. |
| Could    | Optional for v1.                                                             |
| Won't    | Explicitly out of scope for v1.                                              |

---

## 2. Overall Description

### 2.1 Product Perspective

The system is a local operator tool. It is not a hosted service and does not provide a network-facing web interface in v1. It interacts with Minecraft servers by spawning Java child processes, writing commands to process stdin, and parsing stdout/stderr logs. It interacts with LLM providers through provider-specific or OpenAI-compatible APIs configured by the operator.

### 2.2 Product Functions

The system MUST provide the following major functions:

| Function Area     | Summary                                                                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Server lifecycle  | Start, stop, restart, crash detection, startup readiness detection, PID tracking, and orphan cleanup.                                    |
| TUI monitoring    | Single-server view, server list, live logs, status, metadata, command input, and agent chat display.                                     |
| Configuration     | Optional YAML config, validation, schema version handling, hot-reload, feature flags, and environment variable references.               |
| Agent ecosystem   | Provider configuration, agent configuration, in-game mention detection, permissions, rate limits, timeouts, sessions, and tool controls. |
| Persistence       | SQLite session database, PID tracking file, structured application logs, and optional crash reports.                                     |
| Security controls | Default-deny player permissions, deny-by-default agent command allowlists, sandboxed file access, secret handling, and audit logging.    |

### 2.3 User Classes and Characteristics

| User Class     | Characteristics                                                                                        | Primary Capabilities                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Operator       | Local user running the TUI. Expected to understand Minecraft server operation and configuration files. | Configure servers and agents, start/stop/restart servers, send server commands, view logs, chat with agents, manage sessions. |
| In-game player | Minecraft player using chat. May not understand the TUI or configuration.                              | Trigger permitted agents through `@alias` mentions, subject to permissions and rate limits.                                   |
| In-game admin  | Minecraft player explicitly configured with elevated access.                                           | Access more powerful agents or restricted in-game commands where configured by the operator.                                  |

### 2.4 Operating Environment

| Constraint              | Value                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Host operating systems  | Windows 10+ and Linux, including Ubuntu 20.04+ and Debian 11+. |
| Runtime                 | Bun / single binary or npm package distribution.               |
| Minecraft server type   | Vanilla Minecraft Java Edition 1.20+ only for v1.              |
| Interface               | TUI only.                                                      |
| Configuration format    | YAML with camelCase keys.                                      |
| Secrets                 | `.env` only; secrets MUST NOT be stored in config or logs.     |
| Multi-instance behavior | A file lock MUST prevent multiple active TUI instances.        |
| Server count            | Up to 10 configured servers.                                   |

### 2.5 Design and Implementation Constraints

- The system MUST run as a single local process that manages child Java processes.
- The system MUST use stdin/stdout/stderr for v1 Minecraft process control and observation.
- The system MUST NOT use RCON in v1.
- The system MUST NOT provide a web UI in v1.
- The system MUST NOT auto-detect server JAR files or mod folders in v1.
- The system MUST treat non-vanilla log formats as unsupported in v1.
- The system MUST NOT ship built-in agents. Operators define all agents in configuration.
- The system MUST use SQLite at `data/sessions.db` for agent session persistence.
- The system MUST use `data/pids.json` for managed server PID tracking.

### 2.6 Assumptions and Dependencies

| ID  | Assumption or Dependency                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------- |
| A-1 | The operator has installed Java suitable for the target Minecraft server version.                                             |
| A-2 | The operator has accepted the Minecraft EULA before starting a server. The system does not manage `eula.txt`.                 |
| A-3 | The operator provides correct server paths, server JAR files, provider credentials, and agent definitions.                    |
| A-4 | LLM provider availability, latency, quota, and rate limits are external dependencies.                                         |
| A-5 | Vanilla Minecraft log output contains chat lines in the format `[timestamp] [Server thread/INFO]: <playername> message`.      |
| A-6 | Formal performance benchmarking is deferred to post-v1; v1 performance targets are engineering guidelines unless marked MUST. |

### 2.7 Non-Goals and Deferred Scope

The following capabilities MUST NOT be implemented as v1 scope:

| ID    | Non-Goal                                                                                  |
| ----- | ----------------------------------------------------------------------------------------- |
| NG-1  | Audioplayer or music playback system. Deferred to v1.5+.                                  |
| NG-2  | Discord or Slack webhooks.                                                                |
| NG-3  | Scheduled cron-style start/stop tasks.                                                    |
| NG-4  | Multi-host cluster mode.                                                                  |
| NG-5  | Web UI.                                                                                   |
| NG-6  | Application-owned Minecraft server log file writing. Minecraft handles its own log files. |
| NG-7  | EULA acceptance flow.                                                                     |
| NG-8  | JAR auto-detection.                                                                       |
| NG-9  | Mod folder auto-detection.                                                                |
| NG-10 | Split-pane or multi-server simultaneous view.                                             |
| NG-11 | RCON support. Deferred to post-v1.                                                        |
| NG-12 | Built-in or predefined agents.                                                            |
| NG-13 | Log format detection for Paper, Spigot, Forge, Fabric, or plugin-modified logs.           |

### 2.8 Accepted Limitations

| ID    | Limitation                                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIM-1 | If a team prefix or suffix is not configured and the raw player name still passes validation, the system may parse the wrong player name.                                         |
| LIM-2 | When multiple players invoke the same agent concurrently, response ordering in the session database may not be strictly chronological.                                            |
| LIM-3 | If the Minecraft EULA is not accepted, the server may fail to start and the system surfaces the failure through startup logs or startup failure state.                            |
| LIM-4 | The system has no local provider concurrency cap in v1. Provider rate limits and per-agent timeouts are the only required throttles beyond per-agent request rate limits.         |
| LIM-5 | If mods or plugins alter server log output format, in-game `@alias` detection is not required to work.                                                                            |
| LIM-6 | Agents with destructive tool permissions can damage server files if misconfigured by the operator. No human-in-the-loop approval flow is required in v1.                          |
| LIM-7 | On startup, stale PIDs in `data/pids.json` are killed without process metadata verification. If the OS has reused a PID for an unrelated process, that process may be terminated. |

---

## 3. External Interface Requirements

### 3.1 TUI Interface

| ID   | Requirement                                                                                                                                             | Priority | Verification  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| UI-1 | The system MUST provide a terminal user interface with a server list, selected-server detail view, live log display, status display, and command input. | Must     | Demonstration |
| UI-2 | The TUI MUST display server metadata including port, max players, and level name for each configured server.                                            | Must     | Test          |
| UI-3 | The TUI MUST support a single selected server context for v1.                                                                                           | Must     | Demonstration |
| UI-4 | The TUI MUST stream agent responses token-by-token in the TUI chat panel.                                                                               | Must     | Test          |
| UI-5 | The TUI MUST respect `--no-color` and the `NO_COLOR` environment variable.                                                                              | Should   | Test          |

### 3.2 Operator Command Interface

| ID    | Command                   | Requirement                                                                                  | Priority |
| ----- | ------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| CMD-1 | `/start <server>`         | The system MUST start the selected or named configured server when validation succeeds.      | Must     |
| CMD-2 | `/stop <server>`          | The system MUST stop the selected or named running server.                                   | Must     |
| CMD-3 | `/restart <server>`       | The system MUST stop then start the selected or named server.                                | Must     |
| CMD-4 | `/chat <agent> <message>` | The system SHOULD let the operator send a message to a configured server-scoped agent.       | Should   |
| CMD-5 | `/session`                | The system SHOULD expose session management from the TUI.                                    | Should   |
| CMD-6 | `/resume <id>`            | The system SHOULD resume a prior session by session ID.                                      | Should   |
| CMD-7 | `/clear`                  | The system SHOULD clear or reset the current session context.                                | Should   |
| CMD-8 | `/help`                   | The system MUST list available TUI commands with one-line descriptions.                      | Must     |
| CMD-9 | Server command input      | The system MUST allow the operator to send arbitrary commands to a running server via stdin. | Must     |

### 3.3 In-Game Chat Interface

| ID     | Requirement                                                                                                    | Priority | Verification |
| ------ | -------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| CHAT-1 | The system MUST detect in-game agent triggers from vanilla Minecraft log lines containing `@<alias>` mentions. | Must     | Test         |
| CHAT-2 | The system MUST support `!help` in-game and MUST mirror the available in-game command help.                    | Must     | Test         |
| CHAT-3 | The system MUST silently ignore unauthorized, invalid, or rate-limited in-game mentions.                       | Must     | Test         |

### 3.4 Configuration File Interface

| ID      | Requirement                                                                                                                                 | Priority | Verification |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| CFGIF-1 | The system MUST load `config.yaml` from the application configuration location if the file exists.                                          | Must     | Test         |
| CFGIF-2 | If `config.yaml` is absent at startup, the system MUST start with an empty state containing no configured servers and no configured agents. | Must     | Test         |
| CFGIF-3 | Configuration keys MUST use camelCase.                                                                                                      | Must     | Inspection   |
| CFGIF-4 | Config references to secrets MUST use environment variable syntax such as `${OPENAI_API_KEY}`.                                              | Must     | Test         |
| CFGIF-5 | The system MUST ship an example `config.yaml` as documentation.                                                                             | Must     | Inspection   |

### 3.5 Environment Variable Interface

| Variable                          | Default          | Requirement                                                                                                     |
| --------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `EXPLORERS_CLI_DATA_DIR`          | Application root | The system MUST use this variable to override the data directory when set.                                      |
| `EXPLORERS_CLI_SHUTDOWN_TIMEOUT`  | `30` seconds     | The system MUST use this variable to configure forced termination timeout after graceful stop.                  |
| `EXPLORERS_CLI_SESSION_RETENTION` | `30` days        | The system SHOULD use this variable to configure automatic session pruning.                                     |
| Provider API keys                 | None             | The system MUST resolve provider credentials from environment variables only.                                   |
| RCON passwords                    | None             | If RCON is added in a future version, RCON passwords MUST be environment-variable based and MUST NOT be logged. |

### 3.6 Minecraft Process Interface

| ID     | Requirement                                                                                                                 | Priority | Verification     |
| ------ | --------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| MCIF-1 | The system MUST start servers by spawning the configured Java executable with `-Xms<ram>M -Xmx<ram>M -jar <jarFile> nogui`. | Must     | Integration test |
| MCIF-2 | The system MUST set the child process working directory to the server's configured `path`.                                  | Must     | Integration test |
| MCIF-3 | The system MUST stop servers by writing `/stop` to process stdin before forced termination is attempted.                    | Must     | Integration test |
| MCIF-4 | The system MUST read stdout and stderr for log rendering, chat parsing, startup readiness detection, and crash detection.   | Must     | Integration test |
| MCIF-5 | The system MUST NOT require RCON for v1 operation.                                                                          | Must     | Inspection       |

### 3.7 LLM Provider Interface

| ID      | Requirement                                                                                           | Priority | Verification     |
| ------- | ----------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| LLMIF-1 | The system SHOULD support OpenAI, Anthropic, and OpenAI-compatible provider configurations.           | Should   | Integration test |
| LLMIF-2 | The system MUST NOT log provider API keys.                                                            | Must     | Security test    |
| LLMIF-3 | The system MUST cancel or abandon in-flight agent requests when the configured agent timeout expires. | Must     | Test             |

---

## 4. Specific Requirements

### 4.1 Configuration and Registration Requirements

| ID         | Requirement                                                                                                                                                                       | Priority | Verification  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| FR-CFG-001 | The system MUST allow configuration of up to 10 Minecraft servers in `config.yaml`.                                                                                               | Must     | Test          |
| FR-CFG-002 | Loading more than 10 configured servers MUST fail validation with a clear error.                                                                                                  | Must     | Test          |
| FR-CFG-003 | Server names MUST be unique across the active configuration.                                                                                                                      | Must     | Test          |
| FR-CFG-004 | Each server entry MUST include `id`, `name`, `path`, `jarFile`, `ram`, `javaPath`, `serverPort`, `maxPlayers`, and `levelName`.                                                   | Must     | Test          |
| FR-CFG-005 | `server.id`, `agent.id`, and `provider.name` MUST match `^[a-zA-Z0-9_-]{1,32}$`.                                                                                                  | Must     | Test          |
| FR-CFG-006 | `serverPort` MUST be in the range 1024 to 65535.                                                                                                                                  | Must     | Test          |
| FR-CFG-007 | `maxPlayers` MUST be in the range 1 to 100 and SHOULD default to 20 where a default is applicable.                                                                                | Must     | Test          |
| FR-CFG-008 | `ram` MUST be in the range 512 MB to 32768 MB and SHOULD default to 1024 MB where a default is applicable.                                                                        | Must     | Test          |
| FR-CFG-009 | `startupTimeout` MUST be in the range 30 to 600 seconds and MUST default to 120 seconds.                                                                                          | Must     | Test          |
| FR-CFG-010 | If `schemaVersion` is omitted, the system MUST treat the configuration as schema version 1.                                                                                       | Must     | Test          |
| FR-CFG-011 | If `schemaVersion` indicates an unknown future version, the system MUST warn and MUST NOT fail solely because of the version value.                                               | Should   | Test          |
| FR-CFG-012 | An unresolved environment variable reference such as `${MISSING_VAR}` MUST cause a validation error naming the offending key.                                                     | Must     | Test          |
| FR-CFG-013 | The system SHOULD allow editing selected `server.properties` keys from the TUI without rewriting the entire file. The selected keys are `server-port`, `max-players`, and `motd`. | Should   | Demonstration |

### 4.2 Hot-Reload Requirements

| ID         | Requirement                                                                                                                   | Priority | Verification |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| FR-HOT-001 | The system SHOULD watch `config.yaml` for changes and hot-reload without restarting the TUI.                                  | Should   | Test         |
| FR-HOT-002 | Hot-reload MUST tolerate atomic-save patterns by retrying reads when `ENOENT` occurs during write-temp-rename sequences.      | Must     | Test         |
| FR-HOT-003 | If hot-reload validation fails, the system MUST keep the previous configuration fully active.                                 | Must     | Test         |
| FR-HOT-004 | If hot-reload validation fails, the TUI MUST show which entries failed validation.                                            | Must     | Test         |
| FR-HOT-005 | Adding or removing an agent MUST apply immediately on successful hot-reload.                                                  | Must     | Test         |
| FR-HOT-006 | Changing agent permissions, agent rate limits, or player permissions MUST apply immediately on successful hot-reload.         | Must     | Test         |
| FR-HOT-007 | Changing feature flags MUST apply immediately on successful hot-reload.                                                       | Must     | Test         |
| FR-HOT-008 | Adding a new server MUST apply immediately and make the server available to start.                                            | Must     | Test         |
| FR-HOT-009 | Changes to server port, JAR path, RAM, or Java path MUST apply on the next server restart, not to an already running process. | Must     | Test         |
| FR-HOT-010 | Removing a running server from config MUST be blocked until the server is stopped.                                            | Must     | Test         |

### 4.3 Server Lifecycle Requirements

| ID         | Requirement                                                                                                                                                                                                  | Priority | Verification     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------- |
| FR-SRV-001 | The system MUST start a configured server by spawning a Java process with configured parameters.                                                                                                             | Must     | Integration test |
| FR-SRV-002 | The system MUST require an explicit `jarFile` per server and MUST NOT auto-detect server JAR files.                                                                                                          | Must     | Test             |
| FR-SRV-003 | The system MUST validate that `jarFile` exists before start. If absent, it MUST refuse to start and show `JAR not found at: <path>`.                                                                         | Must     | Test             |
| FR-SRV-004 | The system MUST require `jarFile` to resolve inside the canonical `server.path`, whether configured as relative or absolute.                                                                                 | Must     | Security test    |
| FR-SRV-005 | The system MUST validate that `javaPath` exists and is executable. `javaPath` MUST NOT be constrained to `server.path`.                                                                                      | Must     | Test             |
| FR-SRV-006 | The system MUST spawn the server process with `cwd = <server.path>`.                                                                                                                                         | Must     | Integration test |
| FR-SRV-007 | The system MUST pass both `-Xms` and `-Xmx` JVM flags using the configured RAM value.                                                                                                                        | Must     | Integration test |
| FR-SRV-008 | The system MUST verify that the configured port is not in use by any process before starting. If busy, start MUST be refused with a clear error.                                                             | Must     | Test             |
| FR-SRV-009 | The system MUST detect `RUNNING` state only after observing the vanilla `Done (x.xxxs)! For help, type "help"` log line.                                                                                     | Must     | Integration test |
| FR-SRV-010 | If the `Done` line is not detected within `startupTimeout`, the system MUST mark the server `FAILED` and show `Server did not become ready within <timeout>s`.                                               | Must     | Test             |
| FR-SRV-011 | If the process exits while in `STARTING` before the `Done` line is observed, the system MUST mark the server `FAILED` regardless of exit code and show `Server exited before becoming ready (exit code: X)`. | Must     | Test             |
| FR-SRV-012 | The system MUST stop a running server by sending `/stop` to stdin.                                                                                                                                           | Must     | Integration test |
| FR-SRV-013 | If a server does not exit within the configured shutdown timeout after `/stop`, the system MUST force-kill the process using SIGTERM on POSIX or `taskkill /T /F` on Windows.                                | Must     | Integration test |
| FR-SRV-014 | The system MUST detect non-zero server process exits and reflect crash status in the dashboard within 2 seconds.                                                                                             | Must     | Integration test |
| FR-SRV-015 | The system MUST support restarting a server by stopping it and then starting it.                                                                                                                             | Must     | Test             |
| FR-SRV-016 | After a successful restart, the system MUST clear `lastError`.                                                                                                                                               | Must     | Test             |
| FR-SRV-017 | If server stdin closes unexpectedly, the system MUST log a warning, notify the operator in the TUI, and MUST NOT crash.                                                                                      | Must     | Test             |
| FR-SRV-018 | The system MUST track managed server PIDs in `data/pids.json`.                                                                                                                                               | Must     | Test             |
| FR-SRV-019 | On startup, the system MUST kill stale PIDs from `data/pids.json` before normal operation begins.                                                                                                            | Must     | Test             |
| FR-SRV-020 | The system MUST prevent multiple active instances using a file lock.                                                                                                                                         | Must     | Test             |

### 4.4 Feature Flag Requirements

| ID         | Requirement                                                                             | Priority | Verification |
| ---------- | --------------------------------------------------------------------------------------- | -------- | ------------ |
| FR-FLG-001 | The system MUST support feature flags in `config.yaml` to enable or disable subsystems. | Should   | Test         |
| FR-FLG-002 | The `audioplayer` feature flag MUST default to `false`.                                 | Should   | Test         |
| FR-FLG-003 | When `audioplayer` is disabled, music-related UI and commands MUST be hidden.           | Should   | Test         |

### 4.5 Provider and Agent Configuration Requirements

| ID         | Requirement                                                                                                                                               | Priority | Verification |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| FR-AGT-001 | The system SHOULD support configuring one or more LLM providers.                                                                                          | Should   | Test         |
| FR-AGT-002 | Each provider MUST be configurable with `name`, `type`, `baseUrl`, `model`, and `apiKey` environment variable reference.                                  | Should   | Test         |
| FR-AGT-003 | The system MUST support configuring multiple agents, each associated with a configured provider.                                                          | Should   | Test         |
| FR-AGT-004 | Each agent MUST have `id`, `name`, `alias`, `provider`, `systemPrompt`, `tools[]`, `timeout`, `commandAllowlist`, `rateLimit`, and `ingameMessageWindow`. | Should   | Test         |
| FR-AGT-005 | The system MUST start with zero agents by default.                                                                                                        | Must     | Test         |
| FR-AGT-006 | The system MUST NOT ship built-in or predefined agents.                                                                                                   | Must     | Inspection   |
| FR-AGT-007 | Agent aliases MUST be at least 2 characters and MUST match `^[a-zA-Z0-9_-]{2,}$`. Invalid aliases MUST fail config validation.                            | Must     | Test         |
| FR-AGT-008 | Agent `timeout` MUST be in the range 10 to 600 seconds and MUST default to 120 seconds.                                                                   | Must     | Test         |
| FR-AGT-009 | Agent `rpm` MUST be in the range 1 to 60 and MUST default to 10.                                                                                          | Must     | Test         |
| FR-AGT-010 | Agent `cooldown` MUST be in the range 0 to 300 seconds and MUST default to 0.                                                                             | Must     | Test         |
| FR-AGT-011 | Agent `ingameMessageWindow` MUST be in the range 0 to 50 and MUST default to 10.                                                                          | Must     | Test         |

### 4.6 In-Game Chat Parsing and Permissions Requirements

| ID          | Requirement                                                                                                                                    | Priority | Verification  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| FR-CHAT-001 | Chat parsing MUST target only vanilla Minecraft log lines matching `[timestamp] [Server thread/INFO]: <playername> message`.                   | Must     | Test          |
| FR-CHAT-002 | Non-matching log lines MUST be silently skipped for chat-trigger purposes.                                                                     | Must     | Test          |
| FR-CHAT-003 | The parsing flow MUST be: match vanilla log format, check for `@<alias>`, parse player name, check permission, check rate limit, invoke agent. | Must     | Test          |
| FR-CHAT-004 | When a message contains multiple `@alias` tokens, the system MUST invoke only the first matching alias and ignore later aliases.               | Must     | Test          |
| FR-CHAT-005 | Team prefix and suffix MUST be configurable per player and SHOULD be stripped before player-name matching.                                     | Should   | Test          |
| FR-CHAT-006 | Player names MUST be sanitized to max 16 characters using only `a-zA-Z0-9_`. Invalid names MUST be rejected.                                   | Must     | Security test |
| FR-CHAT-007 | Player permission checks MUST be case-insensitive.                                                                                             | Must     | Test          |
| FR-CHAT-008 | If a player is not listed under `permissions.<serverId>.players`, the system MUST deny all in-game agent access for that player.               | Must     | Security test |
| FR-CHAT-009 | The system MUST enforce per-agent rate limits using `rpm` and `cooldown`.                                                                      | Must     | Test          |
| FR-CHAT-010 | Unauthorized, invalid, and rate-limited mentions MUST be silently ignored.                                                                     | Must     | Test          |
| FR-CHAT-011 | The system MUST inject the N most recent chat messages preceding the `@mention`, excluding the mention itself, when invoking an agent.         | Must     | Test          |

### 4.7 Agent Invocation and Response Delivery Requirements

| ID         | Requirement                                                                                                                                                                                       | Priority | Verification     |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| FR-INV-001 | The system MUST invoke the selected configured agent after permissions and rate limits pass.                                                                                                      | Must     | Integration test |
| FR-INV-002 | The system MUST stream agent responses token-by-token to the TUI chat panel.                                                                                                                      | Must     | Test             |
| FR-INV-003 | If an agent invocation reaches its timeout, the system MUST cancel or abandon the in-flight request, send any partial response with a timeout warning, log the event, and keep the session valid. | Must     | Test             |
| FR-INV-004 | For in-game delivery, the system MUST wrap agent plain-text output in `/tellraw` JSON.                                                                                                            | Must     | Integration test |
| FR-INV-005 | If `/tellraw` delivery failure is detected, the system MUST fall back to `/say`.                                                                                                                  | Must     | Integration test |
| FR-INV-006 | The system MUST always attempt `/tellraw` first for each response and MUST NOT latch into `/say` mode.                                                                                            | Must     | Test             |
| FR-INV-007 | In-game agent responses MUST be visible to all players. Private messaging is not required for v1.                                                                                                 | Must     | Demonstration    |
| FR-INV-008 | Minecraft formatting code markers `section-sign` and `&` in agent output MUST be stripped before in-game delivery.                                                                                | Must     | Security test    |
| FR-INV-009 | Long in-game responses MUST be split into chunks of at most 200 characters before delivery.                                                                                                       | Must     | Test             |
| FR-INV-010 | Message splitting MUST prefer sentence boundaries, then clause boundaries, then word boundaries, and MUST NOT split mid-word.                                                                     | Must     | Test             |
| FR-INV-011 | Split message chunks MUST be sent with a 500 ms delay between chunks.                                                                                                                             | Must     | Test             |
| FR-INV-012 | The operator MUST be able to chat with an agent via the TUI while the selected server is stopped.                                                                                                 | Must     | Test             |
| FR-INV-013 | Operator-initiated TUI chat with an offline server MUST NOT attempt in-game delivery.                                                                                                             | Must     | Test             |

### 4.8 Session Requirements

| ID         | Requirement                                                                                                                                | Priority | Verification  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------- |
| FR-SES-001 | The system MUST persist agent sessions in SQLite at `data/sessions.db`.                                                                    | Must     | Test          |
| FR-SES-002 | SQLite WAL mode MUST be used to prevent corruption during concurrent agent invocations.                                                    | Must     | Test          |
| FR-SES-003 | Sessions MUST be keyed by `serverId + agentId`.                                                                                            | Must     | Test          |
| FR-SES-004 | All players and the TUI operator MUST share one session context per server and agent.                                                      | Must     | Test          |
| FR-SES-005 | Operator messages MUST use `playerContext: { playerName: "operator" }`.                                                                    | Must     | Test          |
| FR-SES-006 | Session IDs MUST append a random suffix to timestamp-based IDs to guarantee uniqueness within the same millisecond.                        | Must     | Test          |
| FR-SES-007 | Each session entry MUST include `role`, `content`, `timestamp`, and `playerContext`.                                                       | Must     | Test          |
| FR-SES-008 | Player context for v1 MUST be an extensible object with at least `{ playerName: string }`.                                                 | Must     | Test          |
| FR-SES-009 | Sessions older than `sessionRetention` SHOULD be pruned automatically on startup and once every 24 hours while the application is running. | Should   | Test          |
| FR-SES-010 | The system SHOULD support `/session`, `/resume`, and `/clear` commands for session management.                                             | Should   | Demonstration |
| FR-SES-011 | `/resume` with no arguments SHOULD list the last 20 available session IDs for the current server and agent.                                | Should   | Demonstration |

### 4.9 Agent Tool Authorization and File Safety Requirements

| ID          | Requirement                                                                                                                                                                                                       | Priority | Verification    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------- |
| FR-TOOL-001 | The system MUST support custom tool definitions for agents.                                                                                                                                                       | Should   | Demonstration   |
| FR-TOOL-002 | Agent tool authorization MUST be deny-by-default.                                                                                                                                                                 | Must     | Security test   |
| FR-TOOL-003 | Each agent MUST have a `commandAllowlist` on `AgentConfig`; `ServerConfig` MUST NOT define `commandAllowlist`.                                                                                                    | Must     | Test            |
| FR-TOOL-004 | Command matching MUST strip a leading `/`, normalize to lowercase, collapse whitespace, tokenize by whitespace, and compare the incoming command's first N tokens exactly against the allowlist entry's N tokens. | Must     | Security test   |
| FR-TOOL-005 | Commands not authorized by token-prefix matching MUST be rejected and MUST NOT be sent to the server.                                                                                                             | Must     | Security test   |
| FR-TOOL-006 | While a server is `RUNNING`, agent tools MUST NOT move or delete files inside the server directory.                                                                                                               | Must     | Security test   |
| FR-TOOL-007 | While a server is `RUNNING`, agent tools MUST NOT write NBT files.                                                                                                                                                | Must     | Security test   |
| FR-TOOL-008 | Agent filesystem access MUST be sandboxed to the canonical `server.path`.                                                                                                                                         | Must     | Security test   |
| FR-TOOL-009 | Symlinks resolving outside `server.path` MUST be blocked.                                                                                                                                                         | Must     | Security test   |
| FR-TOOL-010 | Cross-server filesystem access by agent tools MUST NOT be allowed.                                                                                                                                                | Must     | Security test   |
| FR-TOOL-011 | All agent-executed commands and file operations MUST be logged for audit.                                                                                                                                         | Must     | Inspection/Test |
| FR-TOOL-012 | The system MUST NOT require human-in-the-loop approval for destructive agent actions in v1.                                                                                                                       | Must     | Inspection      |

### 4.10 Deferred Audioplayer Requirements

| ID         | Requirement                                                                                                                                                                                        | Priority | Verification |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ |
| FR-DEF-001 | The system MUST NOT implement music playback via Audioplayer mod in v1.                                                                                                                            | Won't    | Inspection   |
| FR-DEF-002 | The system MUST NOT implement music search, download, metadata persistence, in-game music controls, library management, queue management, or volume controls in v1.                                | Won't    | Inspection   |
| FR-DEF-003 | When music features are implemented in a future version, the `audioplayer` feature flag MUST default to `false`.                                                                                   | Won't    | Future spec  |
| FR-DEF-004 | When music features are implemented in a future version and the Audioplayer mod is unavailable, commands MUST fail gracefully with `The Audioplayer mod isn't available on this server right now.` | Won't    | Future spec  |

---

## 5. Non-Functional Requirements

### 5.1 Compatibility and Platform Requirements

| ID           | Category     | Requirement                                                                                                     | Priority | Verification       |
| ------------ | ------------ | --------------------------------------------------------------------------------------------------------------- | -------- | ------------------ |
| NFR-COMP-001 | Platform     | The system MUST run on Windows 10+ and Linux, including Ubuntu 20.04+ and Debian 11+.                           | Must     | Integration test   |
| NFR-COMP-002 | Distribution | The system MUST be distributable as a single binary or npm package.                                             | Must     | Build verification |
| NFR-COMP-003 | Minecraft    | The system MUST support vanilla Minecraft Java Edition 1.20+ servers.                                           | Must     | E2E test           |
| NFR-COMP-004 | Privileges   | The system SHOULD support running as a non-administrator user on Windows and Linux.                             | Should   | Integration test   |
| NFR-COMP-005 | Installation | The system SHOULD provide documented installation steps, including Java dependency notes for Minecraft servers. | Should   | Inspection         |

### 5.2 Performance and Capacity Requirements

Formal performance benchmarking is deferred to post-v1. The following quantified performance targets are v1 engineering guidelines unless marked Must.

| ID           | Category         | Requirement                                                                                                                                                  | Priority | Verification           |
| ------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------------------- |
| NFR-PERF-001 | Log rendering    | Log rendering latency SHOULD be less than 100 ms p99 under 10 servers x 100 lines/sec.                                                                       | Should   | Performance smoke test |
| NFR-PERF-002 | Hot-reload       | Hot-reload SHOULD complete within 2 seconds with 10 configured servers.                                                                                      | Should   | Performance smoke test |
| NFR-PERF-003 | Memory           | TUI RSS SHOULD remain below 200 MB with 10 idle servers and below 500 MB with 10 actively logging servers.                                                   | Should   | Performance smoke test |
| NFR-PERF-004 | Log ingestion    | The system MUST rate-limit stdout parsing to a configurable per-server `maxLinesPerSecond`, default 5000, and MUST expose dropped-line count in the UI.      | Must     | Load test              |
| NFR-PERF-005 | Startup          | Cold start SHOULD complete in less than 3 seconds on a mid-range machine.                                                                                    | Should   | Performance smoke test |
| NFR-PERF-006 | Session database | The session database SHOULD provide indexes for `(serverId, agentId)`, `(timestamp)`, and `(sessionId)`.                                                     | Should   | Inspection             |
| NFR-CAP-001  | Server count     | The system MUST support up to 10 configured servers and MUST reject configurations with more than 10 servers.                                                | Must     | Test                   |
| NFR-CAP-002  | Session length   | A session SHOULD support up to 10,000 messages before archival is required. Longer sessions SHOULD be auto-archived or pruned according to retention policy. | Should   | Test                   |

### 5.3 Reliability Requirements

| ID          | Category            | Requirement                                                                                                                                                 | Priority | Verification     |
| ----------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------- |
| NFR-REL-001 | Process cleanup     | The system MUST attempt to kill all managed server processes on graceful exit or handled crash using OS process groups on Linux and job objects on Windows. | Must     | Integration test |
| NFR-REL-002 | Hard-crash recovery | On next launch after a hard crash, the system MUST kill stale PIDs from `data/pids.json` before normal operation begins.                                    | Must     | Integration test |
| NFR-REL-003 | PID tracking        | The system MUST maintain `data/pids.json` with `{ serverId: pid }` entries for managed server processes.                                                    | Must     | Test             |
| NFR-REL-004 | Session durability  | Session writes MUST use SQLite WAL mode. No JSONL session persistence is required.                                                                          | Must     | Test             |
| NFR-REL-005 | Crash status        | Server crashes MUST be reflected in the TUI.                                                                                                                | Must     | Test             |
| NFR-REL-006 | Log buffer          | The system MUST limit the in-process log buffer to configurable `maxBufferBytes`, default 16 MB per server.                                                 | Must     | Test             |
| NFR-REL-007 | Config deletion     | If `config.yaml` is deleted while running, the system SHOULD keep current state and MUST NOT crash.                                                         | Should   | Test             |

### 5.4 Security Requirements

| ID          | Category         | Requirement                                                                                                                 | Priority | Verification  |
| ----------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| NFR-SEC-001 | Path validation  | `server.path` MUST be canonicalized and used as the sandbox root.                                                           | Must     | Security test |
| NFR-SEC-002 | Path validation  | `jarFile` MUST resolve inside canonical `server.path`.                                                                      | Must     | Security test |
| NFR-SEC-003 | Path validation  | Agent file tool paths MUST resolve inside canonical `server.path`. Symlinks outside the root MUST be blocked.               | Must     | Security test |
| NFR-SEC-004 | Path validation  | `javaPath` MUST be validated as an existing executable file and MUST NOT be constrained to `server.path`.                   | Must     | Security test |
| NFR-SEC-005 | Authorization    | In-game player names MUST be validated case-insensitively against `permissions.<serverId>.players` before agent invocation. | Must     | Security test |
| NFR-SEC-006 | Input validation | In-game player names MUST be limited to `a-zA-Z0-9_` and 16 characters.                                                     | Must     | Security test |
| NFR-SEC-007 | Secrets          | Secrets MUST exist only in `.env` or process environment variables and MUST NOT be logged.                                  | Must     | Security test |
| NFR-SEC-008 | Prompt privacy   | Full agent prompts and responses SHOULD NOT be logged at INFO level by default.                                             | Should   | Inspection    |
| NFR-SEC-009 | Read-only mode   | The system SHOULD support a `--read-only` mode that disables TUI chat for kiosk or shared-host use.                         | Could    | Demonstration |
| NFR-SEC-010 | Unicode          | Player names and chat content MUST be treated as UTF-8.                                                                     | Must     | Test          |

### 5.5 Observability Requirements

| ID          | Category      | Requirement                                                                                                             | Priority | Verification    |
| ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------- | -------- | --------------- |
| NFR-OBS-001 | App logs      | The system SHOULD emit structured JSON logs at `logs/explorers-cli.log` with configurable verbosity and 50 MB rotation. | Should   | Inspection/Test |
| NFR-OBS-002 | Telemetry     | `@infinityi/forge` telemetry MUST be opt-in, off by default, with a clear consent flag in `config.yaml`.                | Must     | Test            |
| NFR-OBS-003 | Crash reports | Crash reports SHOULD be written to `crash-<timestamp>.json` on uncaught exceptions.                                     | Should   | Test            |
| NFR-OBS-004 | Audit logs    | Agent-executed commands and file operations MUST be logged with timestamp, agent ID, server ID, and player name.        | Must     | Test            |
| NFR-OBS-005 | Server logs   | The application MUST NOT write Minecraft server logs; Minecraft remains responsible for `<server.path>/logs/`.          | Must     | Inspection      |

### 5.6 Maintainability, Privacy, and Compliance Requirements

| ID           | Category                | Requirement                                                                                                                              | Priority | Verification  |
| ------------ | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------- |
| NFR-MNT-001  | Extensibility           | Custom tool registration SHOULD be documented as a public API or plugin folder pattern.                                                  | Should   | Inspection    |
| NFR-MNT-002  | Release management      | The system SHOULD publish a CHANGELOG and follow semantic versioning from v1.0.0.                                                        | Should   | Inspection    |
| NFR-MNT-003  | Validation tooling      | The system SHOULD provide `--validate-config`, which exits 0 for valid config and non-zero for invalid config without launching the TUI. | Should   | Test          |
| NFR-PRV-001  | Local storage           | Session data containing player messages MUST be stored locally only.                                                                     | Must     | Inspection    |
| NFR-PRV-002  | Telemetry privacy       | Player content MUST NOT be sent in telemetry.                                                                                            | Must     | Security test |
| NFR-COMP-006 | EULA                    | The README SHOULD include a Minecraft EULA compliance note stating that the operator is responsible for EULA acceptance.                 | Should   | Inspection    |
| NFR-COMP-007 | Future music compliance | Future music search MUST only return content with redistribution rights compatible with in-game playback.                                | Must     | Future spec   |

---

## 6. Data Requirements

### 6.1 Configuration Data Model

The following TypeScript-like schemas define the required shape of `config.yaml`. They are normative for fields, types, ranges, defaults, and relationships, not for implementation language.

```typescript
interface ConfigRoot {
  schemaVersion?: number; // omitted means 1
  featureFlags?: {
    audioplayer?: boolean; // default false
  };
  telemetry?: {
    enabled: boolean; // default false
  };
  servers?: ServerConfig[]; // max 10
  providers?: ProviderConfig[];
  agents?: AgentConfig[];
  permissions?: Record<string, ServerPermissions>; // key = serverId
}

interface ServerConfig {
  id: string; // ^[a-zA-Z0-9_-]{1,32}$
  name: string; // unique across config
  path: string; // canonicalized sandbox root
  jarFile: string; // relative or absolute, must resolve inside path
  ram: number; // MB, 512..32768, default 1024 where applicable
  javaPath: string; // existing executable, not constrained to path
  serverPort: number; // 1024..65535
  maxPlayers: number; // 1..100, default 20 where applicable
  levelName: string;
  startupTimeout?: number; // seconds, 30..600, default 120
}

interface ProviderConfig {
  name: string; // ^[a-zA-Z0-9_-]{1,32}$
  type: "openai" | "anthropic" | "openai-compatible";
  baseUrl?: string;
  model: string;
  apiKey: string; // env var reference, e.g. ${OPENAI_API_KEY}
}

interface AgentConfig {
  id: string; // ^[a-zA-Z0-9_-]{1,32}$
  name: string;
  alias: string; // ^[a-zA-Z0-9_-]{2,}$
  provider: string; // ProviderConfig.name
  systemPrompt: string;
  tools: string[];
  timeout?: number; // seconds, 10..600, default 120
  commandAllowlist: string[];
  rateLimit?: {
    rpm?: number; // 1..60, default 10
    cooldown?: number; // seconds, 0..300, default 0
  };
  ingameMessageWindow?: number; // 0..50, default 10
}

interface ServerPermissions {
  players: PlayerConfig[];
}

interface PlayerConfig {
  name: string;
  teamPrefix?: string;
  teamSuffix?: string;
  agents: string[]; // AgentConfig.id entries this player can access
  inGameAdmin?: boolean;
}
```

### 6.2 Runtime State Model

```typescript
interface ServerState {
  status: "stopped" | "starting" | "running" | "stopping" | "failed";
  pid: number | null;
  startTime: string | null; // ISO 8601
  lastSuccessfulStart: string | null; // ISO 8601
  restartCount: number;
  lastError: string | null;
}
```

### 6.3 Session Store Model

The session store MUST be SQLite at `data/sessions.db`. The schema MUST represent at least the following fields:

```typescript
interface SessionEntry {
  id: number; // auto-increment primary key
  sessionId: string; // timestamp plus random suffix
  serverId: string;
  agentId: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string; // ISO 8601
  playerContext: PlayerContext;
}

interface PlayerContext {
  playerName: string; // player name, or "operator" for TUI-originated messages
}
```

The session key for active context MUST be `serverId + agentId`. All players and the operator share this context for a server-agent pair.

### 6.4 PID Tracking Model

`data/pids.json` MUST contain a JSON object mapping server IDs to process IDs:

```json
{
  "survival": 12345,
  "creative": 67890
}
```

The system MUST kill listed PIDs on startup before normal operation. The PID reuse risk is accepted in LIM-7.

---

## 7. Behavioral Requirements

### 7.1 Server State Machine

The system MUST represent server lifecycle using the following states:

| State      | Meaning                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| `stopped`  | No managed Java process is running for the server.                                         |
| `starting` | A Java process has been spawned and the system is waiting for the vanilla `Done` log line. |
| `running`  | The vanilla `Done` log line was observed.                                                  |
| `stopping` | A stop command was sent and the system is waiting for process exit.                        |
| `failed`   | Startup, runtime, or crash failure occurred.                                               |

Required transitions:

| From       | To         | Trigger                                                      |
| ---------- | ---------- | ------------------------------------------------------------ |
| `stopped`  | `starting` | Start command passes validation and Java process is spawned. |
| `starting` | `running`  | Vanilla `Done` log line observed.                            |
| `starting` | `failed`   | `startupTimeout` expires before `Done` is observed.          |
| `starting` | `failed`   | Process exits before `Done`, regardless of exit code.        |
| `running`  | `stopping` | Stop command issued.                                         |
| `running`  | `failed`   | Non-zero process exit detected.                              |
| `stopping` | `stopped`  | Process exits, either gracefully or after force kill.        |
| `failed`   | `starting` | Restart command issued and validation passes.                |

### 7.2 Chat Parsing Flow

The system MUST process each server log line for in-game agent triggers in this order:

1. Match the vanilla chat log format.
2. Check for `@<alias>` presence.
3. If multiple aliases are present, select only the first matching alias.
4. Parse raw player name from the first angle-bracket pair.
5. Strip configured team prefix and suffix where configured.
6. Validate player name against the required player-name format.
7. Check player permission for the server and agent.
8. Check per-agent rate limit for the player and agent.
9. Build agent context using session history and recent chat messages before the mention.
10. Invoke the agent.

### 7.3 Command Allowlist Matching

For agent-issued Minecraft commands, the system MUST perform token-prefix matching as follows:

1. Strip one leading `/` if present.
2. Convert command text to lowercase.
3. Collapse repeated whitespace to single spaces.
4. Tokenize by whitespace.
5. Tokenize the allowlist entry the same way.
6. Authorize only when the incoming command's first N tokens exactly equal the N tokens of the allowlist entry.

Example: allowlist entry `data modify` authorizes `data modify entity ...` and rejects `data get block 0 0 0`.

### 7.4 Response Delivery Flow

For in-game responses, the system MUST:

1. Collect the full agent response before in-game delivery.
2. Strip Minecraft formatting code markers before delivery.
3. Split text into chunks of at most 200 characters.
4. Prefer sentence, clause, then word boundaries when splitting.
5. Serialize each chunk as `/tellraw` JSON.
6. Send chunks with 500 ms delay between chunks.
7. Fall back to `/say` if `/tellraw` delivery failure is detected.
8. Save the response to session and stream it to the TUI regardless of in-game delivery outcome.

---

## 8. Error Handling Requirements

| Condition                          | Required Handling                                 | Observable Result                                                                 |
| ---------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| Missing config on startup          | Start with empty state.                           | TUI opens with no configured servers or agents.                                   |
| Invalid config on startup          | Reject config.                                    | TUI or CLI shows validation errors naming offending keys.                         |
| Invalid hot-reload config          | Keep previous active config.                      | TUI shows failed entries and previous config remains active.                      |
| Atomic-save race                   | Retry read when `ENOENT` occurs.                  | No crash during temp-file rename.                                                 |
| Config deleted while running       | Keep current active state.                        | No crash; operator can continue current session.                                  |
| JAR not found                      | Refuse start.                                     | Error `JAR not found at: <path>`; server remains `stopped`.                       |
| Port in use                        | Refuse start.                                     | Clear port-conflict error; server remains `stopped`.                              |
| Startup timeout                    | Mark failed.                                      | Error `Server did not become ready within <timeout>s`.                            |
| Process exits during startup       | Mark failed.                                      | Error `Server exited before becoming ready (exit code: X)`.                       |
| Server non-zero exit while running | Mark failed within 2 seconds.                     | Dashboard shows `failed`.                                                         |
| Stop timeout                       | Force kill process.                               | Dashboard shows `stopped`; TUI shows warning.                                     |
| stdin closed unexpectedly          | Log warning and notify operator.                  | TUI remains running.                                                              |
| Agent timeout                      | Cancel or abandon request and keep session valid. | Partial response plus timeout warning where available; event logged.              |
| Agent command not in allowlist     | Reject command.                                   | Command not executed; agent receives error; audit log entry written.              |
| File move/delete while running     | Reject operation.                                 | Agent receives error; audit log entry written.                                    |
| NBT write while running            | Reject operation.                                 | Agent receives error; audit log entry written.                                    |
| Symlink outside server root        | Reject operation.                                 | Agent receives error; audit log entry written.                                    |
| `/tellraw` delivery failure        | Fall back to `/say` when detected.                | Warning logged; response still saved and shown in TUI.                            |
| Invalid player name                | Ignore mention.                                   | No in-game feedback.                                                              |
| Player not permitted               | Ignore mention.                                   | No in-game feedback.                                                              |
| Rate limit exceeded                | Ignore mention.                                   | No in-game feedback.                                                              |
| Disk full                          | Surface write failure.                            | TUI shows storage error; operation fails safely.                                  |
| Java version mismatch              | Surface Minecraft startup failure.                | Logs show Minecraft error; server enters failed or remains stopped as applicable. |
| Another instance running           | Exit second instance.                             | Error `Another instance is already running`.                                      |
| Orphaned PIDs on startup           | Kill listed PIDs.                                 | TUI shows count of cleaned-up processes.                                          |

---

## 9. Acceptance Criteria

| ID     | Covered Requirements               | Acceptance Criterion                                                                                                                                                                                        |
| ------ | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-001 | FR-SRV-001, FR-SRV-009             | Given a valid server config, when the operator starts the server, then status becomes `running` after the vanilla `Done` log line is detected within `startupTimeout`.                                      |
| AC-002 | FR-SRV-003                         | Given a config with a missing JAR path, when start is requested, then the TUI shows `JAR not found at: <path>` and status remains `stopped`.                                                                |
| AC-003 | FR-SRV-008                         | Given a server port already in use, when start is requested, then start is refused with a port-conflict error and status remains `stopped`.                                                                 |
| AC-004 | FR-SRV-012                         | Given a responsive running server, when stop is requested, then status becomes `stopped` within 5 seconds.                                                                                                  |
| AC-005 | FR-SRV-013                         | Given a hanging running server, when stop is requested, then the system force-kills after configured timeout and status becomes `stopped`.                                                                  |
| AC-006 | FR-SRV-014                         | Given a running server, when the process exits non-zero, then the dashboard reflects `failed` within 2 seconds.                                                                                             |
| AC-007 | FR-SRV-016                         | Given a failed server, when restart succeeds, then `lastError` is cleared.                                                                                                                                  |
| AC-008 | FR-SRV-010                         | Given no `Done` line before `startupTimeout`, when timeout expires, then status becomes `failed` with timeout error.                                                                                        |
| AC-009 | FR-CFG-002                         | Given a config with 11 servers, when validation runs, then validation fails with a clear error.                                                                                                             |
| AC-010 | FR-CFG-003                         | Given duplicate server names, when validation runs, then validation fails.                                                                                                                                  |
| AC-011 | CFGIF-2                            | Given no `config.yaml`, when the app starts, then the TUI opens with an empty dashboard and no error.                                                                                                       |
| AC-012 | FR-CFG-012                         | Given unresolved `${MISSING_VAR}`, when validation runs, then validation fails naming the offending key.                                                                                                    |
| AC-013 | FR-HOT-003, FR-HOT-004             | Given an invalid hot-reload config, when reload runs, then previous config remains active and failed entries are shown.                                                                                     |
| AC-014 | FR-HOT-002                         | Given an editor atomic-save sequence, when hot-reload observes `ENOENT`, then the app retries and does not crash.                                                                                           |
| AC-015 | FR-HOT-006                         | Given changed agent permissions, when hot-reload succeeds, then the new permissions apply without server restart.                                                                                           |
| AC-016 | FR-HOT-009                         | Given changed server port, when hot-reload succeeds, then the running server keeps the old port until restart.                                                                                              |
| AC-017 | FR-CHAT-008, FR-INV-004            | Given a permitted player sends `@admin hello`, when parsing and invocation succeed, then an agent response is delivered through `/tellraw`.                                                                 |
| AC-018 | FR-CHAT-008, FR-CHAT-010           | Given an unlisted player sends `@admin hello`, when parsing runs, then no response is sent.                                                                                                                 |
| AC-019 | FR-AGT-007                         | Given alias `a`, when config validation runs, then validation fails.                                                                                                                                        |
| AC-020 | FR-CHAT-009                        | Given `rpm: 2` and `cooldown: 0`, when a player sends a third mention within 60 seconds, then the third mention is silently ignored.                                                                        |
| AC-021 | FR-INV-003                         | Given an agent exceeds configured timeout, when timeout is reached, then partial response with warning is sent where available and session remains valid.                                                   |
| AC-022 | FR-SES-002                         | Given two concurrent mentions from different players, when both write to session, then SQLite session data is not corrupted.                                                                                |
| AC-023 | FR-CHAT-004                        | Given `@admin hello @music play`, when parsing runs, then only `admin` is invoked.                                                                                                                          |
| AC-024 | CMD-8, CHAT-2                      | Given `/help` or `!help`, when help is requested, then available commands are listed with one-line descriptions.                                                                                            |
| AC-025 | FR-INV-009, FR-INV-010, FR-INV-011 | Given an agent response longer than 200 characters, when delivered in-game, then it is split at allowed boundaries with 500 ms between chunks.                                                              |
| AC-026 | FR-TOOL-005                        | Given an agent attempts a command not in its allowlist, when the tool broker evaluates it, then command execution is rejected.                                                                              |
| AC-027 | FR-TOOL-006                        | Given a running server, when an agent attempts to delete a file in the server directory, then the operation is rejected.                                                                                    |
| AC-028 | FR-TOOL-007                        | Given a running server, when an agent attempts to write an NBT file, then the operation is rejected.                                                                                                        |
| AC-029 | FR-TOOL-008                        | Given an agent attempts to access a path outside the server root, when the path is resolved, then the operation is rejected.                                                                                |
| AC-030 | FR-TOOL-009                        | Given a symlink resolving outside the server root, when an agent attempts access, then the operation is rejected.                                                                                           |
| AC-031 | FR-TOOL-011, NFR-OBS-004           | Given an agent-executed command, when it is attempted, then audit log includes agent ID, server ID, player name, and timestamp.                                                                             |
| AC-032 | NFR-SEC-001                        | Given `path: ../../etc`, when config validation runs, then traversal validation rejects the config.                                                                                                         |
| AC-033 | FR-CHAT-007                        | Given permission entry `steve`, when player `Steve` sends a permitted mention, then the permission lookup succeeds.                                                                                         |
| AC-034 | FR-CHAT-006                        | Given a player name containing ANSI escape sequences, when parsing runs, then validation rejects the player name.                                                                                           |
| AC-035 | FR-SRV-020                         | Given one active TUI instance, when a second instance starts, then it exits with `Another instance is already running`.                                                                                     |
| AC-036 | FR-SRV-019, NFR-REL-002            | Given stale PIDs from a prior hard crash, when the app starts, then it kills listed orphan PIDs before normal operation.                                                                                    |
| AC-037 | FR-SRV-019                         | Given orphan cleanup occurs, when startup continues, then the TUI displays how many processes were killed.                                                                                                  |
| AC-038 | FR-SRV-011                         | Given a server process exits with code 0 during `starting`, when the exit occurs before `Done`, then status becomes `failed` with `Server exited before becoming ready (exit code: 0)`.                     |
| AC-039 | FR-INV-005                         | Given `/tellraw` delivery failure is detected, when in-game delivery runs, then the system falls back to `/say` and still saves the response and shows it in the TUI.                                       |
| AC-040 | FR-TOOL-004, FR-TOOL-005           | Given allowlist entry `data modify`, when the agent attempts `data get block 0 0 0`, then the command is rejected.                                                                                          |
| AC-041 | FR-INV-012, FR-INV-013, FR-SES-005 | Given the selected server is stopped, when the operator sends `/chat admin ...`, then the agent responds in the TUI, the message is saved with playerName `operator`, and no in-game delivery is attempted. |
| AC-042 | FR-SRV-004, NFR-SEC-002            | Given an absolute `jarFile` outside `server.path`, when validation runs, then validation rejects it.                                                                                                        |
| AC-043 | FR-SRV-005, NFR-SEC-004            | Given a valid executable `javaPath` outside `server.path`, when validation runs, then validation accepts it.                                                                                                |

---

## 10. Verification and Test Strategy

| Test Type                | Purpose                                                                                                                       | Required Coverage                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Unit tests               | Validate pure parsing, validation, matching, rate-limit, splitting, and path-canonicalization logic.                          | Config validation, command allowlist matching, chat parsing, message splitting, environment substitution.  |
| Integration tests        | Validate process management, SQLite sessions, PID tracking, file locks, hot-reload, and tool broker behavior.                 | Server start/stop/restart, concurrent session writes, stale PID cleanup, sandbox rejection, stdin closure. |
| E2E tests                | Validate operator and player flows against a vanilla Minecraft Java server fixture.                                           | Start server, detect `Done`, parse chat, invoke agent with mocked provider, deliver response.              |
| Security tests           | Validate path traversal, symlink escape, secret logging, unauthorized player access, and command allowlist bypass resistance. | NFR-SEC-_ and FR-TOOL-_ requirements.                                                                      |
| Performance smoke tests  | Validate v1 performance guidelines without release-blocking formal benchmark gates.                                           | Log ingestion cap, dropped-line counter, memory budget, cold start, hot-reload latency.                    |
| Documentation inspection | Verify README, example config, EULA note, install procedure, and command help.                                                | CFGIF-5, CMD-8, NFR-COMP-005, NFR-COMP-006.                                                                |

Definition of done for v1 testing: all Must-priority acceptance criteria pass, all Must-priority requirements have test or inspection evidence, and any failed Should-priority criteria are documented with rationale.

---

## 11. Rollout, Migration, and Backward Compatibility

| Topic                  | Requirement                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial rollout        | v1 MAY be released as a single binary or npm package.                                                                                           |
| Config migration       | No prior stable config schema exists. If `schemaVersion` is omitted, the system MUST treat it as version 1.                                     |
| Session migration      | No migration from JSONL sessions is required for v1. SQLite at `data/sessions.db` is the v1 baseline.                                           |
| Rollback               | If v1 fails, rollback consists of stopping the TUI and using Minecraft servers manually. The system MUST NOT alter Minecraft-owned server logs. |
| Backward compatibility | Unknown future config schema versions MUST warn and MUST NOT fail solely due to the version value.                                              |
| Data retention         | Session pruning SHOULD run on startup and every 24 hours according to `sessionRetention`.                                                       |

---

## 12. Open Questions

| #   | Question                                                       | Owner       | Blocks implementation? |
| --- | -------------------------------------------------------------- | ----------- | ---------------------- |
| Q12 | What is the canonical Minecraft Java version for CI E2E tests? | Engineering | No                     |

No known blocking open questions remain in the SRS baseline.

---

## 13. Traceability Matrix

| Requirement Area                     | Requirement IDs              | Acceptance Criteria                           |
| ------------------------------------ | ---------------------------- | --------------------------------------------- |
| TUI and command interfaces           | UI-_, CMD-_                  | AC-024, AC-041                                |
| Configuration and validation         | CFGIF-_, FR-CFG-_            | AC-009 through AC-016, AC-042, AC-043         |
| Hot-reload                           | FR-HOT-\*                    | AC-013 through AC-016                         |
| Server lifecycle                     | MCIF-_, FR-SRV-_, NFR-REL-\* | AC-001 through AC-008, AC-035 through AC-038  |
| In-game chat parsing and permissions | CHAT-_, FR-CHAT-_            | AC-017 through AC-020, AC-023, AC-033, AC-034 |
| Agent invocation and delivery        | LLMIF-_, FR-INV-_            | AC-017, AC-021, AC-025, AC-039, AC-041        |
| Sessions                             | FR-SES-\*                    | AC-022, AC-041                                |
| Agent tools and sandboxing           | FR-TOOL-_, NFR-SEC-_         | AC-026 through AC-032, AC-040                 |
| Observability and audit              | NFR-OBS-\*                   | AC-031, AC-037, inspection tests              |
| Deferred scope                       | FR-DEF-_, NG-_               | Inspection                                    |

---

## Appendix A. Informative Architecture Notes

This appendix is informative. It records current architectural expectations for HLD but does not override normative requirements above.

Expected component boundaries:

| Component         | Responsibility                                                                     |
| ----------------- | ---------------------------------------------------------------------------------- |
| TUI Layer         | Server list, selected-server view, logs, status, chat panel, command input.        |
| ServerManager     | Lifecycle, Java process spawning, PID tracking, state transitions, crash handling. |
| ConfigService     | YAML loading, validation, environment substitution, hot-reload.                    |
| AgentService      | Provider invocation, timeouts, streaming, response handling, session context.      |
| ChatParser        | Vanilla log parsing, mention detection, player extraction.                         |
| PermissionService | Player authorization and rate limiting.                                            |
| ToolBroker        | Command allowlist enforcement, sandbox enforcement, audit logging.                 |
| SessionStore      | SQLite WAL persistence, session lookup, pruning.                                   |
| LockService       | Single-instance file lock.                                                         |

## Appendix B. Informative User Flows

### B.1 Operator Starts a Server

1. Operator launches `explorers-cli`.
2. System acquires the file lock.
3. System cleans up stale PIDs from `data/pids.json`.
4. System loads `config.yaml` if present.
5. Operator selects a configured server.
6. Operator starts the server.
7. System validates JAR, Java path, RAM, and port.
8. System spawns Java with configured arguments and `cwd`.
9. System transitions to `starting` and waits for the `Done` log line.
10. System transitions to `running` and streams logs.

### B.2 Player Triggers an Agent

1. Player sends `@admin how do I get to the nether?` in Minecraft chat.
2. Server emits a vanilla chat log line.
3. System parses the line, player, alias, permissions, and rate limit.
4. System loads session context and recent chat messages.
5. System invokes the configured agent.
6. System streams response in the TUI.
7. System sends public in-game response using `/tellraw` chunks.
8. System saves session entries in SQLite.

### B.3 Operator Chats with an Agent While Server Is Stopped

1. Operator selects a stopped server.
2. Operator runs `/chat <agent> <message>`.
3. System loads shared session for `serverId + agentId`.
4. System invokes the agent and streams the response to the TUI.
5. System saves the message with `playerContext.playerName = "operator"`.
6. System does not attempt in-game delivery.

## Appendix C. Version Roadmap

| Version  | Scope                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| v1.0 MVP | Server lifecycle, config management, agent ecosystem, TUI dashboard, SQLite sessions, security fundamentals. |
| v1.1     | Auto-restart watchdog, bulk operations, crash-to-agent shortcut, health dashboard.                           |
| v1.2     | Themes, server templates, session export, log search/filter.                                                 |
| v1.5     | Audioplayer and music system.                                                                                |
| v2.0     | Web UI, Discord/Slack webhooks, RCON support, scheduled tasks, plugin SDK.                                   |

## Appendix D. Change History

| Version | Change                                            |
| ------- | ------------------------------------------------- |
| 1.0     | Initial SRS baseline.                             |
| 1.1     | Day 2 gap resolutions.                            |
| 1.2     | Day 3 technical review resolutions.               |
| 1.3     | Day 4 blocker resolution and optimization review. |
| 1.4     | Formal ISO/IEC/IEEE 29148-style SRS refactor.     |
