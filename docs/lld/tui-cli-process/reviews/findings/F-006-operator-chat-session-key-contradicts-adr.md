# F-006: `sequences.md` §4 uses session key `operator:assistant` — contradicts ADR-LLD-004's composite `serverId:agentId` key

- **Severity**: Major
- **Dimension**: internal-consistency
- **Lens**: backend-architect
- **Location**: `docs/lld/tui-cli-process/sequences.md` line 234 (`Exec->>DB: SessionStore.load('operator:assistant')`)
- **HLD reference**: N/A (composite-key decision is LLD-only)
- **SRS reference**: `docs/srs/srs.md` line 369 (FR-SES-003: "Sessions MUST be keyed by `serverId + agentId`") and line 590 ("The session key for active context MUST be `serverId + agentId`")
- **Status**: Resolved

**Resolution**: `sequences.md` §4 now uses a server-scoped session prefix and includes a separate offline `/chat` path with no persisted session. `/operator/chat` description was updated in `openapi.yaml`.

**Finding**: `sequences.md` §4 ("Operator `/chat` with provider timeout") depicts an operator `/chat` flow where the Agent Executor loads the session via `SessionStore.load('operator:assistant')`. The session key `operator:assistant` is not a valid composite per the LLD's own `ADR-LLD-004` ("Session ID = composite `serverId:agentId`, tenantId = serverId — chosen") or per `FR-SES-003` (`serverId + agentId`).

The sequence diagram does not include a `serverId` in the dispatch step:
```
Operator->>TUI: /chat assistant Summarize deployment
TUI->>Router: dispatch({cmd:'chat', agentId:'assistant', message:'...'})
```

So the diagram implicitly models `serverId` as omitted — i.e., the operator's offline-chat case (FR-INV-001, FR-INV-012, FR-INV-013). But:
- The LLD's `OpenAPI.OperatorChatRequest.serverId` is nullable, with description "Optional. If omitted, the agent runs without a server context (offline chat — FR-INV-001)."
- `design.md` Agent Executor capability mapping says session is always `createSession({id: serverId+":"+agentId, store})` — no provision for null serverId.
- `ADR-LLD-004` Option 3 mandates the composite key with no exception for null serverId.

The diagram is internally inconsistent with the LLD's own session-key design: either the session key should be `survival:assistant` (and the diagram must specify `serverId`), or the operator's offline chat has no session and the `SessionStore.load` call is wrong.

**Why it matters**: Implementation will copy one of the two inconsistent sources and ship a bug. If it copies the diagram, offline operator chats create phantom sessions keyed `operator:assistant`. If it copies the ADR, operator `/chat` without `serverId` cannot load a session and either crashes or silently no-ops.

**Recommendation**:
1. Update `sequences.md` §4 to either (a) include `serverId: 'survival'` in the dispatch and use `'survival:assistant'` as the session key, or (b) add a note that when `serverId` is omitted, no session is loaded and the response is held only in the TUI (and not persisted to `data/sessions.db`).
2. Clarify in `design.md` Agent Executor capability mapping: what happens when `serverId` is null in the operator `/chat` request? Either the agent runs as a one-shot stateless call (no session persistence), or a synthetic session key like `__offline__:assistant` is used (with engine-lib's tenant claim set to `__offline__`).
3. Update the OpenAPI `/operator/chat` description to remove the contradiction (currently says the agent "uses the same session as a corresponding in-game mention would" — but offline chat has no in-game equivalent).

**Customer/designer question**: When the operator runs `/chat assistant hello` without a server context, do you want the conversation persisted to `data/sessions.db` so it can be `/resume`d later, or do you want it ephemeral? The SRS doesn't say explicitly, but FR-SES-005 mandates the same persistence for operator messages as for player messages.
