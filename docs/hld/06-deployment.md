# 06-deployment.md — Deployment Topology

As a local terminal application, `explorers-cli` is distributed as a single npm package or native binary compiled for the host OS. It runs directly on the operator's local machine or dedicated game server host.

## Deployment Topology Diagram

The diagram below details the mapping of system containers to the host environment, showing network routing from players, local IPC process pipes, and outbound HTTPS connections. Server folder and Java subprocess nodes use `1..N` notation to show the repeated pattern for up to 10 configured servers.

```mermaid
flowchart TB
    subgraph internet["Public Network Space"]
        player_pc["Minecraft Client<br/>(In-Game Player)"]
        llm_gateway["LLM Provider Endpoint<br/>(SaaS Gateway)"]
    end

    subgraph local_machine["Operator Local Host Machine (Windows / Linux)"]
        direction TB

        subgraph client_boundary["explorers-cli Process Context"]
            tui_process["**TUI & CLI Process**<br/>(Bun Single-Process)<br/>Host memory budget: 200-500 MB"]
        end

        subgraph sandbox_dirs["Filesystem Directory Tree"]
            lock_resource["**Lock File**<br/>data/explorers.lock"]
            pid_store["**PID Register**<br/>data/pids.json"]
            sqlite_db[("**Session DB**<br/>data/sessions.db")]

            subgraph server_instances["Sandboxed Server Paths"]
                srv_dir1["**Server Folder 1**<br/>(sandbox root 1)"]
                srv_dir2["**Server Folder N**<br/>(repeated pattern, N <= 10)"]
            end
        end

        subgraph process_table["OS Process Table"]
            java_proc1["**Java Subprocess 1**<br/>(Minecraft Server Port: 25565)"]
            java_proc2["**Java Subprocess N**<br/>(repeated pattern, N <= 10)"]
        end
    end

    player_pc -->|TCP / Game protocol| java_proc1
    player_pc -->|TCP / Game protocol| java_proc2

    tui_process -->|IPC stdin/stdout| java_proc1
    tui_process -->|IPC stdin/stdout| java_proc2

    tui_process -->|Acquires lock| lock_resource
    tui_process -->|Saves process state| pid_store
    tui_process -->|WAL transactions| sqlite_db

    tui_process -->|Restricts tool writes| srv_dir1
    tui_process -->|Restricts tool writes| srv_dir2

    tui_process -->|Outbound HTTPS (port 443)| llm_gateway

    classDef host fill:#f9f9f9,stroke:#555
    classDef proc fill:#e1f5ff,stroke:#0288d1
    classDef data fill:#fff4e1,stroke:#f57c00

    class local_machine host
    class tui_process,java_proc1,java_proc2 proc
    class sqlite_db,pid_store,lock_resource data
```

---

## Environments

Because the system executes locally, "environments" refer to the configurations deployed on different host machines.

### 1. Production Host

- **Purpose**: Dedicated local server host or workstation executing the active servers. Connects real players.
- **Containers & Scalability**:
  - Runs a single instance of `explorers-cli` Bun process (prevented from spawning replicas via `explorers.lock`).
  - Spawns up to 10 active Java subprocesses (capped in config verification, NFR-CAP-001).
  - Persistence: Full SQLite file tracking all chat history, retaining up to 30 days of text logs.
- **Difference from Dev/Stage**: Full resource allocation (maximum configured RAM limits e.g., 4096M per server). Outbound HTTPS is live with production LLM billing tokens.

### 2. Staging Host (Testing Sandbox)

- **Purpose**: Validation environment used by operators to test config reload scripts, player permissions, and agent system prompts.
- **Containers & Scalability**:
  - Runs a replica configuration with minimal RAM allocation (e.g., 512M per server) and dummy game JARs.
  - persistence: A separate `data/sessions.db` initialized with mockup data.
- **Difference from Prod**: Outbound LLM providers are often pointed to mock routers or local models (e.g., Ollama or LocalAI compatibility endpoints) to control costs.

---

## Promotion & CI/CD Model

1. **Development**: Developers write TypeScript modules in their workspace. Unit and integration tests verify sandboxing security and regex parser compliance.
2. **Release Build**: A automated workflow packs the application as a single executable binary using Bun's native compiler (`bun build --compile`) or standard npm distributions.
3. **Configuration Promotion**: Operators should verify changes locally using `--validate-config` (NFR-MNT-003). Once validation returns exit code `0`, the new `config.yaml` is deployed to the Production Host.
4. **Hot-Reload Gate**: The configuration service automatically detects the update, validates the fields in memory, and swaps the operational context.

---

## Scaling Model

The system scales vertically on a single machine.

- **CPU and Threads**: Bun operates on a fast single-threaded event loop. Minecraft child process threads execute independently on different system cores allocated by the OS scheduler.
- **Memory Limits**: The Bun TUI process is designed to remain below 200 MB RSS at idle, scaling to a maximum of 500 MB under heavy logging loads (NFR-PERF-003). To maintain this budget, scrollback buffers cap at 16 MB per server (NFR-REL-006) and log parser streams drop lines exceeding 5000 lines/sec (NFR-PERF-004).

---

## Disaster Recovery & Process Guardians

- **Graceful Exit Guardian (Process Groups)**:
  - _Linux/macOS_: The manager spawns child processes inside distinct OS Process Groups. On shutdown, a kill signal is broadcast to the entire group ID, terminating stray Java threads.
  - _Windows_: The manager utilizes Windows Job Objects to tie child process lifecycles to the parent Bun process. If Bun terminates, Windows automatically cleans up the child processes.
- **Hard-Crash Recovery (PID Tracking)**: If the host machine experiences sudden power failures, `data/pids.json` retains the PIDs of the running Java processes. On subsequent launch, the system reads this JSON and terminates those stale PIDs before initiating normal rendering loop (FR-SRV-019), protecting the host from duplicate bind conflicts.
- **Database Resiliency (RPO/RTO)**: SQLite WAL mode guarantees transactions commit to disk instantly. The Recovery Point Objective (RPO) is less than 1 second of chat history. Recovery Time Objective (RTO) is under 3 seconds (NFR-PERF-005) for cold startup.
