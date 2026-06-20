# Sequence Diagrams — TUI & CLI Process

> **Implements HLD ADRs**: 001 (REST+SSE), 002 (SQLite WAL), 003 (Bun.spawn),
> 004 (sandbox), 005 (bounded log ingestion), 006 (chat parser), 007
> (observability), 008 (runtime mode + hot-reload).

Eight critical flows are documented below. Each diagram references real
participants from the HLD L2 view (no invented external systems). Per the
skill reference's `sequence-diagrams.md`, each includes explicit
participants, specific message labels, alt blocks for branching, loop blocks
for retries, and notes for non-obvious decisions.

---

## 1. Operator `/start` — happy path

The operator types `/start survival` in the TUI command line. The Command
Router validates the command, the Server Process Manager spawns the Java
child process, the Log Reader attaches to stdout, and the TUI shows state
`STARTING` → `RUNNING`.

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant TUI as TUI View Engine
    participant Router as Command Router
    participant SrvMgr as Server Process Manager
    participant Lock as Lock & Lockout Service
    participant Log as Log Reader & Rate Limiter
    participant MC as Minecraft Java Server
    participant DB as sessions.db (SQLite WAL)

    Operator->>TUI: /start survival
    TUI->>Router: dispatch({cmd:'start', serverId:'survival'})
    Router->>Router: classifyCommand (ADR-LLD-003)
    alt Normal mode
        Router->>SrvMgr: start('survival')
        SrvMgr->>SrvMgr: realpath(server.path) (cached)
        SrvMgr->>SrvMgr: containment check on jarFile (NFR-SEC-002)
        SrvMgr->>SrvMgr: isPortFree(25565) (FR-SRV-008)
        SrvMgr->>MC: Bun.spawn(java -Xmx4096M -jar server.jar nogui)
        MC-->>SrvMgr: child.pid (4242)
        SrvMgr->>Lock: pids.json.set('survival', 4242)
        Lock->>Lock: atomic write (temp + rename)
        SrvMgr->>Log: attach('survival', child.stdout)
        SrvMgr-->>Router: { ok:true, pid:4242, state:STARTING }
        Router-->>TUI: render state=STARTING
        TUI-->>Operator: panel shows "survival: STARTING (pid 4242)"
        loop until "Done!" line or startup timeout
            MC-->>Log: stdout chunk
            Log->>Log: rateLimiter.tryAcquire (ADR-005)
            alt Within rate
                Log->>Log: ringBuffer.push (16 MB cap)
                Log->>TUI: scrollback push
            else Over rate
                Log->>Log: droppedCounter++
            end
            Log->>Log: chatParser.parse (no match during boot)
        end
        alt "Done!" seen within startupTimeout
            Log->>SrvMgr: state event: RUNNING
            SrvMgr->>DB: audit(start, ok)
            SrvMgr-->>TUI: state=RUNNING
            TUI-->>Operator: panel shows "survival: RUNNING"
        else startupTimeout exceeded
            SrvMgr->>SrvMgr: forceKillChildTree(child)
            SrvMgr->>DB: audit(start, failed, STARTUP_TIMEOUT)
            SrvMgr-->>TUI: state=FAILED
            TUI-->>Operator: panel shows "survival: FAILED (startup timeout)"
        end
    else Read-only mode
        Router-->>TUI: reject READ_ONLY_BLOCKED
        TUI-->>Operator: "Blocked in --read-only mode"
    end
```

**Notes**:
- The PID is recorded in `pids.json` **before** the startup timeout timer is
  set, so a crash during startup still leaves a recoverable PID entry
  (NFR-REL-002).
- The audit write is async — the TUI does not wait for it.
- The Chat Parser runs on every line but only matches chat lines; during
  server boot, no chat lines are emitted.

---

## 2. Server crash detection and cleanup

A running Minecraft server crashes (JVM segfault). The Bun exit listener
fires within 2 s (NFR-REL-005), the state goes `RUNNING → FAILED`, the PID is
removed from `pids.json`, and the TUI shows the failure.

```mermaid
sequenceDiagram
    autonumber
    participant SrvMgr as Server Process Manager
    participant Log as Log Reader & Rate Limiter
    participant Lock as Lock & Lockout Service
    participant Hub as EventHub
    participant Audit as audit_entries
    participant TUI as TUI View Engine
    participant MC as Minecraft Java Server

    MC-->>SrvMgr: child.exited (code=139, SIGSEGV)
    SrvMgr->>SrvMgr: clearTimeout(startupTimer)
    SrvMgr->>SrvMgr: serverState['survival'] = FAILED
    SrvMgr->>Lock: pids.json.delete('survival')
    Lock->>Lock: atomic write
    SrvMgr->>Log: detach('survival')
    Log->>Log: stop reading child.stdout
    SrvMgr->>Hub: emit(RunEvent.custom: server.crashed)
    Hub->>Audit: insert (actionType='crash', serverId='survival', outcome='failed')
    Hub->>TUI: state event: FAILED, exitCode=139
    TUI-->>TUI: render "survival: FAILED (crashed, exit 139)"
```

**Notes**:
- The state transition happens **before** the audit write, so even if the
  audit write fails (e.g. disk full), the TUI still shows the crash.
- `Log.detach` stops the `for await` loop on `child.stdout`; the stream is
  already closed by the OS because the child is dead.
- A crashed server is NOT automatically restarted in v1 (the operator must
  `/restart` manually). A follow-up LLD may add auto-restart policy.

---

## 3. Player `@mention` triggers an agent run (happy path)

A player `Steve` types `@assistant hello` in the in-game chat. The Chat
Parser recognizes the mention, authorizes Steve against
`permissions.survival.players`, applies the rate limit, loads the N-line
context window from the session store, runs the agent, streams tokens to the
TUI, and writes the response back to the Minecraft server via `/tellraw`.

```mermaid
sequenceDiagram
    autonumber
    actor Player as Steve (in-game)
    participant MC as Minecraft Java Server
    participant Log as Log Reader & Rate Limiter
    participant Chat as Chat Parser & Authorizer
    participant Exec as Agent Executor
    participant DB as sessions.db (SQLite WAL)
    participant LLM as LLM Provider API
    participant SrvMgr as Server Process Manager
    participant Hub as EventHub
    participant Audit as audit_entries
    participant TUI as TUI View Engine

    Player->>MC: chats "@assistant hello"
    MC-->>Log: stdout: [12:34:56] [Server thread/INFO]: <Steve> @assistant hello
    Log->>Chat: parseLine('survival', line)
    Chat->>Chat: regex match (FR-CHAT-001)
    Chat->>Chat: strip team prefix/suffix (FR-CHAT-005)
    Chat->>Chat: sanitize name ^[a-zA-Z0-9_]{1,16}$ (FR-CHAT-006)
    Chat->>Chat: find first @alias (FR-CHAT-004)
    alt No alias or invalid name
        Chat-->>Log: ignored (FR-CHAT-002)
    else Alias found
        Chat->>Chat: case-insensitive perm check (FR-CHAT-007/008)
        alt Player not authorized
            Chat->>Hub: emit(mention_denied)
            Hub->>Audit: insert (actionType='mention_denied', outcome='blocked')
            Chat-->>Log: silently ignored (FR-CHAT-010)
        else Authorized
            Chat->>Chat: rate limit check (sliding window + cooldown)
            alt Over rate
                Chat-->>Log: silently ignored (FR-CHAT-010)
            else Within rate
                Chat->>Exec: Mention({serverId, agentId, playerName, message})
                Exec->>DB: SessionStore.load(active 'survival:assistant:*')
                DB-->>Exec: messages (last N)
                Exec->>Exec: build context via engine-lib staticContext (exclude current mention)
                Exec->>LLM: provider.stream(req, ctx)
                loop stream events
                    LLM-->>Exec: StreamEvent.message_start
                    LLM-->>Exec: StreamEvent.token("Hello")
                    Exec->>TUI: render token
                    LLM-->>Exec: StreamEvent.token(", Steve!")
                    Exec->>TUI: render token
                end
                LLM-->>Exec: StreamEvent.finish
                Exec->>DB: SessionStore.append('survival:assistant:1760704496123-a1b2c3', [user, assistant])
                Exec->>Hub: emit(RunEvent.run.finish)
                Hub->>Audit: insert (actionType='mention_authorized', outcome='ok')
                Exec->>Exec: deliverInGame(response) (Algorithm 6)
                Exec->>SrvMgr: sendCommand('survival', 'tellraw @a {text:"Hello, Steve!"}')
                SrvMgr->>MC: stdin write
                Exec->>Hub: emit(tellraw_sent)
                Hub->>Audit: insert (actionType='tellraw_sent', outcome='ok')
                MC-->>Player: chat shows "Hello, Steve!"
                Exec-->>TUI: render run.finish
            end
        end
    end
```

**Notes**:
- The session key prefix is `serverId:agentId` with a timestamp+random suffix
  (ADR-LLD-004) — all players on `survival` who mention `@assistant` share
  the same active context window.
- The `/tellraw` write happens **after** `SessionStore.append`, so the
  response is durably persisted before it's shown to players. If the
  `/tellraw` write fails (server stopped mid-run), the response is still in
  the TUI and the session DB.
- The `RunEvent.run.finish` event is what the `auditSubscriber` listens for
  to write the audit entry. The audit is best-effort — if the audit write
  fails, the run still succeeds.

---

## 4. Operator `/chat` with provider timeout

The operator types `/chat assistant Summarize the latest deployment status.`
in the TUI. The LLM provider hangs; after `agent.timeout` (default 120 s),
the `forge/resilience` `timeout` policy aborts the in-flight request. The
session stays open, a TUI warning is shown, and the partial response (if any)
is persisted.

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant TUI as TUI View Engine
    participant Router as Command Router
    participant Exec as Agent Executor
    participant DB as sessions.db
    participant Pipeline as forge/resilience combine(retry, timeout)
    participant LLM as LLM Provider API
    participant Hub as EventHub
    participant Audit as audit_entries

    Operator->>TUI: /chat survival assistant Summarize deployment
    TUI->>Router: dispatch({cmd:'chat', serverId:'survival', agentId:'assistant', message:'...'})
    Router->>Router: classifyCommand (mutating, normal mode → allow)
    Router->>Exec: chat({serverId:'survival', agentId:'assistant', message})
    Exec->>DB: SessionStore.load(active 'survival:assistant:*')
    DB-->>Exec: messages
    Exec->>Pipeline: execute(provider.stream(req))
    Pipeline->>LLM: POST /v1/... (stream:true)
    loop retry up to 3 times (exponential backoff)
        alt Provider responds
            LLM-->>Pipeline: 200 OK + SSE stream
            Pipeline-->>Exec: StreamEvent.*
            Exec-->>TUI: render tokens
        else Provider hangs (no bytes for 120 s)
            Pipeline->>Pipeline: timeout fires (forge/resilience timeout)
            Pipeline->>LLM: AbortController.abort()
            LLM-->>Pipeline: stream closed (mid-chunk)
            alt Retryable (network error)
                Pipeline->>Pipeline: wait 250ms (exponential backoff)
            else Non-retryable or maxAttempts reached
                Pipeline-->>Exec: throw ProviderError(PROVIDER_TIMEOUT)
            end
        end
    end
    Exec->>Exec: catch ProviderError
    Exec->>DB: SessionStore.append('survival:assistant:1760704496123-a1b2c3', [user, assistant:partial])
    Exec->>Hub: emit(RunEvent.error, ProviderError)
    Hub->>Audit: insert (actionType='provider_timeout', outcome='failed')
    Exec-->>Router: throw PROVIDER_TIMEOUT
    Router-->>TUI: render error
    TUI-->>Operator: "Provider timeout after 120000 ms"
```

**Notes**:
- The `AbortController` is the same one passed to `fetch` via
  `engine-lib/providers`' `openSseStream` — aborting actually closes the
  socket (FR-INV-003).
- The partial response (tokens received before the hang) is persisted with
  `isError: false` but the run is marked failed in the audit.
- The retry policy retries on 429 and 5xx + network errors but NOT on
  `AbortError` from a timeout (it's already exhausted its own budget).

---

## 4b. Offline operator `/chat` without server context

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant TUI as TUI View Engine
    participant Router as Command Router
    participant Exec as Agent Executor
    participant LLM as LLM Provider API

    Operator->>TUI: /chat assistant hello
    TUI->>Router: dispatch({cmd:'chat', agentId:'assistant', message:'...'})
    Router->>Router: classifyCommand (mutating, normal mode → allow)
    Router->>Exec: chat({agentId, message, serverId:null})
    Exec->>Exec: create ephemeral in-memory session
    Note over Exec: No SessionStore.load call; no persisted session for offline chat.
    Exec->>LLM: provider.stream(req, ephemeralSession)
    loop stream events
        LLM-->>Exec: StreamEvent.token("...")
        Exec->>TUI: render token
    end
    LLM-->>Exec: StreamEvent.finish
    Note over Exec: No in-game delivery attempted (FR-INV-013).
    Exec-->>Router: ephemeralSession complete
    Router-->>TUI: render response
```

---

## 4c. Agent response delivery — chunked `/tellraw` with `/say` fallback

```mermaid
sequenceDiagram
    autonumber
    participant Exec as Agent Executor
    participant SrvMgr as Server Process Manager
    participant MC as Minecraft Java Server
    participant Hub as EventHub
    participant Audit as audit_entries

    Exec->>Exec: strip formatting markers (§ and & codes)
    Exec->>Exec: splitIntoChunks(max=200, sentence > clause > word)
    loop each chunk
        Exec->>SrvMgr: sendCommand(serverId, tellraw @a {text:chunk})
        alt /tellraw accepted
            SrvMgr->>MC: stdin write
            Exec->>Hub: emit(tellraw_sent)
            Hub->>Audit: insert(actionType='tellraw_sent', chunkIndex)
        else /tellraw failed
            Exec->>SrvMgr: sendCommand(serverId, say chunk_with_underscores)
            SrvMgr->>MC: stdin write
            Exec->>Hub: emit(say_fallback)
            Hub->>Audit: insert(actionType='say_fallback', chunkIndex)
        end
        Exec->>Exec: sleep(500ms) unless last chunk
    end
```

---

## 5. Hot-reload of `config.yaml`

The operator edits `config.yaml` (e.g. adds a new agent) and saves. The
Configuration Service detects the file change, parses + validates the new
snapshot, and atomically swaps the live config. Components depending on the
changed keys receive an `onChange` notification.

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant FS as Filesystem (config.yaml)
    participant Cfg as Configuration Service (forge/config)
    participant SrvMgr as Server Process Manager
    participant Exec as Agent Executor
    participant Tools as Tool Sandbox Broker
    participant TUI as TUI View Engine

    Operator->>FS: edit config.yaml (add agent "wallace")
    FS-->>Cfg: file change event (200 ms debounce)
    Cfg->>Cfg: parseYaml (yaml package)
    Cfg->>Cfg: defineConfig validation (t.* schema)
    alt Invalid (schema error, > 10 servers, running server removed)
        Cfg->>Cfg: retain last known good snapshot (NFR-REL-007)
        Cfg-->>TUI: warning "Hot-reload failed: <reason>"
        TUI-->>Operator: banner "Config reload rejected — kept previous"
    else Valid
        Cfg->>Cfg: diff(old, new) → ['agents.wallace']
        Cfg->>Cfg: dynamicHandle.publish(new) (atomic swap)
        Cfg-->>SrvMgr: onChange(['agents.wallace'])
        SrvMgr->>SrvMgr: no-op (servers unchanged)
        Cfg-->>Exec: onChange(['agents.wallace'])
        Exec->>Exec: rebuild agentsByAlias map (add 'wallace')
        Exec->>Exec: lazily create provider client for wallace.provider
        Cfg-->>Tools: onChange(['agents.wallace'])
        Tools->>Tools: rebuild commandAllowlist for wallace
        Cfg-->>TUI: onChange(['agents.wallace'])
        TUI-->>Operator: banner "Config reloaded: added agent wallace"
    end
```

**Notes**:
- The 200 ms debounce coalesces editor atomic-save (write-to-temp + rename)
  which fires two file events.
- The validation runs the **same** schema used at boot, so a hot-reload can
  never introduce a config that would have failed boot validation.
- "Cannot remove running server" is enforced here — the new snapshot is
  rejected if it removes a server in `RUNNING` or `STARTING` state. The
  operator must `/stop` it first.
- `forge/config`'s dynamic handle uses a `Proxy` so reads always return the
  latest snapshot; no component needs to cache the config.

---

## 6. Agent tool call — `run_command` blocked by allowlist

The agent attempts to execute `op Steve` (grant operator privileges to a
player). The Tool Sandbox Broker (via `engine-lib/tools-shell`'s
`shellTools`) checks the command against the agent's `commandAllowlist` and
rejects it. The agent receives a recoverable `ToolFailure` and can try a
different approach. The denial is audited.

```mermaid
sequenceDiagram
    autonumber
    participant LLM as LLM Provider API
    participant Exec as Agent Executor (engine-lib run loop)
    participant Tools as Tool Sandbox Broker (tools-shell)
    participant Policy as composePolicies(shellPolicySource)
    participant Hub as EventHub
    participant Audit as audit_entries
    participant SrvMgr as Server Process Manager
    participant MC as Minecraft Java Server

    LLM-->>Exec: tool_call(run_command, {command:'op Steve'})
    Exec->>Exec: schema validate args (engine-lib s.object)
    Exec->>Exec: authorizer check (roleToolAuthorizer)
    Exec->>Exec: policy check (composePolicies)
    Exec->>Policy: evaluate({operation:'exec', target:'op Steve'})
    Policy->>Policy: tokenize('op Steve') → ['op', 'Steve']
    Policy->>Policy: match against agent.commandAllowlist (FR-TOOL-004)
    alt Matches allowlist
        Policy-->>Exec: allow
        Exec->>Tools: runCommand.execute({command:'op Steve'}, ctx)
        Tools->>SrvMgr: sendCommand('survival', 'op Steve')
        SrvMgr->>MC: stdin write
        MC-->>SrvMgr: stdout response
        SrvMgr-->>Tools: result text
        Tools-->>Exec: ToolSuccess({content: result})
        Exec->>Hub: emit(RunEvent.tool.result, ok)
        Hub->>Audit: insert (actionType='command_exec', outcome='ok', target='op Steve')
    else Does not match allowlist (deny by default, FR-TOOL-002)
        Policy-->>Exec: deny (COMMAND_BLOCKED)
        Exec->>Tools: short-circuit (no execution)
        Tools-->>Exec: ToolFailure({error: 'COMMAND_BLOCKED — command "op" is not in the allowlist'})
        Exec->>Hub: emit(RunEvent.tool.result, blocked)
        Hub->>Audit: insert (actionType='command_exec', outcome='blocked', target='op Steve')
        Exec-->>LLM: tool_result(isError=true, content='COMMAND_BLOCKED ...')
        Note over LLM: Model can retry with a different approach
    end
```

**Notes**:
- The `tools-shell` policy check happens **inside** the engine-lib run loop,
  before the tool's `execute` function is called. The host code does not
  need to wrap the tool — `shellTools({policy})` configures it once at
  factory time.
- The denial is a recoverable `ToolFailure`, NOT a thrown error. The run
  loop continues; the model sees the error in the tool result and can adjust.
- Only `ShellPolicyError` (host misconfiguration, e.g. non-absolute
  `allowedCwds`) is thrown — and it throws at factory-build time, not at
  tool-call time.

---

## 7. Idempotent `/start` replay

The operator double-presses Enter on `/start survival`. The Command Router
dedupes within a 5-second window using the `Idempotency-Key`-style hash of
`(command, serverId, args)`. The second call returns the original response
without re-spawning.

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant TUI as TUI View Engine
    participant Router as Command Router
    participant Idem as Idempotency Cache (in-process, 5 s TTL)
    participant SrvMgr as Server Process Manager
    participant MC as Minecraft Java Server

    Operator->>TUI: /start survival (press 1)
    TUI->>Router: dispatch({cmd:'start', serverId:'survival'})
    Router->>Idem: lookup(hash('start','survival'))
    Idem-->>Router: not found
    Router->>SrvMgr: start('survival')
    SrvMgr->>MC: Bun.spawn(...)
    MC-->>SrvMgr: pid 4242
    SrvMgr-->>Router: { ok:true, pid:4242, state:STARTING }
    Router->>Idem: set(hash, { response, expiresAt: now+5s })
    Router-->>TUI: render STARTING pid=4242

    Note over Operator: Double-presses Enter (within 5 s)

    Operator->>TUI: /start survival (press 2)
    TUI->>Router: dispatch({cmd:'start', serverId:'survival'})
    Router->>Idem: lookup(hash('start','survival'))
    Idem-->>Router: found (cached response)
    Router-->>TUI: render STARTING pid=4242 (cached)
    Note over Router: No second spawn — same pid
```

**Notes**:
- The idempotency cache is in-process (`Map<hash, {response, expiresAt}>`),
  not in the DB. Rationale: operator commands are interactive; a 5 s window
  covers accidental double-Enter without persisting state. See
  `idempotency.md`.
- If the operator types `/start survival` again after 5 s, a new spawn is
  attempted. If the server is already `RUNNING`, the `ALREADY_RUNNING`
  error is returned (this is a state check, not an idempotency check).
- Agent tool calls do NOT use this cache — their idempotency is handled at
  the engine-lib run-loop level (tool-call argument hashing within a single
  `runAgent` call).

---

## 8. `--read-only` mode rejects `/stop`

The manager was started with `--read-only`. The operator attempts `/stop
survival`. The Command Router classifies the command as mutating and rejects
it before it reaches the Server Process Manager.

```mermaid
sequenceDiagram
    autonumber
    actor Operator
    participant TUI as TUI View Engine
    participant Router as Command Router
    participant Classifier as MutatingCommandClassifier (ADR-LLD-003)
    participant SrvMgr as Server Process Manager
    participant Hub as EventHub
    participant Audit as audit_entries

    Operator->>TUI: /stop survival
    TUI->>Router: dispatch({cmd:'stop', serverId:'survival'})
    Router->>Classifier: classify({cmd:'stop', runtimeMode:'read-only'})
    Classifier->>Classifier: lookup in MUTATING_COMMANDS table
    alt Command is mutating AND mode is read-only
        Classifier-->>Router: { allowed:false, reason:'READ_ONLY_BLOCKED' }
        Router->>Hub: emit(RunEvent.custom: command.rejected)
        Hub->>Audit: insert (actionType='stop', outcome='blocked', detail='read-only mode')
        Router-->>TUI: render error
        TUI-->>Operator: "Blocked in --read-only mode"
        Note over SrvMgr: Never reached — server keeps running
    else Command is non-mutating OR mode is normal
        Classifier-->>Router: { allowed:true }
        Router->>SrvMgr: stop('survival')
        SrvMgr->>SrvMgr: send /stop to stdin, wait, force-kill on timeout
        SrvMgr-->>Router: { ok:true, state:STOPPED }
        Router-->>TUI: render STOPPED
    end
```

**Notes**:
- The classification table is the one defined in ADR-LLD-003:
  `MUTATING_COMMANDS = {start, stop, restart, chat, send-stdin, clear-session, config-edit}`.
- The rejection happens **before** the Server Process Manager is reached, so
  the server is untouched. This is the architectural home ADR-008 requires.
- The rejection is audited so the operator can review what was attempted
  from a kiosk session.
- Non-mutating commands (`help`, `session-list`, `session-resume-view`,
  `log-view`, `config-view`, `navigate`, `quit`) are allowed in read-only
  mode — the operator can still observe everything.
