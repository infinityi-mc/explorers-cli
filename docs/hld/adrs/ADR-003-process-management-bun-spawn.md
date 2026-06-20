# ADR-003: Use Native Bun.spawn and Process Groups for Subprocess Control

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: process, infrastructure, runtime

## Context

The application is built on **Bun** (C-01) and manages up to 10 local Minecraft Java Edition servers as background child processes. The system must orchestrate starting, stopping, and restarting these instances, detecting runtime crashes, and cleaning up orphans.
Crucially, on exit, the manager must guarantee that all active server child processes are terminated (NFR-REL-001) to prevent resource leaks (stray Java processes running in the background, locking server ports).
We need to map this logic to both Windows and Linux hosts (NFR-COMP-001).

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `FR-SRV-001` — Start server processes using configured Java parameters.
- `FR-SRV-013` — Force terminating child processes on stop timeout.
- `FR-SRV-018` — Track active subprocess PIDs inside `data/pids.json`.
- `NFR-REL-001` — Terminate all child processes on application exit or crash.
- `NFR-COMP-001` — Cross-platform support (Windows 10+ and Linux).
- `NFR-COMP-002` — Distribution as a single binary or npm package.
- `NFR-CAP-001` — Support up to 10 configured servers.
- `NFR-REL-002` — Hard-crash recovery: kill stale PIDs from `data/pids.json` on launch.
- `NFR-REL-003` — PID tracking: maintain `data/pids.json`.
- `NFR-REL-005` — Crash status: reflect process crashes in TUI within 2 seconds.
- `NFR-SEC-004` — Java path validation (existing executable, not constrained to `server.path`).
- `NFR-PERF-003` — Process RSS memory boundaries (200 MB idle, 500 MB under load).
- `NFR-PERF-005` — Cold start should complete in < 3 seconds.
- `C-01` — Execution on the Bun runtime environment.

## Options considered

### Decision A: Process spawning library

#### Option A-1: Standard Node.js `child_process` (spawn / spawnSync)

Use standard Node.js libraries to execute Java binaries and subscribe to stdin/stdout streams.

- **Pros**:
  - Highly stable, documented API.
  - Compatible with all standard Node libraries.
- **Cons**:
  - Lacks the performance optimization of Bun's native transport stream pipes.
  - Spawning process speed is slower under Node.js compared to Bun's native runtime.
- **Satisfies**: `NFR-COMP-001`
- **Tensions**: `C-01`

#### Option A-2: Native Bun Process Spawning (`Bun.spawn`) — chosen

Utilize Bun's high-performance `Bun.spawn` and `Bun.spawnSync` APIs to start, read/write streams, and monitor child exit codes.

- **Pros**:
  - Satisfies the customer's strict requirement for native Bun capability (C-01).
  - Extreme performance; Bun streams processes faster with lower memory allocation overhead.
  - Simple async reader pipelines using `ReadableStream` loops.
- **Cons**:
  - Slightly different API surface compared to standard Node, requiring custom lifecycle wrappers.
- **Satisfies**: `FR-SRV-001`, `C-01`, `NFR-PERF-003`
- **Tensions**: None.

### Decision B: Process cleanup mechanism

#### Option B-1: Process groups + Job Objects + taskkill fallback — chosen

Use POSIX process groups for Linux/macOS, manager-owned Windows Job Objects for normal Windows cleanup, `taskkill` as an emergency/stale-PID fallback, and `data/pids.json` as the persistent recovery register.

- **Pros**:
  - Native OS lifecycle primitives provide full process-tree cleanup.
  - Windows Job Objects can terminate member processes when the manager exits or crashes.
  - Persistent PID tracking enables stale process recovery after hard crashes.
  - No extra runtime dependency is required for process-tree walking.
- **Cons**:
  - Requires platform-specific implementation paths and tests.
- **Satisfies**: `FR-SRV-013`, `FR-SRV-018`, `NFR-REL-001`, `NFR-REL-002`, `NFR-REL-003`
- **Tensions**: None.

#### Option B-2: Pure `taskkill` on Windows and negative-PID kill on POSIX

Use command-line process termination primitives directly whenever cleanup is needed, without binding children to a manager-owned Windows Job Object.

- **Pros**:
  - Simple implementation with fewer OS handle lifecycle concerns.
- **Cons**:
  - Does not bind Windows child lifetime to the manager lifetime.
  - Cleanup after manager crash depends on next-launch stale PID recovery.
  - More failure-prone when child processes spawn grandchildren before termination.
- **Satisfies**: Partial — handles explicit stop and stale PID cleanup, but weakens crash cleanup.
- **Tensions**: `NFR-REL-001`

#### Option B-3: Cross-platform tree-kill library

Use a dependency that walks and terminates descendant processes on both Windows and POSIX hosts.

- **Pros**:
  - Single high-level implementation path.
- **Cons**:
  - Adds a dependency for core lifecycle safety.
  - PID tree walking is not equivalent to OS-owned lifetime binding.
  - Does not guarantee cleanup when the manager process is abruptly terminated before the library runs.
- **Satisfies**: Partial — handles explicit stop, but weakens crash cleanup.
- **Tensions**: `NFR-REL-001`, `NFR-COMP-002`

---

## Decision

We will use native Bun process spawning (`Bun.spawn`) to spawn, monitor, and pipe the standard input/output streams of Minecraft server instances. For cleanup, we will use POSIX process groups on Linux/macOS, manager-owned Windows Job Objects on Windows, `taskkill` only as a stale-PID or emergency fallback, and immediate PID recording in `data/pids.json`.

---

## Rationale

The Bun runtime is explicitly required by the customer and codebase configurations. `Bun.spawn` leverages Bun's optimized event loop, which aligns with memory footprints (NFR-PERF-003) and log streaming rates (NFR-PERF-001).
To satisfy child process cleanup constraints (`NFR-REL-001`), the manager will:

1. Spawn child processes on POSIX (Linux) as process-group leaders (`detached: true`) and terminate the full group by sending signals to negative PIDs.
2. Spawn child processes on Windows under a Job Object owned by the manager process. The Job Object is the primary cleanup mechanism and must be configured to terminate member processes when the manager exits or crashes.
3. Use `taskkill /T /F /PID <pid>` only as a fallback for stale PID cleanup on startup or for forced termination when the Job Object handle is unavailable.
4. Record PIDs immediately in `data/pids.json` as a safeguard (FR-SRV-018).

---

## Consequences

**Positive**:

- Fast, lightweight child process spawning.
- Asynchronous log parsing uses native high-performance stream readers.
- Stray process tracking on hard crashes via persistent PID tables.

**Negative**:

- Code must handle OS-specific execution rules (Windows vs. Linux process flags).

**Neutral**:

- The Java path configuration depends on operator host settings.

---

## Mitigations for negative consequences

- **OS-Specific Execution Rules** → The `Server Process Manager` component isolates spawn and cleanup options by identifying `process.platform`:
  - For **Linux/macOS**: Spawn with process group leaders using `detached: true` and send signals using negative PID values (e.g., `process.kill(-pid)`).
  - For **Windows**: Attach every managed Java process to a manager-owned Job Object immediately after spawn. The Job Object cleanup-on-close behavior is the required implementation for normal exit and crash cleanup. `taskkill /T /F /PID <pid>` is reserved for stale PID recovery on next boot and emergency forced termination when a previously recorded PID is not associated with the current Job Object.

---

## Links

- Related ADRs: None
- SRS sections: Section 3.6 (Minecraft Process Interface), Section 4.3 (Server Lifecycle)
- External references: [Bun Spawn Documentation](https://bun.sh/docs/api/subprocess)
