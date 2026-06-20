# PHASE-005 - Log Ingestion And Hot Reload

**Status**: Planned  
**Goal**: Add bounded stdout ingestion, TUI scrollback, dropped-line telemetry, hot-reload validation, and pending-restart handling.  
**Depends on**: PHASE-004  
**LLD sources**: `design.md` Algorithms 3 and 4, Caching; `sequences.md` section 5; `observability.md` Log ingestion metrics and Config metrics; ADR-005; ADR-008; `tests.md` Performance and Reliability scenarios  
**Review findings addressed**: None

## Scope

- Per-server stdout/stderr log reader with line splitting.
- Forge token bucket rate limiter at 5000 lines/s per server.
- 16 MB per-server ring buffer with oldest eviction and dropped/evicted counters.
- TUI scrollback and dropped-count display.
- Config file hot-reload with debounce, same-schema validation, last-known-good snapshot, changed-key diff, and pending-restart markers.
- Permission, agent, provider, and tool policy index rebuild hooks.

## Out Of Scope

- Chat parser interpretation of log lines; PHASE-006.
- Agent/provider execution using rebuilt indexes; PHASE-007.
- Tool policy rebuild implementation details; PHASE-009 completes tool behavior.

## Implementation Units

| Unit ID | Type | Summary | Source | Risk |
| ------- | ---- | ------- | ------ | ---- |
| IU-018 | flow | Add bounded log reader with forge token bucket, 16 MB ring buffer, dropped/evicted counters, and scrollback updates. | `design.md` Algorithm 3 | Medium |
| IU-019 | flow | Render server status, scrollback, dropped counts, hot-reload banners, and pending restart markers in the TUI. | `observability.md` Dashboard | Medium |
| IU-020 | reliability | Implement hot-reload debounce, validation, last-known-good retention, diff, and atomic publish. | `design.md` Algorithm 4 | High |
| IU-021 | security | Rebuild permission, agent, provider, and tool policy indexes on valid hot-reload. | `design.md` Caching | Medium |
| IU-034 | test | Cover log flood, buffer cap, and hot-reload rejection. | `tests.md` Reliability and Performance | High |

## Work Items

1. Implement per-server log reader attachment from PHASE-004 process handles.
2. Split chunks into lines and apply a per-server token bucket before buffer writes.
3. Implement fixed-capacity ring buffer accounting by bytes and evict oldest lines when full.
4. Forward accepted lines to TUI scrollback and later chat parser seam; dropped lines increment counters only.
5. Surface buffer size, capacity, dropped count, and server state in the TUI.
6. Implement `config.yaml` watcher with 200 ms debounce for editor atomic saves.
7. Validate candidate config through the same schema used at boot.
8. Reject invalid reloads, more than 10 servers, or removal of RUNNING/STARTING servers; retain last-known-good snapshot.
9. Compute apply-now and apply-on-restart changed keys, publish valid snapshots atomically, rebuild indexes, and set pending restart markers.
10. Add hot-reload metrics and warning banners.
11. Add tests for deleted config, invalid schema, adding agent, removing running server, and process-affecting field changes.

## Data And Deployment Notes

- Log buffers are in memory; they should not write Minecraft server logs.
- Hot-reload must not mutate currently running process parameters; mark pending restart instead.
- Rollback can disable watcher and continue using boot config without data migration.

## Tests And Verification

- Unit tests: ring buffer byte accounting, line splitting, rate limiter denial branch, config diff classification.
- Integration tests: stub child log flood, 16 MB cap eviction, invalid config retains old snapshot, add-agent reload rebuilds indexes.
- Contract tests: no new API shapes unless TUI command responses change.
- End-to-end or smoke tests: running stub server emits logs and TUI scrollback updates without lag.
- Manual checks: edit `config.yaml` and verify success/rejection banners.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Metrics: ingested total, dropped total by reason, buffer bytes, buffer capacity, config reload totals, reload duration, pending restart gauge.
- Logs: hot reload outcome, changed keys, pending restart servers, dropped-line warnings without raw chat content at INFO.
- Alerts are not evaluated in-process; ensure metric names match `observability.md`.

## Acceptance Criteria

- Log flood beyond 5000 lines/s drops excess lines and keeps the TUI responsive.
- Buffer size never exceeds 16 MB per server.
- Valid hot-reload publishes within the LLD's 2 second target in tests.
- Invalid hot-reload keeps the previous config and shows a warning.
- Removing a running server is rejected until the operator stops it.

## Review Packet

- Expected files or modules touched: log reader, ring buffer, TUI log panel, config watcher, index rebuild hooks, tests.
- LLD sections reviewers should compare against: `design.md` Algorithms 3 and 4, `sequences.md` section 5, `observability.md` metrics, `tests.md` performance/reliability.
- Expected evidence: log flood test output, buffer cap metrics sample, hot-reload terminal capture, TUI screenshot or capture.

## Risks And Questions

- TUI render budget is implementation-defined in the LLD; if scrollback rendering lags, add virtualization or render throttling without changing the log ingestion contract.
