# ADR-006: In-Game Chat Parser, Player Identity Verification, and Permissions Enforcement

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: security, chat, permissions, parser

## Context

The Minecraft Server Manager TUI allows in-game players to trigger LLM agents directly from the Minecraft chat interface by mentioning them using `@alias`. Since these agents can execute commands and read/modify the server filesystem, it is critical that only authorized players are able to invoke them.

Furthermore, we must prevent malicious players from exploiting the chat parser to spoof usernames, trigger unauthorized actions, or bypass security rules. We need a clear, robust strategy to parse in-game log entries, verify player identities, check permissions, handle rates and cooldowns, and construct appropriate prompt context.

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `CHAT-1` — Detect mentions `@alias` from vanilla log lines.
- `CHAT-2` — Support `!help` in-game and mirror available help commands.
- `CHAT-3` — Silently ignore unauthorized, invalid, or rate-limited mentions.
- `FR-CHAT-001` — Target only vanilla log lines matching `[timestamp] [Server thread/INFO]: <playername> message`.
- `FR-CHAT-002` — Silently skip non-matching lines.
- `FR-CHAT-003` — Parsing flow: match format, check `@alias`, parse name, check permissions, check rate limit, invoke agent.
- `FR-CHAT-004` — Invoke only the first matching `@alias` when multiple exist, ignore subsequent ones.
- `FR-CHAT-005` — Strip configurable team prefix/suffix before player name matching.
- `FR-CHAT-006` / `NFR-SEC-006` — Sanitize player names to `a-zA-Z0-9_` and max 16 characters. Reject invalid names.
- `FR-CHAT-007` / `NFR-SEC-005` — Case-insensitive validation of player names against permissions.
- `FR-CHAT-008` — Deny access if a player is not listed under `permissions.<serverId>.players`.
- `FR-CHAT-009` — Enforce per-agent rate limits using `rpm` and `cooldown`.
- `FR-CHAT-010` — Silently ignore unauthorized, invalid, and rate-limited mentions.
- `FR-CHAT-011` — Inject context window of N preceding chat lines (excluding the mention itself) into the LLM prompt.
- `NFR-SEC-010` — Treat player names and chat content as UTF-8.
- `NFR-COMP-003` — Support for vanilla Minecraft Java Edition 1.20+ server log formats.

## Options considered

### Option 1: Basic Regex Line Extraction and Lax Permissions

Use a simple regular expression to extract the chat speaker and message from standard stdout lines, verify if the username matches the whitelist exactly (case-sensitive), and forward it directly to the agent.

- **Pros**:
  - Simple, quick implementation.
- **Cons**:
  - In-game player names can contain formatting prefixes/suffixes added by team plugins or mods, which would cause name verification to fail or be spoofed.
  - Case-sensitive checking can let unauthorized variations (e.g., `Steve` vs `steve`) bypass permissions or cause false negatives.
  - Fails to support complex multi-mention filtering or rate-limit tracking.
- **Satisfies**: `CHAT-1`
- **Tensions**: `FR-CHAT-003`, `FR-CHAT-005`, `FR-CHAT-006`, `FR-CHAT-007`, `FR-CHAT-008`, `NFR-SEC-005`, `NFR-SEC-006`, `NFR-SEC-010`

### Option 2: Rigid Parsing Pipeline with Team Stripping, Strict Regex Sanitization, and Case-Insensitive Mapping

Implement a multi-step parser pipeline for each incoming stdout line:

1. Regex match against vanilla format: `^\[\d{2}:\d{2}:\d{2}\] \[Server thread/INFO\]: (<(?<player1>[a-zA-Z0-9_]{1,16})>|(?<player2>[a-zA-Z0-9_]{1,16}) joined|(?<pre>[^<]*)(?<player3>[a-zA-Z0-9_]{1,16})(?<suf>[^:]*):) (?<message>.*)$` (or a cleaner subset focusing on the standard vanilla chat line).
2. Extract player name and message body.
3. Clean team prefix/suffix using configured patterns.
4. Validate name against strict Minecraft criteria (`^[a-zA-Z0-9_]{1,16}$` and UTF-8).
5. Extract the first `@alias` matching active agents.
6. Look up player case-insensitively in `permissions.<serverId>.players`.
7. Enforce per-agent rate limits (sliding window for `rpm` and timestamp tracking for `cooldown`).
8. If all checks pass, load the N preceding clean chat messages for the agent prompt context.

- **Pros**:
  - High security: deny-by-default is strictly enforced for unauthorized players.
  - Clean extraction of player names even in the presence of scoreboard prefix/suffix modifications.
  - Case-insensitive matching prevents configuration mismatch vulnerabilities.
  - Limits rate flooding and LLM token overhead by ignoring invalid or throttled queries silently.
- **Cons**:
  - Increased processing logic per log line (optimized using compiled regexes and quick preliminary checks).
- **Satisfies**: All driving requirements (`CHAT-1`, `CHAT-2`, `CHAT-3`, `FR-CHAT-001` through `FR-CHAT-011`, `NFR-SEC-005`, `NFR-SEC-006`, `NFR-SEC-010`).
- **Tensions**: None.

---

## Decision

We will implement Option 2: a robust, multi-step log parser pipeline with strict regex sanitization, case-insensitive player name lookup, and token/cooldown rate-limiting before invoking any agent.

---

## Rationale

By implementing a pipeline that validates player identity using strict character and length filters, we eliminate injection vectors (like control characters or long payloads) in the player name parameter. Rejecting names that do not match `^[a-zA-Z0-9_]{1,16}$` ensures compatibility with vanilla Minecraft constraints and protects backend systems (like SQL queries or shell boundaries) from identity spoofing. Supporting team prefix/suffix removal allows integration with typical multiplayer environments where prefix decorations might hide the underlying player name. Enforcing rate-limiting in memory prevents downstream LLM api floods.

---

## Consequences

**Positive**:

- Safe execution of in-game agent triggers without risk of username spoofing or character injection.
- Predictable rate controls per agent prevents budget exhaustion.
- Strict "silent ignore" policy protects the operator from logs or TUI spam when unauthorized players attempt mentions.

**Negative**:

- Operators must configure server permissions correctly; otherwise, players will be ignored without feedback.
- Standard logs must follow vanilla styling; custom log format plugins are not supported.

**Neutral**:

- Any command trigger that fails permissions or rate limits does not output an error in Minecraft chat, complying with the requirement to silently ignore unauthorized triggers.

---

## Mitigations for negative consequences

- **Silent ignoral debug** → Expose rejected mentions or failed permission checks as warning/info lines in the manager's audit log file (`logs/explorers-cli.log`) to assist operators in troubleshooting permissions config without exposing feedback to the game server.
- **Vanilla log constraint** → Clearly specify in the documentation that explorers-cli expects vanilla format logs and that plugins modifying the base chat pattern (e.g. EssentialsChat with custom brackets) must maintain the raw player name and message structure.

---

## Links

- Related ADRs: `ADR-004-sandbox-tool-broker.md`, `ADR-007-audit-logging-observability.md`
- SRS sections: Section 3.3 (In-Game Chat Interface), Section 4.6 (In-Game Chat Parsing and Permissions Requirements)
