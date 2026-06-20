# F-007: Missing audit actionType for `/tellraw` writes (FR-TOOL-011)

- **Severity**: Major
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/data-model.md` line 199 (`audit_entries.actionType` CHECK constraint — values listed are `command_exec`, `file_read`, `file_write`, `mention_authorized`, `mention_denied`, `start`, `stop`, `restart`, `hot_reload`, `crash`, `provider_timeout`)
  - `docs/lld/tui-cli-process/sequences.md` line 187 (the `/tellraw` write step has no corresponding audit emission)
  - `docs/lld/tui-cli-process/observability.md` (no `tellraw_sent` event type defined)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-TOOL-011 ("Audit log all agent-executed commands and file operations")
- **SRS reference**: `docs/srs/srs.md` line 393 ("All agent-executed commands and file operations MUST be logged for audit")
- **Status**: Resolved

**Resolution**: `audit_entries.actionType` now includes `tellraw_sent`, `say_fallback`, and `tellraw_skipped`; observability and sequence diagrams document the per-chunk audit events.

**Finding**: The `audit_entries.actionType` CHECK constraint in the LLD lists 11 values, none of which covers an agent's `/tellraw` write. `/tellraw` writes are agent-initiated in-game delivery commands (per FR-INV-004 and the LLD's `design.md` Agent Executor row). They are:
1. Executed via `SrvMgr.sendCommand(serverId, 'tellraw @a ...')` (see `sequences.md` line 187, `design.md` Agent Executor row).
2. Are "agent-executed commands" per the natural reading of FR-TOOL-011 — the agent decided to send a chat message to players.
3. Are NOT sandboxed in the same sense as filesystem operations or console commands, but they ARE side-effecting commands the operator should be able to audit.

Additionally, the audit row's `target` column is described as "Command text, file path, or mention line" (data-model.md line 203), which would fit a `/tellraw` command text, but the actionType enum has no entry to tag it as such. An implementation that follows the LLD literally would either:
- Use `command_exec` for `/tellraw` writes (mixing them with run_command outputs, which is misleading).
- Skip auditing `/tellraw` writes entirely (a FR-TOOL-011 violation).

The `observability.md` event catalog also has no `tellraw_sent` event; it covers `server_started`, `server_crashed`, `mention_authorized`, `mention_denied`, `tool_blocked`, `hot_reload`, `crash_report`. The Agent Executor's primary side effect (telling players something) is not auditable.

**Why it matters**: A kiosk operator who is monitoring the audit log for "what did the agent just do" will see all tool calls but not see in-game chat deliveries. For an LLM agent system, the in-game messages are arguably the most visible side effect and the most important to audit.

**Recommendation**:
1. Add `tellraw_sent` (or `chat_send`) to the `audit_entries.actionType` CHECK constraint in `data-model.md`.
2. Update `observability.md` Per-event fields with a `tellraw_sent` event (`serverId, agentId, text, selector, chunkIndex`).
3. Update `sequences.md` §3 to show the audit emission step between `Exec→SrvMgr: sendCommand` and the final `TUI render`.
4. Consider also adding `say_fallback` for FR-INV-005 (`/say` fallback path).

**Customer/designer question**: Do you want to audit every `/tellraw` chunk the agent sends? It can be high-volume. If not, consider auditing only the high-level "agent run completed with N chunks delivered" event.
