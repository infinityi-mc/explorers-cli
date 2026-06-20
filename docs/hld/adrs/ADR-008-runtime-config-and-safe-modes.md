# ADR-008: Runtime Configuration, Validation, and Safe Modes

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**:  Principal Technical Lead
- **Tags**: configuration, reliability, security, cli, hot-reload

## Context

`explorers-cli` is controlled by a local `config.yaml` file that defines servers, agents, providers, permissions, feature flags, and telemetry consent. The SRS requires the running application to hot-reload this file, survive deletion or invalid intermediate states, and provide non-interactive validation for operators before promoting configuration changes.

The SRS also requires a `--read-only` mode for kiosk or shared-host use. Although the local operator is trusted in normal mode, shared terminal access creates a separate safety boundary: observers may be allowed to inspect logs and server state without being allowed to send chat messages or mutate server state.

## Requirements driving this decision

- `FR-HOT-001` through `FR-HOT-010` — Watch, validate, and apply `config.yaml` changes safely.
- `CFGIF-1` through `CFGIF-5` — Load, validate, and document configuration files.
- `CMD-4`, `CMD-9` — Route TUI chat and direct server console input through controlled command paths.
- `NFR-PERF-002` — Hot-reload should complete within 2 seconds for 10 configured servers.
- `NFR-REL-007` — If `config.yaml` is deleted while running, keep current state and do not crash.
- `NFR-SEC-009` — Support `--read-only` mode that disables TUI chat for kiosk/shared-host use.
- `NFR-MNT-003` — Provide `--validate-config`, exiting `0` for valid config and non-zero for invalid config without launching the TUI.

## Options considered

### Option 1: Treat CLI modes and hot-reload behavior as component implementation details

Let the CLI parser, Configuration Service, and TUI components independently decide how to handle `--read-only`, validation-only execution, and config deletion.

* **Pros**:
  * Keeps the HLD small.
  * Leaves maximum flexibility to LLD authors.
* **Cons**:
  * Risks inconsistent behavior across command entry points.
  * Does not establish an architectural home for SRS safe-mode and validation requirements.
  * Makes it easy for read-only mode to disable `/chat` while still allowing direct console mutations.
* **Satisfies**: None completely.
* **Tensions**: `NFR-REL-007`, `NFR-SEC-009`, `NFR-MNT-003`.

### Option 2: Centralized Runtime Mode and Configuration Gateway

Define a bootstrap/runtime gateway that owns process mode selection and config lifecycle. The gateway starts in one of three modes:

1. **Normal TUI mode**: load config, start the TUI, watch `config.yaml`, and apply valid hot-reloads.
2. **Read-only TUI mode**: load config and start the TUI in observer mode. Mutating operator actions are denied at the shared command router before they reach the Server Process Manager, Agent Executor, or Configuration Service.
3. **Validation-only mode**: load and validate config, print validation results, exit `0` on success or non-zero on failure, and do not start the TUI, Java subprocesses, SQLite sessions, PID registry cleanup, or LLM clients.

The Configuration Service keeps the last known good configuration snapshot in memory. Hot-reload reads use an atomic-save tolerant retry window; invalid, missing, or deleted files leave the current runtime snapshot active and emit a TUI-visible warning.

* **Pros**:
  * Gives every mode and config lifecycle requirement a single architectural owner.
  * Keeps running servers stable during config deletion or editor atomic-renames.
  * Makes `--validate-config` safe for CI/CD and operator promotion flows.
  * Gives read-only mode a consistent enforcement point across `/chat`, direct console input, restart/stop/start commands, and TUI config edits.
* **Cons**:
  * Requires a shared command router/mode guard instead of letting each UI widget invoke actions directly.
* **Satisfies**: `FR-HOT-*`, `CFGIF-*`, `CMD-4`, `CMD-9`, `NFR-PERF-002`, `NFR-REL-007`, `NFR-SEC-009`, `NFR-MNT-003`.
* **Tensions**: Read-only mode exceeds the minimum SRS wording by blocking all operator-initiated mutations, not just TUI chat. This is intentional for kiosk/shared-host safety; LLD may expose future narrower modes only with a new decision.

## Decision

We will implement Option 2: a centralized Runtime Mode and Configuration Gateway.

The bootstrap path resolves CLI flags before starting runtime containers. `--validate-config` is terminal: it validates configuration and exits without starting runtime side effects. `--read-only` starts the TUI in observer mode and propagates a global `readOnly` capability to the shared command router.

Read-only mode blocks all operator-originated mutating actions, including TUI agent chat, direct server stdin commands, server start/stop/restart commands, and TUI configuration edits. Non-mutating actions such as navigation, log viewing, `/help`, `/session` inspection, and viewing validation errors remain allowed. Attempts to perform blocked actions are rejected with a visible TUI message and structured log event; they are not forwarded to downstream containers.

Configuration hot-reload is owned by the Configuration Service. The service validates candidate config snapshots before publication, applies only valid snapshots, and retains the last known good snapshot when `config.yaml` is temporarily absent, deleted, unreadable, or invalid.

## Rationale

A local terminal manager has no remote authentication layer, so the safest architectural control is a central router that applies runtime mode before mutating actions reach process, agent, or config subsystems. This preserves the normal-mode assumption that the local operator has full control while creating a clear boundary for shared-host/kiosk operation.

Centralizing config validation and publication also prevents reload race conditions from leaking into individual components. Components consume immutable active snapshots and receive change notifications only after validation succeeds, keeping runtime behavior stable during file editor temp-renames, validation failures, and deletion events.

## Consequences

**Positive**:
* All config lifecycle and CLI safe-mode NFRs have one architectural owner.
* Running servers are insulated from transient config file deletion and invalid hot-reloads.
* Operators can validate config in CI or deployment scripts without side effects.
* Read-only mode is enforced consistently across command entry points.

**Negative**:
* LLD must define a shared command classification model that distinguishes mutating from non-mutating actions.
* Some users may expect `--read-only` to block only TUI chat; this design intentionally blocks broader mutations for safety.

**Neutral**:
* In-game player-originated agent flows continue to use the existing player permission and rate-limit path. Read-only mode gates local operator actions, not remote player permissions.

## Mitigations for negative consequences

* **Command classification ambiguity** → The command router LLD must maintain an explicit allow/deny table for read-only mode and cover it with tests.
* **Operator confusion** → The TUI help text and startup banner must state that read-only mode is an observer/kiosk mode and list blocked commands.
* **Hot-reload timing risk** → The Configuration Service LLD must set a 2-second budget for 10-server validation, including parser, schema validation, permission-index rebuild, and notification publication.

## Links

- Related ADRs: `ADR-003-process-management-bun-spawn.md`, `ADR-004-sandbox-tool-broker.md`, `ADR-006-chat-identity-permissions.md`, `ADR-007-audit-logging-observability.md`
- SRS sections: Section 4.1 (Configuration Interface), Section 4.2 (Commands), Section 5.2 (Performance), Section 5.3 (Reliability), Section 5.4 (Security), Section 5.6 (Maintainability)
