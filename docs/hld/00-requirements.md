# 00-requirements.md — Requirements Model

This document provides a structured extraction of the functional requirements, non-functional requirements, constraints, external interfaces, and key assumptions defining the scope of `explorers-cli` v1.0.

## System Boundary

`explorers-cli` is a local terminal application running on the **Bun runtime**. It manages local Minecraft server instances directly via child process streams.

```
+-------------------------------------------------------------------------------+
|                               System Boundary                                 |
|                                                                               |
|   +-----------------------+              +--------------------------------+   |
|   |                       |              |     Agent Engine               |   |
|   |      TUI Layer        |              |     (@infinityi/engine-lib)    |   |
|   |  (@opentui/react)     |<------------>|  - Tool Broker                 |   |
|   |                       |              |  - Sessions (SQLite WAL)       |   |
|   +-----------------------+              +--------------------------------+   |
|               ^                                          ^                    |
|               | (TUI Operator input/logs)                | (LLM calls)        |
|               v                                          v                    |
|   +-----------------------+              +--------------------------------+   |
|   |     Server Manager    |              |      External LLM Provider     |   |
|   |  - Bun.spawn lifecycle|              |     (OpenAI/Anthropic/Compat)  |   |
|   |  - PID File lock      |              +--------------------------------+   |
|   +-----------------------+                                                   |
|               ^                                                               |
|               | (stdin/stdout/stderr)                                         |
|               v                                                               |
|   +-------------------------------+                                           |
|   | Local Minecraft Java Server   |                                           |
|   | (Up to 10 child processes)    |                                           |
|   +-------------------------------+                                           |
+-------------------------------------------------------------------------------+
```

- **Inside System Scope**: Single-process CLI/TUI, configuration loader & watcher, local Minecraft process lifecycle coordinator, SQLite WAL session database, `@infinityi/engine-lib` tool sandboxing, file-based instance locking, and stdout chat-mention parsing.
- **Outside System Scope**: Web interface, remote/multi-host coordination, RCON protocol (postponed), automatic downloading or auto-detection of JAR files, modification of `eula.txt` agreements, and Paper/Spigot customized log parsers.

## Stakeholders & Concerns

- **TUI Operator**: Needs to start, stop, restart, and monitor up to 10 local servers from a single terminal dashboard, send stdin commands, and chat directly with agents.
- **In-Game Player**: Needs to mention agents using `@alias` in Minecraft chat and receive split, formatted responses in-game.
- **In-Game Admin**: Needs authorization to trigger administrative tools (e.g. system commands) through agents.
- **Security Auditor**: Requires that agent tools are strictly sandboxed within the server's path, commands follow allowlists, and all actions are audit-logged.
- **System Maintainer**: Demands modular code compliant with TypeScript conventions, Bun runtime best practices, and lightweight execution footprint.

## Functional and Interface Requirements Traceability

This registry maps every functional and interface requirement from the SRS (Sections 3 and 4) to its corresponding HLD container or component.

| SRS ID          | Summary                                                                                | HLD Owner                                       | Evidence / Decisions                     | Status   |
| --------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------- | -------- |
| **UI-1**        | Terminal UI with server list, detail, live logs, status, command input                 | TUI View Engine                                 | `03-components.md`                       | Mapped   |
| **UI-2**        | TUI display server metadata: port, max players, level name                             | TUI View Engine                                 | `03-components.md`                       | Mapped   |
| **UI-3**        | TUI support single selected server context                                             | TUI View Engine                                 | `03-components.md`                       | Mapped   |
| **UI-4**        | TUI stream agent responses token-by-token                                              | TUI View Engine                                 | `03-components.md`, `ADR-001`            | Mapped   |
| **UI-5**        | TUI respect `--no-color` / `NO_COLOR` env                                              | TUI View Engine                                 | `03-components.md`                       | Mapped   |
| **CMD-1**       | `/start <server>` command                                                              | Server Process Manager / TUI View Engine        | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-2**       | `/stop <server>` command                                                               | Server Process Manager / TUI View Engine        | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-3**       | `/restart <server>` command                                                            | Server Process Manager / TUI View Engine        | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-4**       | `/chat <agent> <message>` command                                                      | Agent Executor / TUI View Engine                | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-5**       | `/session` command                                                                     | Agent Executor / TUI View Engine                | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-6**       | `/resume <id>` command                                                                 | Agent Executor / TUI View Engine                | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-7**       | `/clear` command                                                                       | Agent Executor / TUI View Engine                | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-8**       | `/help` command                                                                        | TUI View Engine                                 | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CMD-9**       | Arbitrary console input to server stdin                                                | Server Process Manager / TUI View Engine        | `03-components.md`, `05-api-surface.md`  | Mapped   |
| **CHAT-1**      | Detect agent triggers from vanilla log mentions                                        | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **CHAT-2**      | Support `!help` in-game and mirror available commands                                  | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **CHAT-3**      | Silently ignore unauthorized, invalid, or throttled mentions                           | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **CFGIF-1**     | Load `config.yaml` from config directory                                               | Configuration Service                           | `03-components.md`                       | Mapped   |
| **CFGIF-2**     | Start empty state if `config.yaml` is absent                                           | Configuration Service                           | `03-components.md`                       | Mapped   |
| **CFGIF-3**     | Configuration keys must use camelCase                                                  | Configuration Service                           | `03-components.md`                       | Mapped   |
| **CFGIF-4**     | Secrets must use environment variable syntax `${VAR}`                                  | Configuration Service                           | `03-components.md`                       | Mapped   |
| **CFGIF-5**     | Ship an example `config.yaml` as documentation                                         | Configuration Service                           | `03-components.md`                       | Mapped   |
| **MCIF-1**      | Start server via java command flags `-Xms`, `-Xmx`, `-jar`, `nogui`                    | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **MCIF-2**      | Set child process working directory to `server.path`                                   | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **MCIF-3**      | Stop servers by writing `/stop` to stdin                                               | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **MCIF-4**      | Read stdout/stderr for logs, chat triggers, status, crash                              | Server Process Manager / Log Reader             | `03-components.md`, `ADR-003`, `ADR-005` | Mapped   |
| **MCIF-5**      | Do not require RCON for v1 operation                                                   | Server Process Manager                          | `02-architecture.md`, `03-components.md` | Mapped   |
| **LLMIF-1**     | Support OpenAI, Anthropic, and compatible provider configs                             | Agent Executor                                  | `03-components.md`, `ADR-001`            | Mapped   |
| **LLMIF-2**     | Do not log provider API keys                                                           | Agent Executor / Configuration Service          | `ADR-007`                                | Mapped   |
| **LLMIF-3**     | Cancel/abandon in-flight requests on agent timeout                                     | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-CFG-001**  | Support configuration of up to 10 Minecraft servers                                    | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-002**  | Loading more than 10 servers must fail validation                                      | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-003**  | Server names must be unique across config                                              | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-004**  | Each server entry must define all required schema fields                               | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-005**  | Validate server/agent/provider ID patterns                                             | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-006**  | Validate `serverPort` in range 1024 to 65535                                           | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-007**  | Validate `maxPlayers` in range 1 to 100, default 20                                    | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-008**  | Validate `ram` in range 512 MB to 32768 MB, default 1024                               | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-009**  | Validate `startupTimeout` in range 30 to 600s, default 120s                            | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-010**  | If `schemaVersion` is omitted, treat as version 1                                      | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-011**  | Warn but do not fail on unknown future schemaVersion                                   | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-012**  | Unresolved env references cause validation error                                       | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CFG-013**  | Allow editing port, max-players, motd from TUI                                         | TUI View Engine / Configuration Service         | `03-components.md`                       | Mapped   |
| **FR-HOT-001**  | Watch `config.yaml` for changes and hot-reload                                         | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-002**  | Retries read if ENOENT during atomic temp-renames                                      | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-003**  | Retain active config if hot-reload validation fails                                    | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-004**  | Display hot-reload validation errors in TUI                                            | TUI View Engine / Configuration Service         | `03-components.md`                       | Mapped   |
| **FR-HOT-005**  | Apply added or removed agents immediately on reload                                    | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-006**  | Apply updated agent/player permissions immediately                                     | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-007**  | Apply updated feature flags immediately on reload                                      | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-008**  | Apply new server configuration immediately on reload                                   | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-HOT-009**  | Port, RAM, JAR updates apply only on next restart                                      | Server Process Manager / Configuration Service  | `03-components.md`                       | Mapped   |
| **FR-HOT-010**  | Block removing a running server until stopped                                          | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-SRV-001**  | Start configured server by spawning Java process                                       | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **FR-SRV-002**  | Require explicit `jarFile` per server; no auto-detect                                  | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-003**  | Refuse start if `jarFile` absent; display error                                        | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-004**  | Require `jarFile` to resolve inside canonical `server.path`                            | Server Process Manager / Tool Sandbox Broker    | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-SRV-005**  | Validate `javaPath` exists & is executable (not restricted to path)                    | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-006**  | Spawn server process with `cwd = server.path`                                          | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **FR-SRV-007**  | Pass -Xms and -Xmx JVM flags using RAM value                                           | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **FR-SRV-008**  | Verify server port is free before starting                                             | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-009**  | Detect RUNNING state on vanilla `Done` log line                                        | Server Process Manager / Log Reader             | `03-components.md`                       | Mapped   |
| **FR-SRV-010**  | Transition to FAILED if not ready within startupTimeout                                | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-011**  | Transition to FAILED if process exits before Done line                                 | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-012**  | Stop server by sending `/stop` to stdin                                                | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **FR-SRV-013**  | Gracefully stop; force-kill after timeout using group/job objects                      | Server Process Manager                          | `03-components.md`, `ADR-003`            | Mapped   |
| **FR-SRV-014**  | Detect non-zero exits and reflect crash status in TUI in 2s                            | Server Process Manager / TUI View Engine        | `03-components.md`                       | Mapped   |
| **FR-SRV-015**  | Support restarting server: stop then start                                             | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-016**  | Clear `lastError` on successful restart                                                | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-017**  | Handle stdin closed unexpectedly: log warning, notify, do not crash                    | Server Process Manager                          | `03-components.md`                       | Mapped   |
| **FR-SRV-018**  | Track managed server PIDs in `data/pids.json`                                          | Lock & Lockout Service / Server Process Manager | `03-components.md`                       | Mapped   |
| **FR-SRV-019**  | On startup, kill stale PIDs from `data/pids.json`                                      | Lock & Lockout Service                          | `03-components.md`                       | Mapped   |
| **FR-SRV-020**  | Prevent multiple active TUI instances using file lock                                  | Lock & Lockout Service                          | `03-components.md`                       | Mapped   |
| **FR-FLG-001**  | Support feature flags in `config.yaml` to disable subsystems                           | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-FLG-002**  | The `audioplayer` feature flag defaults to `false`                                     | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-FLG-003**  | Hide music-related UI and commands if `audioplayer` is disabled                        | TUI View Engine                                 | `03-components.md`                       | Mapped   |
| **FR-AGT-001**  | Support configuring one or more LLM providers                                          | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-002**  | Configure provider `name`, `type`, `baseUrl`, `model`, and `apiKey` reference          | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-003**  | Support configuring multiple agents associated with a provider                         | Configuration Service / Agent Executor          | `03-components.md`                       | Mapped   |
| **FR-AGT-004**  | Support agent config fields: id, name, alias, provider, prompt, tools, timeout, limits | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-005**  | Start with zero agents by default                                                      | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-006**  | Do not ship built-in or predefined agents                                              | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-007**  | Validate agent alias: minimum 2 chars, alphanumeric plus dash/underscore               | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-008**  | Validate agent timeout in range 10 to 600 seconds, default 120                         | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-009**  | Validate agent rpm in range 1 to 60, default 10                                        | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-010**  | Validate agent cooldown in range 0 to 300 seconds, default 0                           | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-AGT-011**  | Validate agent ingameMessageWindow in range 0 to 50, default 10                        | Configuration Service                           | `03-components.md`                       | Mapped   |
| **FR-CHAT-001** | Target only vanilla log lines for chat mentions                                        | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-002** | Silently skip non-matching log lines                                                   | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-003** | Sequence: format match, `@alias`, name parse, permissions, rate check, invoke          | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-004** | If multiple aliases mentioned, only invoke the first one                               | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-005** | Strip team prefixes/suffixes from names before matching                                | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-006** | Validate and sanitize player names: `a-zA-Z0-9_`, max 16 chars                         | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-007** | Case-insensitive player permission verification                                        | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-008** | Deny in-game agent access if player is not listed in config                            | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-009** | Enforce per-agent rate limits `rpm` and `cooldown`                                     | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-010** | Silently ignore unauthorized, invalid, or throttled mentions                           | Chat Parser & Authorizer                        | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-CHAT-011** | Inject context window of N preceding chat lines in prompt                              | Agent Executor                                  | `03-components.md`, `ADR-006`            | Mapped   |
| **FR-INV-001**  | Invoke selected agent after authorization checks pass                                  | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-002**  | Stream response tokens to TUI chat panel in real-time                                  | TUI View Engine                                 | `03-components.md`, `ADR-001`            | Mapped   |
| **FR-INV-003**  | On agent timeout, abort request, return partial response, keep session valid           | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-004**  | Wrap in-game chat responses in `/tellraw` JSON format                                  | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-005**  | Fall back to `/say` if `/tellraw` delivery fails                                       | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-006**  | Attempt `/tellraw` first for every response; do not latch into say                     | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-007**  | In-game responses are visible to all players in v1                                     | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-008**  | Strip section-sign `§` and `&` formatting markers from output                          | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-009**  | Split long in-game responses to max 200 characters                                     | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-010**  | Splitting must prefer sentence, clause, then word boundaries                           | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-011**  | Send split message chunks with 500 ms delay between chunks                             | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-INV-012**  | Operator can chat with agent via TUI when selected server is stopped                   | TUI View Engine / Agent Executor                | `03-components.md`                       | Mapped   |
| **FR-INV-013**  | TUI chat with offline server does not execute in-game delivery                         | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-001**  | Persist agent sessions in SQLite at `data/sessions.db`                                 | Agent Executor                                  | `03-components.md`, `ADR-002`            | Mapped   |
| **FR-SES-002**  | Use SQLite WAL mode to prevent transaction corruption                                  | Agent Executor                                  | `03-components.md`, `ADR-002`            | Mapped   |
| **FR-SES-003**  | Session key is serverId + agentId                                                      | Agent Executor                                  | `03-components.md`, `ADR-002`            | Mapped   |
| **FR-SES-004**  | Players and TUI operator share one session context per server+agent                    | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-005**  | Operator messages set playerContext: { playerName: "operator" }                        | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-006**  | Uniqueness of session ID: timestamp + random suffix                                    | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-007**  | Each session entry contains role, content, timestamp, playerContext                    | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-008**  | Player context extensible; must contain playerName                                     | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-009**  | Automatically prune expired sessions on startup/timer                                  | Agent Executor                                  | `03-components.md`                       | Mapped   |
| **FR-SES-010**  | Support TUI commands `/session`, `/resume`, `/clear`                                   | TUI View Engine / Agent Executor                | `03-components.md`                       | Mapped   |
| **FR-SES-011**  | `/resume` lists last 20 available session IDs                                          | TUI View Engine / Agent Executor                | `03-components.md`                       | Mapped   |
| **FR-TOOL-001** | Support custom tool definitions for agents                                             | Agent Executor / Tool Sandbox Broker            | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-002** | Agent tool authorization must be deny-by-default                                       | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-003** | Command allowlist configured on agentConfig, not serverConfig                          | Configuration Service / Tool Sandbox Broker     | `03-components.md`                       | Mapped   |
| **FR-TOOL-004** | Command allowlist matching: strip slash, tokenize, match prefix tokens                 | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-005** | Reject commands failing token allowlist; do not execute                                | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-006** | Block file moves/deletes inside server folder while running                            | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-007** | Block writing NBT files while server is running                                        | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-008** | Sandbox filesystem operations to canonical `server.path`                               | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-009** | Block relative or symlink traversal outside of server directory                        | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-010** | Block cross-server folder traversal by agent tools                                     | Tool Sandbox Broker                             | `03-components.md`, `ADR-004`            | Mapped   |
| **FR-TOOL-011** | Audit log all agent-executed commands and file operations                              | Tool Sandbox Broker / Agent Executor            | `03-components.md`, `ADR-007`            | Mapped   |
| **FR-TOOL-012** | No human-in-the-loop approval required for destructive tools in v1                     | Tool Sandbox Broker                             | `03-components.md`                       | Mapped   |
| **FR-DEF-001**  | Do not implement music playback via Audioplayer in v1                                  | TUI View Engine                                 | `00-requirements.md` (Scope boundary)    | Deferred |
| **FR-DEF-002**  | Do not implement music search/queue/volume controls in v1                              | TUI View Engine                                 | `00-requirements.md` (Scope boundary)    | Deferred |
| **FR-DEF-003**  | Future spec: default audioplayer feature flag to false                                 | Configuration Service                           | `00-requirements.md`                     | Deferred |
| **FR-DEF-004**  | Future spec: show graceful error when audioplayer mod is missing                       | TUI View Engine                                 | `00-requirements.md`                     | Deferred |

## Key Architectural Non-Functional Requirements (NFRs)

This table highlights NFRs with direct architectural impact. The complete SRS Section 5 NFR list and ADR mapping is maintained in `08-nfr-traceability.md`.

| ID               | Category   | Description                                                                              | Rationale                                | Source  |
| ---------------- | ---------- | ---------------------------------------------------------------------------------------- | ---------------------------------------- | ------- |
| **NFR-COMP-001** | Platform   | MUST run on Windows 10+ and Linux (Ubuntu 20.04+, Debian 11+).                           | Cross-platform operator desktop use.     | SRS 5.1 |
| **NFR-COMP-003** | Minecraft  | MUST support vanilla Minecraft Java Edition 1.20+ servers.                               | Avoid custom mods for server parsing.    | SRS 5.1 |
| **NFR-PERF-001** | Latency    | Log rendering latency SHOULD be < 100 ms p99 under 10 servers x 100 lines/s.             | Prevent TUI lag during high traffic.     | SRS 5.2 |
| **NFR-PERF-003** | Memory     | TUI RSS SHOULD be < 200 MB idle, < 500 MB under heavy load.                              | Ensure lightweight host execution.       | SRS 5.2 |
| **NFR-PERF-004** | Load       | MUST rate-limit stdout parsing to `maxLinesPerSecond` (default 5000).                    | Prevent CPU exhaust during log storms.   | SRS 5.2 |
| **NFR-CAP-001**  | Scale      | MUST support up to 10 configured servers.                                                | Outlines maximum concurrency capacity.   | SRS 5.2 |
| **NFR-REL-001**  | Cleanup    | MUST kill child processes on exit using Linux process groups / Windows job objects.      | Prevent orphaned server background leak. | SRS 5.3 |
| **NFR-REL-004**  | Uptime     | SQLite persistence MUST use WAL (Write-Ahead Logging).                                   | Avoid DB locks / corruption on writes.   | SRS 5.3 |
| **NFR-REL-006**  | Buffer     | MUST cap in-memory log buffer to `maxBufferBytes` (default 16 MB).                       | Prevent Node process OOM.                | SRS 5.3 |
| **NFR-SEC-001**  | Sandbox    | Path validation MUST canonicalize `server.path` as sandbox root.                         | Path traversal vulnerability mitigation. | SRS 5.4 |
| **NFR-SEC-003**  | Sandbox    | Agent file paths MUST resolve inside sandbox; block symlinks outside.                    | Prevent agent reading host secrets.      | SRS 5.4 |
| **NFR-SEC-006**  | Validation | Player names MUST be validated case-insensitively and limited to `a-zA-Z0-9_` (max 16c). | Prevent command/injection payloads.      | SRS 5.4 |
| **NFR-SEC-007**  | Secrets    | Secrets MUST exist only in environment/`.env`, and MUST NOT be logged.                   | Prevent API key exposure in disk logs.   | SRS 5.4 |
| **NFR-OBS-002**  | Telemetry  | `@infinityi/forge` telemetry MUST be opt-in (default false) with consent flag.           | Customer data privacy requirement.       | SRS 5.5 |
| **NFR-OBS-004**  | Audit      | Log all agent-executed commands with server ID, agent ID, player, and timestamp.         | Audit trail for operator review.         | SRS 5.5 |

## Constraints

- **C-01 (Runtime)**: The application MUST execute on the Bun runtime environment, taking advantage of its fast startup and native module loading.
- **C-02 (Framework)**: The terminal user interface MUST be built with `@opentui/react` and `@opentui/core`.
- **C-03 (Infrastructure)**: Integration with LLM providers and agent tool execution must utilize the provided `@infinityi/forge` and `@infinityi/engine-lib` libraries.
- **C-04 (Process Communication)**: Minecraft control is restricted to process streams (`stdin`, `stdout`, `stderr`). No RCON protocol or game mods may be used for control.
- **C-05 (Instance Lock)**: A filesystem lock must exist to enforce a single running manager instance on the host machine.
- **C-06 (Persistence)**: Sessions must be persisted in a local SQLite file (`data/sessions.db`) and PIDs in a JSON file (`data/pids.json`).

## External Interfaces

- **EI-01 (Operator CLI Input)**: Stdin interface capturing operator inputs (TUI navigation, `/start`, `/stop`, `/chat`, and direct server console commands).
- **EI-02 (Operator TUI Output)**: Render loop painting the console screen with grid panes, streaming logs, server metadata, and token-by-token agent chat output.
- **EI-03 (Minecraft Process IO)**: Spawned Java subprocesses. Reads stdout/stderr chunks and writes `/tellraw`, `/say`, or operator console inputs.
- **EI-04 (LLM APIs)**: Secure HTTPS outbound requests communicating with OpenAI, Anthropic, or compatible endpoints using keys resolved from the environment.
- **EI-05 (Config Watcher)**: FS polling or filesystem event listener watching `config.yaml` to trigger reload events.

## Assumptions

- **A-01 (Java Environment)**: The host environment has Java installed that matches the required version of the Minecraft server JARs.
- **A-02 (EULA Acceptance)**: The operator accepts the Minecraft EULA out-of-band by writing `eula.txt` in the server directories.
- **A-03 (Log Format)**: Server logs are standard vanilla formats. Modded logs (e.g. Paper/Spigot color codes or structure adjustments) are out of scope.
- **A-04 (Telemetry Transport)**: Enabling `telemetry.enabled` in `config.yaml` instructs `@infinityi/forge` to handle data transmission; the application does not implement custom telemetry clients.
- **A-05 (Network Status)**: The network interface validation is performed via active binding check on the target host port.
