# ADR-005: Enforce Bounded Log Ingestion Rate Limits and Buffer Caps

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: performance, resilience, logs

## Context

Minecraft server processes output verbose log logs to stdout/stderr. Under normal operation, log output is lightweight. However, during server initialization, player login rushes, or when custom server mods crash/fail, log outputs can spike to tens of thousands of lines per second.
If the manager process attempts to ingest and buffer all log streams without bounds, the Bun runtime thread can experience CPU starvation (blocking TUI render loops) or run out of memory (OOM crashes) (NFR-PERF-003).
We need an architectural decision to enforce bounded log ingestion and allocate fixed-size memory limits per managed server.

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `NFR-PERF-004` — Rate-limiting stdout parsing to `maxLinesPerSecond` (default 5000) and tracking dropped lines.
- `NFR-REL-006` — Capping in-process log buffers to `maxBufferBytes` (default 16 MB) per server.
- `NFR-PERF-003` — Process RSS memory boundaries (200-500 MB).
- `MCIF-4` — Reading server process streams for logging and chat triggers.

## Options considered

### Option 1: Unbounded Log Ingestion and Dynamic Arrays

Ingest stdout chunks as they arrive, split them on newlines, append to a dynamic array, and keep full scrollback in memory.

- **Pros**:
  - Simple array appends.
  - Preserves entire history of server output in memory.
- **Cons**:
  - Severe memory vulnerability. A server output loop can consume 1 GB+ memory in minutes, violating NFR-PERF-003 and crashing the application.
  - Renders TUI unresponsive under stream floods.
- **Satisfies**: `MCIF-4`
- **Tensions**: `NFR-PERF-004`, `NFR-REL-006`, `NFR-PERF-003`

### Option 2: Rate-Limited Stream Reading and Bounded Ring Buffers

Implement a token-bucket rate limiter on stdout stream reading. Drop lines exceeding `maxLinesPerSecond` and expose a counter. Maintain a fixed-size ring buffer or array slice capping at `maxBufferBytes` per server.

- **Pros**:
  - Restricts memory overhead to a predictable maximum budget per server (satisfies NFR-REL-006).
  - Prevents CPU starvation under loop conditions by choking parsing passes (satisfies NFR-PERF-004).
  - Keeps RSS footprint within bounds (satisfies NFR-PERF-003).
- **Cons**:
  - Older log lines are purged from memory, and flooded lines are dropped (though still written to disk by the Minecraft server itself).
- **Satisfies**: `NFR-PERF-004`, `NFR-REL-006`, `NFR-PERF-003`, `MCIF-4`
- **Tensions**: None.

---

## Decision

We will implement a rate-limiting parser on stdout stream channels that drops lines exceeding `maxLinesPerSecond` (default 5000) and limits the in-memory scroll buffer to `maxBufferBytes` (default 16 MB) per server using sliding queue bounds.

---

## Rationale

Option 2 enforces structural bounds at the ingress point of the application. By dropping lines exceeding the threshold and capping memory queues, we guarantee that even if 10 servers experience simultaneous crash loops, the TUI process remains responsive and operates within its 500 MB RSS ceiling. The operator can track dropped logs via a warning count in the TUI, while the full log remains accessible in the server's own physical `logs/` directory.

---

## Consequences

**Positive**:

- Predictable, bounded memory consumption.
- TUI is insulated against crash-loop log freezes.
- Dropped line counters alert the operator to server issues.

**Negative**:

- The operator cannot review flooded log lines in the TUI console during rate-limit periods.

**Neutral**:

- Dropping lines does not affect the physical log writing performed by the Java process itself.

---

## Mitigations for negative consequences

- **Purged or dropped logs** → Educate operators in the TUI help commands that when logs are dropped, the complete log output remains persisted at `<server.path>/logs/latest.log` on the filesystem.

---

## Links

- Related ADRs: `ADR-003-process-management-bun-spawn.md`
- SRS sections: Section 4.3 (Server Lifecycle), Section 5.2 (Performance)
