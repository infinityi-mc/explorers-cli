# F-017: FR-HOT-009 (port/RAM/JAR hot-reload applies only on next restart) not explicitly addressed

- **Severity**: Minor
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/sequences.md` §5 (hot-reload sequence — `SrvMgr` receives `onChange(['agents.wallace'])` and does "no-op (servers unchanged)" — no mention of port/ram/jar changes)
  - `docs/lld/tui-cli-process/design.md` Algorithm 4 (tryReload — validates and publishes; no per-field "apply-now vs apply-on-restart" classification)
  - `docs/lld/tui-cli-process/traceability.md` (FR-HOT-009 not in the table)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-HOT-009 ("Port, RAM, JAR updates apply only on next restart")
- **SRS reference**: `docs/srs/srs.md` line 273 (FR-HOT-009) — referenced via HLD but not yet verified in SRS
- **Status**: Resolved

**Resolution**: Algorithm 4 now classifies apply-now versus apply-on-restart fields, observability includes a pending-restart gauge, and FR-HOT-009 is traced.

**Finding**: FR-HOT-009 mandates that changes to `serverPort`, `ram`, and `jarFile` (i.e. server process-affecting fields) apply only on the next restart, not on hot-reload. The LLD's hot-reload sequence (sequences.md §5) and Algorithm 4 do not classify fields by "apply-now" vs "apply-on-restart":
- "Apply-now" fields: `agents`, `permissions`, `featureFlags`, `providers` (the configuration gates that gate downstream behavior).
- "Apply-on-restart" fields: `serverPort`, `ram`, `jarFile` (the fields that determine how the Java child is spawned).

The LLD's Algorithm 4 says "**NFR-REL-007**: do not remove a running server from the active set" but does not classify per-field timing.

Without the classification, an implementer could naively rebuild the Server Process Manager's `Bun.spawn` arguments on hot-reload and either:
- (a) Apply the change immediately (violating FR-HOT-009 — the running Java process keeps the old port until restart, creating a divergence).
- (b) Apply no changes to running servers at all (correct, but with no TUI surface to inform the operator that the change is pending).

**Why it matters**: Without explicit classification, the operator who edits `serverPort` in `config.yaml` while the server is running will be confused: did the change take effect? Should they restart? The TUI should display a "pending restart" indicator for affected fields.

**Recommendation**:
1. Add a classification table to `design.md` Algorithm 4:
   ```
   APPLY_NOW = [agents, providers, permissions, featureFlags, server.name]
   APPLY_ON_RESTART = [serverPort, ram, jarFile, javaPath, startupTimeout]
   ```
2. Update `sequences.md` §5 to show a `cfg.pendingChanges` map populated for APPLY_ON_RESTART fields.
3. Update `observability.md` to add `pending_restart` per-server gauge so the TUI can render the indicator.
4. Add FR-HOT-009 row to `traceability.md`.

**Customer/designer question**: When the operator edits a port/ram/jar field on a running server, should the TUI show a "Restart required" banner immediately, or only on `/restart`? FR-HOT-009 doesn't say. The most useful behavior is a persistent banner.
