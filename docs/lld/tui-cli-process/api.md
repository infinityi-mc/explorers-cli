# API Summary — TUI & CLI Process

The machine-checkable contract lives in [`openapi.yaml`](./openapi.yaml). This
file is the human-readable companion: it summarizes the API style, lists the
endpoints, and calls out the common patterns. If anything here conflicts with
the spec, **the spec wins**.

---

## API style

`explorers-cli` is a **local terminal application** (NG-5: no inbound HTTP
server). The "API" in this LLD is therefore not a network API — it is a
contract over **three in-process / child-process interface surfaces** that
the container exposes:

1. **Operator TUI slash-command interface** — commands the operator types in
   the TUI command line (`/start`, `/stop`, `/chat`, etc.). These are routed
   by a host-owned `CommandRouter` through the read-only mode gate
   (ADR-LLD-003) and then dispatched to the corresponding component. The
   OpenAPI spec models them as `POST /operator/<command>` operations so the
   request/response shapes are machine-checkable.
2. **In-game chat interface** — the log-line pattern the Chat Parser
   recognizes on Minecraft server stdout (`POST /ingame/chat` models the
   parsed shape), and the `/tellraw` stdin writes the Agent Executor emits
   back to the server (`POST /ingame/tellraw`).
3. **Agent tool-call schema** — JSON-Schema tool definitions registered with
   the LLM provider via `@infinityi/engine-lib`. The provider advertises
   these schemas to the model; the model returns tool calls whose arguments
   are validated against the same schemas by `engine-lib`'s run loop. The
   OpenAPI spec models them as `POST /agent-tools/<tool>` operations.

All three surfaces are in-process; no HTTP server is started. The OpenAPI
spec exists purely so the contracts are machine-checkable and can drive
contract tests.

**Implements HLD ADRs**: ADR-001 (REST+SSE for LLM provider comms — engine-lib
providers handle this internally), ADR-004 (sandboxed tool broker — engine-lib
tools-shell + tools-fs), ADR-006 (chat parser + permissions), ADR-008
(read-only mode enforcement on operator commands).

---

## Endpoint table

### Operator commands (`/operator/*`)

| Method | Path | operationId | Summary | Auth | Idempotent? | Read-only? |
|---|---|---|---|---|---|---|
| POST | /operator/start | operatorStart | Start a server | operator (local) | yes (5 s window) | blocked |
| POST | /operator/stop | operatorStop | Stop a server | operator | yes (per-state) | blocked |
| POST | /operator/restart | operatorRestart | Stop + start | operator | yes (per-phase) | blocked |
| POST | /operator/chat | operatorChat | Chat with an agent | operator | yes (5 s window) | blocked |
| GET | /operator/session | operatorSessionList | List sessions | operator | n/a (GET) | **allowed** |
| POST | /operator/resume | operatorResume | Load session history into TUI | operator | n/a (read-only op) | **allowed** |
| POST | /operator/clear | operatorClear | Drop in-memory session handle | operator | yes (5 s window) | blocked |
| GET | /operator/help | operatorHelp | List commands | operator | n/a (GET) | **allowed** |

"Auth" is the local operator (no per-operator authentication in v1 — the OS
account is the trust boundary, per ADR-008). "Read-only?" indicates whether
the command is allowed when the manager was started with `--read-only`.

### In-game chat interface (`/ingame/*`)

| Method | Path | operationId | Summary | Caller |
|---|---|---|---|---|
| POST | /ingame/chat | ingameChatLine | Parsed chat line from Minecraft stdout | Chat Parser (internal emitter) |
| POST | /ingame/tellraw | ingameTellraw | `/tellraw` stdin write to Minecraft server | Agent Executor (internal) |

The `ingame/chat` endpoint is **not invoked over HTTP** — it's the contract
for the parsed shape emitted by the Chat Parser. The `ingame/tellraw` endpoint
is the contract for stdin writes the Agent Executor emits; again, not HTTP.

### Agent tools (`/agent-tools/*`)

| Method | Path | operationId | Summary | Provided by |
|---|---|---|---|---|
| POST | /agent-tools/run_command | agentRunCommand | Execute a Minecraft console command | `engine-lib/tools-shell` `shellTools().runCommand` |
| POST | /agent-tools/read_file | agentReadFile | Read a file inside the server sandbox | `engine-lib/tools-fs` `filesystemTools().read` |
| POST | /agent-tools/write_file | agentWriteFile | Write a file inside the server sandbox | `engine-lib/tools-fs` `filesystemTools().writeFile` |

These are JSON-Schema tool definitions advertised to the LLM provider. The
"endpoint" framing in the OpenAPI spec is for contract-test convenience —
in practice, the engine-lib run loop invokes the `execute` function on the
`ToolDefinition` directly; there is no HTTP call.

---

## Common patterns

### Error envelope

Every error response (operator command or tool result) uses the shared
`Error` schema from `openapi.yaml`:

```json
{
  "code": "PORT_CONFLICT",
  "message": "Port 25565 is already in use by another process.",
  "details": { "port": 25565 }
}
```

- `code` — stable string from `errors.md`. Never renamed, never renumbered.
- `message` — human-readable English source string.
- `details` — optional structured payload specific to the code.

For agent tools, the shape is `ToolResult = { ok: true, content: ... } | { ok: false, error: "..." }`
(engine-lib's stable contract). Tool failures are recoverable domain errors
returned to the model; only unexpected implementation faults throw.

### Pagination envelope

Only one list endpoint exists (`GET /operator/session`). It returns a flat
array — the expected session count is small (≤ 10 servers × ≤ 5 agents = ≤ 50
active sessions). Cursor pagination is overkill; if the count ever grows
beyond ~200, a follow-up LLD will introduce cursor pagination per the
OpenAPI reference's `PaginationEnvelope`.

### Idempotency-Key header

Required on all mutating operator commands. The command router dedupes within
a 5-second window by the UUID v4 header value. See `idempotency.md` for the
full rules. Agent tools do not use the header — their idempotency is handled
at the engine-lib run-loop level (tool-call argument hashing within a single
`runAgent` call).

### Rate limiting

Player-initiated agent mentions are rate-limited per `(playerName, agentId)`
using `forge/resilience/rate-limit` `slidingWindowRateLimiter({limit: rpm,
windowMs: 60_000})` plus a per-key cooldown `Map`. Rate-limited mentions are
silently ignored (FR-CHAT-010). Operator commands are not rate-limited.

### Streaming

`POST /operator/chat` and in-game mentions both trigger an agent run in
**streaming mode** (`runAgent(agent, { stream: true })`). Tokens arrive as
`RunEvent` variants (`message`, `token`, `tool.call`, `tool.result`,
`run.finish`) on the engine-lib `RunHandle` async iterable. The TUI
subscribes via `for await (const event of handle)` and renders each `token`
event immediately. The final `RunResult` is obtained from
`handle.completed`.

---

## Versioning

The three interface surfaces evolve independently:

- **Operator commands**: slash-command names are stable forever. New commands
  are appended; existing commands keep their name and semantics. A
  `/help` listing is the discoverability surface.
- **In-game chat format**: tied to vanilla Minecraft Java Edition 1.20+ log
  format. If Minecraft changes the log format in a future release, a new
  parser version will be required (out of scope for v1 — ADR-006 explicitly
  targets vanilla 1.20+).
- **Agent tools**: tool names (`run_command`, `read_file`, `write_file`) are
  stable. New tools can be added (the HLD mentions a future plugin SDK,
  NFR-MNT-001, deferred). Tool argument schemas can be extended additively
  (new optional fields); removing or renaming fields is a breaking change.

The OpenAPI spec's `info.version` is the spec's own version (semver),
independent of the URL version. v1.0.0 is the initial LLD baseline.

---

## Cross-references

- Full machine-checkable contract: [`openapi.yaml`](./openapi.yaml)
- Error catalog: [`errors.md`](./errors.md)
- Idempotency rules: [`idempotency.md`](./idempotency.md)
- Component design narrative (including the forge/engine-lib capability
  mapping): [`design.md`](./design.md)
- Sequence diagrams for the critical flows: [`sequences.md`](./sequences.md)
