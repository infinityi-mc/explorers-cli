# F-015: `isPortFree(server.serverPort)` in `design.md` Algorithm 2 has no timeout — could block the event loop indefinitely

- **Severity**: Minor
- **Dimension**: implementability
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/design.md` line 277 (`if not await isPortFree(server.serverPort): return { ok:false, code:'PORT_CONFLICT' }`)
  - `docs/lld/tui-cli-process/errors.md` line 19 (`PORT_CONFLICT` mapped from `isPortFree()` returned false)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-SRV-008 ("Verify server port is free before starting")
- **SRS reference**: `docs/srs/srs.md` line 290 (FR-SRV-008) and A-5 (active binding check)
- **Status**: Resolved

**Resolution**: Algorithm 2 now calls `isPortFree(server.serverPort, timeoutMs=1000)`, and the test strategy includes a port-bind hang scenario.

**Finding**: `design.md` Algorithm 2 calls `isPortFree(server.serverPort)` to verify the port is free before spawning the Java child process. The contract for `isPortFree()` is not specified:
- No timeout (a hanging kernel-level bind could block the event loop indefinitely).
- No retry policy (a TIME_WAIT socket from a recent crash could falsely report the port as in use).
- No error mapping for "bind failed for non-conflict reasons" (e.g. permission denied on a privileged port — but FR-CFG-006 caps `serverPort` at 1024..65535 so this shouldn't happen).

`tests.md` §Reliability includes "Log flood (10,000 lines/s from a misbehaving server) → rate limiter drops lines beyond 5000/s, dropped counter increments, TUI stays responsive" but does not include a port-bind hang scenario.

**Why it matters**: A misbehaving host firewall or an IPv6 socket stuck in CLOSE_WAIT could cause `isPortFree()` to hang forever. The TUI would freeze at `/start`. The user would not see a clean error.

**Recommendation**:
1. Specify `isPortFree(port, timeoutMs = 1000)` with a default 1-second timeout. On timeout, treat as `PORT_CONFLICT` (conservative) with details indicating timeout.
2. Implement using `Bun.connect` (which supports `socket.setTimeout` indirectly) or a raw `dgram` / `net` bind with explicit timeout. The LLD should declare which mechanism.
3. Add a test scenario to `tests.md` §Reliability: "Port bind hangs for >1 s → `/start` returns `PORT_CONFLICT` within 2 s, TUI does not freeze."

**Customer/designer question**: N/A — this is a resilience gap that needs a defensive default.
