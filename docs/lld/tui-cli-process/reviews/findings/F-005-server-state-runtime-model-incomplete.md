# F-005: `ServerState` runtime model missing `lastError`, `restartCount`, `lastSuccessfulStart`, `startTime`, and `STOPPING`

- **Severity**: Major
- **Dimension**: data-model
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/domain.md` lines 100–106 (`ServerState` enum has only `STOPPED, STARTING, RUNNING, FAILED`)
  - `docs/lld/tui-cli-process/openapi.yaml` line 586 (`StartServerResponse.state` enum has only `STARTING, RUNNING, FAILED, STOPPED`)
  - `docs/lld/tui-cli-process/data-model.md` (no `ServerState` table; `RuntimeConfig.servers` is purely config not runtime state)
  - `docs/lld/tui-cli-process/design.md` Algorithm 2 (state transitions `STOPPED → STARTING → RUNNING`, never `STOPPING`)
- **HLD reference**: HLD `00-requirements.md` row FR-SRV-016 (lastError clear) and FR-SRV-017 (stdin close)
- **SRS reference**: `docs/srs/srs.md` lines 559–566 (`interface ServerState` with `status`, `pid`, `startTime`, `lastSuccessfulStart`, `restartCount`, `lastError`) and `docs/srs/srs.md` line 560 (`status: "stopped" | "starting" | "running" | "stopping" | "failed"`)
- **Status**: Resolved

**Resolution**: `ServerState` now includes `STOPPING`; OpenAPI responses include the SRS runtime fields; `data-model.md` defines `RuntimeServerState`; `design.md`, `errors.md`, `observability.md`, and `traceability.md` cover `lastError`, restart clearing, and unexpected stdin close.

**Finding**: The SRS §6.2 specifies a `ServerState` runtime model with five fields beyond `status` and `pid`:
- `startTime: string | null` (ISO 8601)
- `lastSuccessfulStart: string | null` (ISO 8601)
- `restartCount: number`
- `lastError: string | null`
- Plus a fifth status value `"stopping"` (currently missing from the LLD enum).

The LLD has:
- `ServerState` enum with 4 values (missing `STOPPING`).
- `StartServerResponse` schema exposes only `serverId, state, pid` — no `lastError`, no `startTime`, no `restartCount`, no `lastSuccessfulStart`.
- No `ServerState` table or in-memory shape documented in `data-model.md`.
- `design.md` Algorithm 2 transitions directly from `RUNNING` to `STOPPED` on graceful stop — no `STOPPING` intermediate state. The `Server.stop(force)` method comment in `domain.md` line 162 mentions "Updates state and PID registry" but doesn't add the intermediate state.

This gap directly breaks two MUST-level SRS requirements:
- **FR-SRV-016**: "After a successful restart, the system MUST clear `lastError`." Without the `lastError` field, there is nothing to clear.
- **FR-SRV-017**: "If server stdin closes unexpectedly, the system MUST log a warning, notify the operator in the TUI, and MUST NOT crash." Without an `UnexpectedStdinClose` runtime signal and an explicit `lastError` value, there is no place to record the failure.

**Why it matters**: Without `lastError`, the TUI cannot display "Server exited before becoming ready (exit code: X)" (SRS AC-038) or other failure messages to the operator. Without `restartCount`, the operator cannot distinguish a server that has crashed once from one that has crashed 50 times (relevant for crash-loop alerting — see observability.md `ServerCrashLoop` alert). Without `STOPPING`, the TUI cannot show a "stopping…" spinner during graceful shutdown — it goes from `RUNNING` directly to `STOPPED`.

**Recommendation**:
1. Add `STOPPING` to the `ServerState` enum in `domain.md` and the `StartServerResponse.state` enum in `openapi.yaml`. Update `design.md` Algorithm 2 to transition `RUNNING → STOPPING → STOPPED` during graceful stop.
2. Add a `RuntimeServerState` interface to `data-model.md` (or `domain.md`) mirroring the SRS shape: `{status, pid, startTime, lastSuccessfulStart, restartCount, lastError}`. Document where this state is held (in-memory in the Server Process Manager; not persisted).
3. Extend `StartServerResponse` (and the corresponding `GetServerState` API if added) to expose `lastError`, `restartCount`, `lastSuccessfulStart`, `startTime`.
4. Update `sequences.md` §1 and §2 to show `lastError` being set on failure and being cleared on successful restart.
5. Add a new `errors.md` code `UNEXPECTED_STDIN_CLOSE` (or similar) for FR-SRV-017; reference it from `observability.md` `server_stdin_closed` event.
6. Update `traceability.md` to add FR-SRV-016 and FR-SRV-017 rows.

**Customer/designer question**: N/A — this is structural alignment with the SRS.
