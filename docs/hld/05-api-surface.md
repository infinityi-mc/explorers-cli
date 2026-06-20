# 05-api-surface.md — API and Interface Contracts

Since `explorers-cli` is a local terminal-based application, it does not host a network-facing API in v1 (NG-5). However, it defines structural interface boundaries for operator commands, in-game chat events, and LLM tool bindings.

## API Style & Communication Rationale
Our interaction with LLM Providers uses **HTTPS REST + Server-Sent Events (SSE)** for streaming tokens (FR-INV-002). 
* **Rationale**: SSE reduces process memory usage by allowing token parsing on-the-fly, fitting the tight host memory guidelines (NFR-PERF-003).
* **ADR Link**: See `adrs/ADR-001-api-style-sse.md` for details.

---

## 1. Operator TUI Command Interface

The TUI CLI routes slash commands entered by the operator in the terminal command line.

### Command Catalog
* `/start <server>` — Initiates validation and triggers the process spawn.
* `/stop <server>` — Sends a `/stop` command to server stdin and waits for graceful closure.
* `/restart <server>` — Performs sequential `/stop` and `/start` commands.
* `/chat <agent> <message>` — Routes a prompt directly to the named agent persona in the TUI console.
* `/session` — Lists information about active session contexts.
* `/resume <id>` — Reloads the visual TUI chat window with the history of the specified session ID.
* `/clear` — Resets the session database cache context for the selected server/agent.
* `/help` — Lists all available TUI slash commands with one-line descriptions.

---

## 2. In-Game Chat Interface (Log Parsing)

The system scans log files from stdout matching the vanilla server chat signature.

### Inbound Mention Trigger
* **Pattern**: `[timestamp] [Server thread/INFO]: <playername> @<alias> <message>`
* **Constraint**: Mentions containing player names must match `^[a-zA-Z0-9_]{1,16}$` and are sanitized to prevent injection attacks (FR-CHAT-006).

### Inbound Help Trigger
* **Pattern**: `[timestamp] [Server thread/INFO]: <playername> !help`
* **Response**: Fires an outbound `/tellraw` list of permitted agents and basic commands.

---

## 3. Agent Tool Call Schema

The **Tool Sandbox Broker** exposes function execution contracts to the LLM agent via `@infinityi/engine-lib`. These schemas are registered dynamically with the LLM provider.

### Core Collections
1. **Minecraft Command Executor (`run_command`)**
   * *Arguments*: `{ command: string }`
   * *Auth Rule*: The command must match the agent's allowlist prefix tokens (FR-TOOL-004).
   * *Output*: Plain-text stdout return from the server process.
2. **Filesystem Reader (`read_file`)**
   * *Arguments*: `{ path: string }`
   * *Auth Rule*: Canonicalized path must resolve within the target `server.path` (FR-TOOL-008).
   * *Output*: Verbatim file content.
3. **Filesystem Writer (`write_file`)**
   * *Arguments*: `{ path: string, content: string }`
   * *Auth Rule*: Path must reside inside the sandbox, cannot be an NBT file, and cannot move/delete files when the server is `RUNNING` (FR-TOOL-006).
   * *Output*: Write confirmation status.

---

## Concurrency & Idempotency Rules

* **In-Game Chat Splitting**: Mutating commands issued through the `run_command` tool (like `/give` or `/tp`) are executed immediately on the server thread. To prevent command duplication during retries, agents are encouraged via system prompts to structure operations idempotently.
* **Concurrent Chat Throttling**: A per-player rate limit is enforced by the **Chat Parser** (`rpm` and `cooldown`). If a player triggers multiple commands in quick succession, later mentions are silently dropped in memory before they hit the LLM socket (FR-CHAT-010).

---

## High-Level Error Categories

If an operation fails, the system returns structured error descriptors:
* `PORT_CONFLICT`: The host port is bound by another process.
* `JAR_NOT_FOUND`: The configured executable JAR is missing from the directory.
* `PATH_TRAVERSAL_BLOCKED`: The agent tool attempted to navigate outside the sandbox root.
* `COMMAND_BLOCKED`: The command did not match allowlist tokens.
* `PROVIDER_TIMEOUT`: The LLM provider API failed to return tokens before the agent timeout.
* `OFFLINE_FAIL`: The agent requested a command tool but the target server was `stopped`.

---

## Versioning & Compatibility

* **Config Versioning**: Config schema carries an optional `schemaVersion` field. If omitted, the loader defaults to version `1` (FR-CFG-010). If the version is newer than the supported v1 compiler, the system displays a warning and falls back to best-effort loading (FR-CFG-011).
* **Backward Compatibility**: Any future structural schema additions (e.g. database schema migrations) will use SQLite migration scripts.
