# F-014: `IngameChatParseResult` schema for `help_trigger` kind does not carry the requesting player

- **Severity**: Minor
- **Dimension**: api-contract
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/openapi.yaml` lines 748–765 (`IngameChatParseResult` schema — `help_trigger` kind has no fields; `mention` kind has `serverId, agentId, playerName, message, occurredAt`)
  - `docs/lld/tui-cli-process/openapi.yaml` line 893 (example `IngameChatParseHelp: { kind: 'help_trigger' }` with no other fields)
- **HLD reference**: `docs/hld/05-api-surface.md` line 37 ("Inbound Help Trigger — Pattern: `[timestamp] [Server thread/INFO]: <playername> !help` — Response: Fires an outbound `/tellraw` list of permitted agents and basic commands.")
- **SRS reference**: N/A (help-trigger shape is LLD-defined)
- **Status**: **Resolved** — auto-fixed by reviewer on 2026-06-19. Change: `serverId`, `playerName`, `occurredAt` lifted to top-level required fields on `IngameChatParseResult` (present for all `kind` values including `help_trigger` and `ignored`). The `mention` sub-object retains `agentId` and `message`. Examples updated accordingly. See `openapi.yaml` lines 748–765 and 878–897.

**Finding**: When a player types `!help` in-game, the Chat Parser emits a parse result with `kind: 'help_trigger'`. The current OpenAPI schema and example for this kind carry NO information about the requesting player — just `{ kind: 'help_trigger' }`.

The downstream consumer (the `/tellraw` writer that responds with the agent list) needs to know which player asked, so it can target them with a private `/tellraw @a[tag=...]` or similar, or at least so the audit log can record who triggered the help lookup. The LLD's `design.md` Algorithm 1 mentions: "`!help` trigger — handled by a separate regex (not shown); produces a `/tellraw` listing permitted agents, no LLM call." But the regex output isn't documented as an IngameChatParseResult.

The `mention` kind includes `serverId, agentId, playerName, message, occurredAt` — the `help_trigger` kind should at minimum include `serverId, playerName, occurredAt` so the response can be addressed and audited.

**Why it matters**: The Agent Executor's `/tellraw` writer needs to know the player to send the response back to (even if the default selector is `@a`, the audit log should record who asked). Without `playerName` in the parse result, the response would have to be broadcast to `@a` with no audit trail of the requester.

**Recommendation** (auto-fix):
1. Add `playerName`, `serverId`, `occurredAt` to the `help_trigger` variant of `IngameChatParseResult`. Either as required fields on a separate `help_trigger` object, or by relaxing the schema so all `IngameChatParseResult` variants carry `serverId, playerName, occurredAt` regardless of `kind`.
2. Update the example to include these fields.
3. Update `sequences.md` §3 or add a new sequence diagram for the help-trigger path showing the writer using `playerName` to address the response.

**Customer/designer question**: N/A — this is a schema completeness fix.
