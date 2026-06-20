# Idempotency Rules — TUI & CLI Process

This component has two distinct idempotency surfaces:

1. **Operator slash-commands** — short-lived (5 s), in-process, keyed by
   the caller-supplied `Idempotency-Key` header. Prevents accidental double-Enter from
   double-spawning.
2. **Agent tool executions** — handled inside the engine-lib run loop.
   Tool calls within a single `runAgent` are deduped by argument hash.
   Across runs, idempotency is the model's responsibility (it sees tool
   failures and can choose not to retry).

There is **no DB-backed idempotency store**. Rationale: the manager is
single-process, interactive, and short-lived. A 5 s in-process window covers
the realistic failure modes (double-Enter, network-retry storms from the TUI
client) without the complexity of a persistent store. See "Idempotency key
storage" below for the trade-offs.

---

## General rules

- **Header**: `Idempotency-Key: <uuid>` (required on all mutating operator
  commands; ignored on agent tools). The TUI always sends one.
- **Key format**: client-generated UUID v4. The TUI generates one
  automatically when the operator presses Enter.
- **Storage**: in-process `Map<key, {response, expiresAt}>`. The key is the
  `Idempotency-Key` header value when present. If a non-TUI caller omits the
  header, the defensive fallback key is `sha256(command + ':' + serverId + ':' + argsJson)`.
- **TTL**: 5 seconds from first use; entries are evicted lazily on lookup.
- **Body matching**: with a supplied header, the first request wins; repeats
  with the same key return the cached response regardless of body. Without a
  header, the fallback hash includes the full args.
- **Failure semantics**: if the original request failed (4xx/5xx), the
  cached response is the error response. Retrying within the window returns
  the same error. The operator can retry after the window expires.

---

## Per-operation rules

### `POST /operator/start` (operatorStart)

- **Key required**: yes.
- **Dedup window**: 5 seconds.
- **Conflict resolution**: same key+args within 5 s → return cached
  `{ok, pid, state:STARTING}` response. No second spawn.
- **Notes**: a second `/start` **after** the 5 s window is NOT a replay —
  it's a new request. If the server is now `RUNNING`, the new request
  returns `ALREADY_RUNNING` (state check, not idempotency check).
- **Sequence diagram**: see `sequences.md` § 7 "Idempotent `/start` replay".

### `POST /operator/stop` (operatorStop)

- **Key required**: yes.
- **Dedup window**: 5 seconds.
- **Conflict resolution**: same key+args within 5 s → return cached
  `{ok, state:STOPPED}` response. No second `/stop` stdin write.
- **Notes**: stopping an already-stopped server is naturally idempotent —
  without the key, a second `/stop` returns `NOT_RUNNING`. With the key, it
  returns the original `200 STOPPED`. This is the operator-friendly path.
- **Force flag**: the `force` field is part of the args hash, so
  `/stop survival` and `/stop survival force=true` are different keys.

### `POST /operator/restart` (operatorRestart)

- **Key required**: yes.
- **Dedup window**: 5 seconds, **per phase**. The restart is implemented as
  sequential `stop` + `start`; each phase has its own idempotency key
  (derived from the restart key + phase suffix).
- **Conflict resolution**: a second `/restart survival` within 5 s of the
  first returns the in-flight result (whatever phase it's in).
- **Notes**: if the `stop` phase succeeds but the `start` phase fails, the
  server is left `STOPPED`. A replay within the window returns the same
  failure; a new `/restart` after the window attempts a fresh `start`.

### `POST /operator/chat` (operatorChat)

- **Key required**: yes.
- **Dedup window**: 5 seconds.
- **Conflict resolution**: same key+args within 5 s → return cached
  `runId` (the in-flight or completed run). The TUI re-subscribes to the
  same `RunHandle` async iterable; tokens that already arrived are not
  replayed, but new tokens continue streaming.
- **Notes**: this is the most important idempotency surface for operator
  chat — without it, a double-Enter would spawn two concurrent agent runs
  on the same session, which would interleave tokens in the TUI and double-
  charge the LLM provider.
- **After the window**: a new `/chat` with the same message starts a new
  run. The session accumulates both turns.

### `POST /operator/clear` (operatorClear)

- **Key required**: yes.
- **Dedup window**: 5 seconds.
- **Conflict resolution**: same key+args within 5 s → return cached
  `{cleared: N}`. No second clear (the in-memory handles are already gone).
- **Notes**: `/clear` does NOT delete rows from `data/sessions.db` — it
  only drops in-memory `Session` handles. The persisted history remains
  and can be `/resume`d. A second `/clear` after the window is a no-op
  (returns `{cleared: 0}` because there's nothing to drop).

### Agent tool: `run_command`

- **Key required**: no (the engine-lib run loop handles dedup).
- **Dedup mechanism**: within a single `runAgent` call, engine-lib hashes
  tool-call arguments and skips duplicates. Across runs, the model decides.
- **Notes**: `run_command` is NOT naturally idempotent — running `say Hello`
  twice broadcasts "Hello" twice. The agent's system prompt should instruct
  it to structure operations idempotently (e.g. `whitelist add Steve` is
  idempotent; `give Steve diamond 1` is not). This is a prompt-engineering
  concern, not a design concern.

### Agent tool: `read_file`

- **Key required**: no.
- **Dedup mechanism**: same as `run_command`.
- **Notes**: `read_file` is naturally idempotent (reading the same file
  twice returns the same content, assuming no concurrent writes). The
  engine-lib run-loop dedup is sufficient.

### Agent tool: `write_file`

- **Key required**: no.
- **Dedup mechanism**: same as `run_command`.
- **Notes**: `write_file` is **idempotent in effect** — writing the same
  content to the same path twice leaves the file in the same state. The
  engine-lib run-loop dedup prevents the duplicate write; even if it didn't,
  the second write would be a no-op. However, writing different content
  (e.g. appending) is NOT idempotent — the prompt must guide the agent.

---

## Idempotency key storage

The in-process `Map<hash, {response, expiresAt}>`:

| Field       | Type                                                                   | Notes               |
| ----------- | ---------------------------------------------------------------------- | ------------------- |
| `hash`      | string (sha256 hex)                                                    | PK                  |
| `response`  | `StartServerResponse \| StopServerResponse \| AgentRunResponse \| ...` | The cached response |
| `expiresAt` | `number` (epoch ms)                                                    | `now() + 5000`      |

**Eviction**: lazy on lookup. A periodic sweep (every 60 s) removes expired
entries to bound memory. Worst-case size: ~10 entries (one per server) ×
5 s window = trivial.

**Why not DB-backed?**

- The manager is single-process; no cross-process replay is possible.
- The 5 s window is shorter than any plausible network-retry storm.
- A DB-backed store would add a write to `sessions.db` on every operator
  command — unnecessary I/O for an interactive tool.
- If the manager crashes mid-command, the in-flight result is lost; the
  operator re-issues the command after restart. This is acceptable for an
  interactive terminal tool (the operator is present to observe).

**Why not Redis/external?**

- The manager is single-host; no external cache is justified.
- HLD §02 explicitly says "No Redis, no Kafka, no external cache."

---

## What NOT to do

- **Don't dedup based on time alone.** Two `/start survival` commands 10 s
  apart are different intents (the first may have failed; the second is a
  retry). The 5 s window is short enough that a replay within it is almost
  certainly accidental.
- **Don't cache forever.** 5 s covers accidental double-Enter; longer would
  mask legitimate retries.
- **Don't apply operator-command idempotency to in-game mentions.** Player
  mentions are rate-limited separately (per-(player, agent) sliding window
  - cooldown). Adding idempotency on top would double-suppress legitimate
    retried mentions after a transient failure.
- **Don't dedup `read_file` across runs.** The file may have changed. The
  engine-lib run-loop dedup within a single `runAgent` is sufficient.
