# F-019: FR-CHAT-005 team prefix/suffix placement is inconsistent — data-model.md says per-player, design.md Algorithm 1 says per-server

- **Severity**: Minor
- **Dimension**: internal-consistency
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/data-model.md` lines 72–73 (`players.teamPrefix`, `players.teamSuffix` — per-player columns)
  - `docs/lld/tui-cli-process/design.md` lines 202–206 (Algorithm 1 step 2 — `serverCfg.teamPrefix`, `serverCfg.teamSuffix` — per-server access)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-CHAT-005
- **SRS reference**: `docs/srs/srs.md` line 337 ("Team prefix and suffix MUST be configurable per player and SHOULD be stripped before player-name matching")
- **Status**: Resolved

**Resolution**: Algorithm 1 now strips team prefix/suffix using per-player decoration configuration instead of per-server fields.

**Finding**: `FR-CHAT-005` mandates that team prefix and suffix are configurable **per player** (so different players on the same server can have different team decorations stripped). The LLD's `data-model.md` correctly places `teamPrefix` and `teamSuffix` as columns on the `players` table — but `design.md` Algorithm 1 reads them from `serverCfg.teamPrefix` and `serverCfg.teamSuffix` (per server). The two LLD files disagree.

**Why it matters**: An implementer following design.md will store team prefix/suffix on the server config and apply the same prefix/suffix to all players — a direct SRS violation for the case where two players have different team decorations.

**Recommendation**: Update `design.md` Algorithm 1 step 2 to read from the `Player` record, not the server config:

```
# Step 2: strip configurable team prefix/suffix (FR-CHAT-005, per-player)
if player.teamPrefix and rawPlayer.startsWith(player.teamPrefix):
    rawPlayer = rawPlayer.slice(player.teamPrefix.length)
if player.teamSuffix and rawPlayer.endsWith(player.teamSuffix):
    rawPlayer = rawPlayer.slice(0, -player.teamSuffix.length)
```

This requires `parseMention` to receive the `Player` record (or at least the team prefix/suffix), not just the server config. Update the algorithm signature accordingly.

**Customer/designer question**: N/A — this is a structural alignment fix.
