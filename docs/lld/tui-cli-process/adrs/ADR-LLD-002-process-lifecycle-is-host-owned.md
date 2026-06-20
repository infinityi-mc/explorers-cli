# ADR-LLD-002: Process lifecycle is host-owned (no forge primitive covers it)

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: Engineering (LLD pass)
- **Tags**: process, lifecycle, os-specific, bun
- **Implements HLD ADR(s)**: ADR-003 (Bun.spawn + process groups / Windows Job Objects / `taskkill` / `pids.json`)
- **Supersedes HLD ADR(s)**: none
- **Affects LLD files**: `design.md` (Server Process Manager row in capability mapping; Algorithm 2), `data-model.md` (`pids.json`), `migration-plan.md` (M-002, M-004), `sequences.md` (§1, §2), `errors.md` (`PID_STALE`, `PID_REUSED`, `LOCK_HELD`), `tests.md` (§Reliability)

## Context

HLD ADR-003 mandates native `Bun.spawn` for child-process spawning and
POSIX process groups / Windows Job Objects / `taskkill` fallback / `data/pids.json`
for cleanup. This is the only HLD component where no forge or engine-lib
primitive provides the capability.

`forge/lifecycle` provides **application** lifecycle (boot, ordered start,
reverse-stop, readiness, signal handling) — but it operates on `Component`
objects that satisfy a `{start(), stop(), healthcheck?}` seam. It does not
spawn or kill OS child processes. `engine-lib/lifecycle`'s
`agentRuntimeComponent` adapts the engine-lib runtime to a forge `Component`,
but again does not handle child processes.

`Bun.spawn` is the Bun-native API for spawning child processes. It exposes
`stdio` pipes, `detached` (for POSIX process groups), and exit-code events,
but it does NOT expose Windows Job Object APIs (those require a native
addon or `ffi-napi`).

The LLD must therefore write host-owned code for:

1. Spawning the Java child process with the right per-OS flags.
2. Wiring stdout to the Log Reader.
3. Recording the PID in `data/pids.json`.
4. On stop, sending `/stop` to stdin, waiting for exit, force-killing on
   timeout.
5. On boot, reading `data/pids.json` and killing stale PIDs.
6. On `--read-only` mode, blocking mutating process commands (handled by
   ADR-LLD-003, not here).
7. Acquiring `data/explorers.lock` to prevent a second manager instance.

## Requirements driving this decision

- `FR-SRV-001` — Start server with configured Java params (requires `Bun.spawn`).
- `FR-SRV-013` — Force-kill on stop timeout (requires per-OS tree-kill).
- `FR-SRV-018` — Track PIDs in `data/pids.json` (requires atomic file writes).
- `FR-SRV-019` — On boot, kill stale PIDs (requires PID verification + kill).
- `FR-SRV-020` — `explorers.lock` single-instance (requires OS file lock).
- `NFR-REL-001` — Kill all children on exit (requires process groups / Job Objects).
- `NFR-REL-002` — Stale PID cleanup on boot.
- `NFR-REL-003` — PID tracking.
- `NFR-REL-005` — Crash reflected in TUI within 2 s (requires exit-code listener).
- `NFR-COMP-001` — Windows 10+ and Linux (requires per-OS code paths).
- `NFR-SEC-004` — javaPath validation (existing executable, not constrained to `server.path`).
- `C-01` — Bun runtime.

## Options considered

### Option 1: Use a third-party tree-kill library

Use a library like `tree-kill` (npm) to walk and kill descendant processes
on both Windows and POSIX.

**Pros**:

- Single high-level API.
- No native addon needed.

**Cons**:

- Adds a runtime dependency for core lifecycle safety (HLD ADR-003 Option
  B-3 explicitly rejected this — "Adds a dependency for core lifecycle
  safety").
- PID tree walking is not equivalent to OS-owned lifetime binding — if the
  manager crashes, the library never runs, and orphan Java processes
  persist until next-boot stale-PID cleanup.
- Doesn't satisfy `NFR-REL-001` (kill on exit) for the crash case.

**Satisfies**: partial — explicit stop only.
**Tensions**: `NFR-REL-001`.

### Option 2: Pure `taskkill /T /F` on Windows, negative-PID kill on POSIX

Use command-line process termination primitives directly, without binding
children to a manager-owned Job Object.

**Pros**:

- No native addon.
- Simple implementation.

**Cons**:

- Doesn't bind Windows child lifetime to manager lifetime (HLD ADR-003
  Option B-2 explicitly rejected this — "Does not bind Windows child
  lifetime to the manager lifetime").
- Cleanup after manager crash depends on next-launch stale-PID recovery.

**Satisfies**: partial.
**Tensions**: `NFR-REL-001`.

### Option 3: Host-owned per-OS implementation — POSIX process groups + Windows Job Objects + `taskkill` fallback + `data/pids.json` — chosen

Implement per-OS process lifecycle in host code:

1. **POSIX** (Linux/macOS): spawn with `detached: true` so the child is its
   own process-group leader. On stop, send `process.kill(-pid, 'SIGTERM')`
   to the group; on timeout, `process.kill(-pid, 'SIGKILL')`.
2. **Windows**: spawn normally, then immediately attach to a manager-owned
   Job Object via a native addon (or `ffi-napi`) call to
   `CreateJobObject` + `AssignProcessToJobObject` +
   `SetInformationJobObject(JobObjectExtendedLimitInformation,
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)`. When the manager process exits
   (cleanly or crash), Windows automatically kills the Job Object's
   members.
3. **`taskkill /T /F /PID <pid>`** — reserved for stale-PID recovery on
   boot (when the previous manager crashed and the Job Object is gone)
   and for emergency forced termination when the Job Object handle is
   unavailable.
4. **`data/pids.json`** — atomically rewritten (temp + rename) on every
   spawn and every stop. On boot, read this file, verify each PID's
   command line contains `java` and `jar` (defensive — don't kill
   unrelated processes if the OS reused the PID), and kill via the
   per-OS path.
5. **`data/explorers.lock`** — opened with `O_CREAT` and locked via
   `flock(LOCK_EX)` (POSIX) or `LockFileEx` (Windows). If acquisition
   fails, exit with `LOCK_HELD`.

**Pros**:

- Satisfies all driving requirements.
- POSIX path is pure JS (no native addon).
- Windows path uses the OS-native Job Object lifetime binding, which is
  the only mechanism that satisfies `NFR-REL-001` for the crash case.
- `taskkill` fallback covers the stale-PID recovery case where no Job
  Object exists.
- `data/pids.json` provides a recovery register for hard crashes.

**Cons**:

- Windows Job Object API requires a native addon (the only native code in
  the container).
- Per-OS code paths increase test surface (need both POSIX and Windows
  CI).

**Satisfies**: `FR-SRV-001/013/018/019/020`, `NFR-REL-001/002/003/005`,
`NFR-COMP-001`, `NFR-SEC-004`, `C-01`.
**Tensions**: none.

## Decision

We adopt **Option 3**. The Server Process Manager and Lock & Lockout
Service are the **only** host-owned components in the container that deal
with OS process lifecycle. Everything else (application lifecycle, signal
handling, graceful shutdown orchestration) is delegated to `forge/lifecycle`.

The Windows Job Object native addon is the only native code in the
container. It is isolated to a single module (`src/lifecycle/win-job-object.ts`)
with a POSIX no-op shim, so the rest of the codebase is platform-agnostic.

## Rationale

HLD ADR-003 already analyzed the options in detail and chose Option B-1
(process groups + Job Objects + taskkill fallback + pids.json). This LLD
ADR does not revisit that decision — it codifies the **LLD-level**
consequence: process lifecycle is host-owned, and no forge/engine-lib
primitive is reused for it.

The forge-first / engine-lib-first rule (ADR-LLD-001) requires that we
document the gap. This ADR is that documentation.

## Consequences

**Positive**:

- All HLD ADR-003 requirements satisfied.
- POSIX path is pure JS — no native addon for Linux/macOS.
- Windows Job Object lifetime binding is the strongest possible cleanup
  guarantee.
- `data/pids.json` provides a recovery register for the worst case.

**Negative**:

- One native addon for Windows Job Objects.
- Per-OS code paths require both POSIX and Windows CI runners.

**Neutral**:

- The `taskkill` fallback is rarely used in practice (only after a hard
  crash), but it's the safety net for the case where the Job Object is
  gone.

## Mitigations for negative consequences

- **Native addon** → Isolated to a single module with a POSIX no-op shim.
  The addon is loaded lazily only on Windows. If the addon fails to load,
  the manager falls back to `taskkill /T /F` for stop and logs a warning
  (degraded mode — crash cleanup is weaker but explicit stop still works).
- **Per-OS CI** → Use GitHub Actions matrix builds (Ubuntu + Windows). The
  `tests.md` §Reliability scenario "stale PID cleanup" runs on both.

## Links

- Implements HLD ADR: ADR-003
- Related LLD ADRs: ADR-LLD-001 (the gap is documented here)
- SRS sections: §3.6 (Minecraft Process Interface), §4.3 (Server Lifecycle),
  §6.4 (PID Tracking Model)
- Affected LLD files: `design.md`, `data-model.md`, `migration-plan.md`,
  `sequences.md`, `errors.md`, `tests.md`
