# F-011: `session_messages.playerName` is a flat VARCHAR column — SRS FR-SES-005/FR-SES-007 require `playerContext: PlayerContext` object

- **Severity**: Minor
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/data-model.md` line 167 (`session_messages` table column `playerName: varchar NULL` with comment `Player name for user rows from in-game mentions; 'operator' for operator /chat; NULL for assistant/system/tool`)
  - `docs/lld/tui-cli-process/openapi.yaml` line 692 (`SessionDetailResponse.messages[].playerName: { type: string, nullable: true }` — flat string)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-SES-005 and FR-SES-007
- **SRS reference**: `docs/srs/srs.md` lines 371 and 373–374, and §6.3 lines 582–587:
  ```typescript
  interface SessionEntry {
    …
    playerContext: PlayerContext;
  }
  interface PlayerContext {
    playerName: string; // player name, or "operator" for TUI-originated messages
  }
  ```
- **Status**: Resolved

**Resolution**: `session_messages.playerContext` is now documented as a JSON object, and `SessionDetailResponse.messages[]` now exposes `playerContext` instead of a flat `playerName`.

**Finding**: The LLD models `playerName` as a flat VARCHAR column on `session_messages`. The SRS §6.3 explicitly defines `playerContext` as an object with at least `{ playerName: string }` and `FR-SES-007` requires "Each session entry MUST include `role`, `content`, `timestamp`, and `playerContext`" (note: `playerContext`, not `playerName`).

`FR-SES-008` reinforces: "Player context for v1 MUST be an extensible object with at least `{ playerName: string }`."

The LLD's flat-column approach is a structural deviation. The SRS intends `playerContext` to be extensible (per FR-SES-008: "extensible object"). The LLD's flat VARCHAR is not extensible — to add a new field (e.g. `playerUuid`, `teamName`, `isInGameAdmin`), the column would need to be migrated.

The LLD's `data-model.md` line 220 also has a comment that `audit_entries.playerName` is the vanilla MC name — but `playerContext.playerName` for an in-game player vs. an operator is a different concept (operator's playerContext is `{playerName: "operator"}`, not the literal operator's MC name).

**Why it matters**: Implementation will produce a schema that does not match the SRS shape. If FR-SES-008 ever needs to be extended (e.g. to track `playerUuid`), the LLD schema requires a migration. The contract test for FR-SES-007 ("each session entry MUST include … `playerContext`") will need a JSON object check that the LLD's flat column cannot satisfy.

**Recommendation**:
1. Change `session_messages` schema: replace `playerName VARCHAR` with `playerContext JSON NOT NULL DEFAULT '{}'` (or `playerContext TEXT NOT NULL` storing JSON-serialized PlayerContext).
2. Update `SessionDetailResponse.messages[]` schema: replace `playerName: string` with `playerContext: { type: object, properties: { playerName: { type: string } }, additionalProperties: true, required: [playerName] }`.
3. Document in `design.md` Agent Executor that `playerContext` is always serialized as `{ playerName: "operator" }` for operator messages and `{ playerName: <vanilla MC name> }` for in-game player messages.
4. Note in `observability.md` that `playerName` is the `playerContext.playerName` field; audit log entries should record the structured object, not the bare string.

**Customer/designer question**: Do you anticipate adding fields to `playerContext` beyond `playerName` (e.g. playerUuid for future cross-server correlation)? If yes, the JSON shape is correct and the LLD should adopt it. If no, the flat column is acceptable and FR-SES-008 should be amended.
