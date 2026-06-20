# ADR-007: Audit Logging, Structured Observability, and Telemetry Privacy Controls

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: observability, security, audit, logging, privacy

## Context

The Minecraft Server Manager TUI performs critical infrastructure operations: it runs child Java processes, loads configuration credentials, communicates with external LLM services, and acts as a broker for agent tool executions. If an agent executes destructive files or system commands, we must have a reliable, tamper-evident audit log.

At the same time, we must adhere to privacy regulations and customer constraints:

1. Provider API keys and sensitive secrets must never be logged.
2. In-game player chat content and full agent prompts must be excluded from default INFO logs.
3. Telemetry sent via the `@infinityi/forge` client must be strictly opt-in and must not leak player details or prompt payloads.
4. Crash reports must capture sufficient context for diagnostic troubleshooting without leaking system secrets.

We need to choose an architectural design for our logging and observability frameworks to enforce these privacy boundaries while delivering high diagnostics coverage.

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `FR-TOOL-011` — Log all agent-executed commands and file operations.
- `NFR-SEC-007` — Secrets must exist only in environment variables and must NOT be logged.
- `NFR-SEC-008` — Full agent prompts and responses must not be logged at INFO level by default.
- `NFR-OBS-001` — Structured JSON logs at `logs/explorers-cli.log` with configurable verbosity and 50 MB rotation.
- `NFR-OBS-002` — Telemetry via `@infinityi/forge` must be opt-in, off by default, with a consent flag.
- `NFR-OBS-003` — Write crash reports to `crash-<timestamp>.json` on uncaught exceptions.
- `NFR-OBS-004` — Audit logs must capture timestamp, agent ID, server ID, and player name.
- `NFR-OBS-005` — The application must NOT write Minecraft server logs.
- `NFR-PRV-001` — Session data containing player messages must be stored locally only.
- `NFR-PRV-002` — Player content must NOT be sent in telemetry.

## Options considered

### Option 1: Combined Console/File Logging and Passive Telemetry forwarding

Log all system events, errors, agent prompts, and tool calls into a single text file and allow `@infinityi/forge` telemetry client to auto-capture execution exceptions.

- **Pros**:
  - Simpler implementation using generic console wrapper libraries.
- **Cons**:
  - High risk of secret leakage. API keys in configuration or debug data would get written to the text file.
  - Violates privacy NFRs: player messages and prompts could easily get captured in the telemetry output on exceptions.
  - Audit logs would be interleaved with standard TUI render messages, making parsing difficult.
- **Satisfies**: `NFR-OBS-005`
- **Tensions**: `NFR-SEC-007`, `NFR-SEC-008`, `NFR-OBS-001`, `NFR-OBS-002`, `NFR-OBS-004`, `NFR-PRV-002`

### Option 2: Segregated Logging Infrastructure with Strict Scrubbing, Opt-In Telemetry Middleware, and Structured JSON Formats

Implement a multi-channel logging framework:

1. **Application Log (`logs/explorers-cli.log`)**: Emits structured JSON. Configurable verbosity level (INFO/DEBUG/ERROR). Includes automatic string token sanitization that scrubs environment keys matching known secret patterns (e.g. `*API_KEY*`). Prompts are only logged at `DEBUG` or `TRACE` level.
2. **Audit Log Channel**: Written to `logs/explorers-cli.log` with a unique `"channel": "audit"` attribute or to a separate file, capturing every single command execution or filesystem write from agents. Each record includes: `timestamp`, `agentId`, `serverId`, `playerName`, `actionType`, `target`, and `status`.
3. **Crash Reporter**: Register global handlers (`process.on('uncaughtException')`) to dump system diagnostic state, stack traces, and active configurations (with secrets replaced by `[REDACTED]`) into `crash-<timestamp>.json`.
4. **Opt-In Telemetry Broker**: A middleware wrapper around `@infinityi/forge` client that only activates telemetry transmission if `telemetry.enabled: true` is explicitly configured in `config.yaml`. Before transmission, the payload is parsed, and any fields containing user prompts, agent replies, or player identities are stripped.

- **Pros**:
  - Guaranteed compliance with privacy specifications: player chat content and keys never reach telemetry endpoints.
  - Audit trail is machine-readable and easy to ingest into security information tools.
  - Prevents secret exposure via proactive redaction logic in logs and crash dumps.
  - Keeps Minecraft server log boundaries distinct (manager does not interfere with Minecraft's log files).
- **Cons**:
  - Requires setting up log rotation (50 MB limit) and telemetry filters.
- **Satisfies**: All driving requirements (`FR-TOOL-011`, `NFR-SEC-007`, `NFR-SEC-008`, `NFR-OBS-001` through `NFR-OBS-005`, `NFR-PRV-001`, `NFR-PRV-002`).
- **Tensions**: None.

---

## Decision

We will implement Option 2: a structured logging architecture segregating audit records from standard diagnostic output, using global uncaught exception handlers for redaction-safe crash files, and utilizing an opt-in telemetry proxy that strips player payloads.

---

## Rationale

This design ensures compliance with security and privacy requirements. By utilizing structured JSON formatting for application logs, we can configure automatic rotation limits and cleanly separate audit entries using query filters. Redacting prompt payloads and secrets before they are logged or written to crash files prevents credential exposure. Restricting `@infinityi/forge` telemetry to a strict opt-in check ensures the system complies with user preferences, while data scrubbing guards against accidental leaks of player chat records to the telemetry provider.

---

## Consequences

**Positive**:

- Comprehensive, tamper-evident audit trail for all agent operations.
- Zero leakage of provider API keys or player chat details in system logs or telemetry files.
- Safe, automated crash diagnostics output.

**Negative**:

- Debugging system issues under default INFO levels is more challenging due to prompt redaction (requires explicitly enabling DEBUG mode to inspect prompts).

**Neutral**:

- The manager ignores Minecraft-owned server directories for application logs; Minecraft's internal logs are managed entirely by its own process configuration.

---

## Mitigations for negative consequences

- **Debugging visibility** → Support a command-line flag (e.g. `--verbose` or `--debug-prompts`) that explicitly allows prompt and session logging on local terminal streams for troubleshooting under a local sandbox, while keeping production JSON file logging redacted.

---

## Links

- Related ADRs: `ADR-004-sandbox-tool-broker.md`, `ADR-006-chat-identity-permissions.md`
- SRS sections: Section 5.4 (Security Requirements), Section 5.5 (Observability Requirements)
