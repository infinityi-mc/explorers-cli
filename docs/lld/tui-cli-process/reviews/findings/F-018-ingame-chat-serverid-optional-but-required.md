# F-018: `IngameChatLine` schema makes `serverId` optional but design.md Algorithm 1 requires it

- **Severity**: Minor
- **Dimension**: internal-consistency
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/openapi.yaml` lines 738–746 (`IngameChatLine` schema — `raw` is required, `serverId` is optional)
  - `docs/lld/tui-cli-process/openapi.yaml` lines 860–876 (examples all include `serverId` despite the schema not requiring it)
  - `docs/lld/tui-cli-process/design.md` Algorithm 1 line 184 (`parseMention(line, serverId, config, rateLimiterRegistry)` — `serverId` is a positional parameter, not optional)
- **HLD reference**: N/A
- **SRS reference**: N/A
- **Status**: **Resolved** — auto-fixed by reviewer on 2026-06-19. Change: `serverId` moved to `required: [raw, serverId]` on `IngameChatLine`; description expanded to explain why serverId is required (Chat Parser consults `permissions.<serverId>.players`). See `openapi.yaml` lines 738–746.

**Finding**: `design.md` Algorithm 1 takes `serverId` as a required positional parameter — the chat parser cannot function without knowing which server's permission table to consult. But the OpenAPI `IngameChatLine` schema makes `serverId` optional (`required: [raw]` only). The examples all include `serverId: survival` even though the schema doesn't require it.

The description on the operation (`POST /ingame/chat`) explains that this endpoint models the parsed shape emitted by the Chat Parser, and that the serverId is contextual (the Log Reader knows which server's stdout it's reading). So in practice the Log Reader always knows the serverId and passes it. But the schema permits omitting it, which would lead to a runtime error if the parser is called without one.

**Why it matters**: If the contract tests instantiate `IngameChatLine` without `serverId` (per the schema), the parser would fail to find the permission table. The contract test would either need to know to add `serverId` (defeating the schema's optional declaration) or the parser needs defensive logic that defaults to a synthetic server. Neither is documented.

**Recommendation** (auto-fix):
1. Change `IngameChatLine.required` from `[raw]` to `[raw, serverId]`. This makes the contract explicit: every chat-line invocation must include the serverId.
2. Update the description to clarify that `serverId` is supplied by the Log Reader's per-server `for await` loop, not parsed from the line itself.
3. Update the parseMention algorithm signature comment to clarify that serverId comes from the channel context.

**Customer/designer question**: N/A.
