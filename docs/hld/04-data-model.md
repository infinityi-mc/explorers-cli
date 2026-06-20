# 04-data-model.md — Conceptual Data Model

This document outlines the conceptual data structures for `explorers-cli`. It specifies the relationships between user-configured settings, ephemeral runtime tracking metrics, and the SQLite session store.

## Conceptual ER Diagram

The diagram below connects configuration data (sourced from `config.yaml`), runtime process sheets (`pids.json`), and the chat log table (`sessions.db`).

```mermaid
erDiagram
    SERVER_CONFIG ||--o| PID_RECORD : "currently executing as"
    SERVER_CONFIG ||--o{ SESSION_ENTRY : "hosts chat logs for"
    AGENT_CONFIG ||--o{ SESSION_ENTRY : "participates in"
    SERVER_CONFIG ||--o{ PLAYER_CONFIG : "authorizes players in"

    SERVER_CONFIG {
        string id PK "Unique identifier matching ^[a-zA-Z0-9_-]{1,32}$"
        string name "Unique name across active config"
        string path "Canonicalized local directory path"
        string jarFile "JAR path inside path"
        int ram "Allocated memory in MB (512..32768)"
        string javaPath "Executable path"
        int serverPort "1024..65535"
        int maxPlayers "1..100"
        int startupTimeout "30..600"
    }

    PID_RECORD {
        string serverId PK, FK "References SERVER_CONFIG.id"
        int pid "OS process ID"
    }

    PLAYER_CONFIG {
        string name PK "Case-insensitive player name"
        string serverId FK "References SERVER_CONFIG.id"
        string teamPrefix "Stripped prefix"
        string teamSuffix "Stripped suffix"
        boolean inGameAdmin "Elevated admin flag"
        stringArray agents "Agent IDs this player is allowed to call"
    }

    AGENT_CONFIG {
        string id PK "Unique agent identifier"
        string alias "Trigger mention ^[a-zA-Z0-9_-]{2,}$"
        string provider "References LLM provider name"
        string systemPrompt "Persona instruction text"
        stringArray tools "Tool capability flags"
        stringArray commandAllowlist "Prefix patterns allowed"
        int timeout "Default 120s"
        int rpm "Rate limit rpm"
        int cooldown "Rate limit cooldown in seconds"
        int ingameMessageWindow "Context line count"
    }

    SESSION_ENTRY {
        int id PK "Auto-increment ID"
        string sessionId "Unique UUID/Timestamp identifier"
        string serverId FK "References SERVER_CONFIG.id"
        string agentId FK "References AGENT_CONFIG.id"
        string role "user | assistant | system"
        string content "Verbatim message text"
        string timestamp "ISO 8601 string"
        string playerName "Player name or 'operator'"
    }
```

## Entity Details

### 1. SERVER_CONFIG & AGENT_CONFIG (YAML In-Memory)

- **Lifecycle**: Read from `config.yaml` during application startup. Instantly refreshed on successful hot-reloads. If `config.yaml` is deleted while running, the active in-memory configuration is retained and the TUI surfaces the condition without crashing. Entries are removed from active memory only after a valid hot-reload explicitly removes them, subject to the rule that running servers cannot be removed until stopped.
- **Volume**: Small (typically 1 to 10 servers, 1 to 5 agents).
- **Access Patterns**: Iterated at startup to validate structures and binds. Searched by `serverId` on start/stop triggers and by `agentId` / `alias` during chat parser passes.

### 2. PLAYER_CONFIG (YAML In-Memory)

- **Lifecycle**: Loaded from the configuration file. Case-insensitive fields are parsed and stored in memory.
- **Volume**: Small (typically 1 to 50 players per server).
- **Access Patterns**: Queried case-insensitively when a player triggers an agent alias. Validates if the player exists and holds access rights to the agent ID.

### 3. PID_RECORD (JSON Persistence - `data/pids.json`)

- **Lifecycle**: Created when a child process is successfully spawned. Deleted from the tracking map when a server reaches `stopped` state. Checked and cleared during boot cleanup sequence.
- **Volume**: Capped at 10 active records (matching the server limit).
- **Access Patterns**: Written atomically whenever process IDs are assigned. Checked sequentially on boot to terminate stray processes.

### 4. SESSION_ENTRY (SQLite Table - `data/sessions.db`)

- **Lifecycle**: Appended immediately on incoming player/operator messages and downstream LLM token-stream outputs. Rows are periodically pruned when they exceed the `EXPLORERS_CLI_SESSION_RETENTION` duration (default 30 days).
- **Volume**: High growth. Under active playing conditions, this can scale to tens of thousands of lines.
- **Access Patterns**:
  - _Writes_: Appended sequentially during agent conversations.
  - _Reads_: Fetches the last `ingameMessageWindow` historical rows matching the active `serverId + agentId` session key to reconstruct LLM history (FR-SES-004).
  - _Pruning_: Run-swept at startup and every 24 hours.

## Patterns & Flags

- **Shared Multi-Tenant Session Key**: All players and the TUI operator share the exact same database context window for a given `serverId + agentId` combination (FR-SES-004). This acts as a single-room group chat environment rather than private message silos.
- **Write-Ahead Logging (WAL)**: SQLite writes compile onto a concurrent WAL log. This is an architectural protection (NFR-REL-004) preventing database locks or journal corruption when different players trigger agents simultaneously (AC-022).
- **Case-Insensitive Lookup and Session Indexing**: Permission checks are executed case-insensitively in memory. The SQLite engine must create indexes on `(serverId, agentId)`, `(timestamp)`, and `(sessionId)` to support context fetches, pruning, and `/resume` lookup requirements (NFR-PERF-006).
