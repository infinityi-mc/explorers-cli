# ADR-004: Enforce Sandboxed Path Containment and Token-Prefix Allowlisting

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Principal Technical Lead
- **Tags**: security, governance, design

## Context

LLM agents are configured with filesystem tools (`read_file`, `write_file`) and command execution tools (`run_command`) that interact directly with local Minecraft server environments.
If a player manages to hijack or prompt-inject the agent, they could command the agent to read sensitive system configuration files (e.g. `/etc/passwd` or `.env` files containing LLM provider keys) via path traversal techniques (`../../etc`) or execute destructive system commands.
We need to design a security firewall—the **Tool Sandbox Broker**—to intercept and validate all tool operations before execution.

## Requirements driving this decision

List the FRs and NFRs that this decision addresses:

- `FR-TOOL-002` — Deny tool execution by default.
- `FR-TOOL-004` — Enforce token-prefix allowlist matching for commands.
- `FR-TOOL-006` — Block moving/deleting files when server is running.
- `FR-TOOL-008` — Sandbox agent filesystem access to `server.path`.
- `FR-TOOL-009` — Block symlinks resolving outside `server.path`.
- `NFR-SEC-001` — Canonicalize sandbox root paths.
- `NFR-SEC-002` — `jarFile` must resolve inside canonical `server.path`.
- `NFR-SEC-003` — Restrict path resolutions to sandbox boundaries.

## Options considered

### Option 1: Basic Regex Allowlisting and Path String Replacing

Check if the path string contains double dots (`..`) and check commands against static RegExp matches.

- **Pros**:
  - Simple to implement in a few lines of code.
- **Cons**:
  - Highly vulnerable to bypasses. Symlink traversal, URL-encoding bypasses, or alternate path structures (e.g. absolute root overrides) can trick simple regex string replacements.
  - Rigid; static regex command matching is brittle and struggles with command parameters (e.g. allowing `/whitelist add <player>` while rejecting `/whitelist remove`).
- **Satisfies**: None.
- **Tensions**: `FR-TOOL-004`, `FR-TOOL-008`, `NFR-SEC-001`

### Option 2: Canonical Path Containment and Tokenized Prefix Allowlisting

Validate path resolutions using canonical filesystem calls and validate commands by tokenizing inputs on whitespace.

- **Pros**:
  - Extremely secure; canonicalization resolves all symlinks, relative segments, and shortcuts into a true absolute path on the host. We check if the target starts with the canonical `server.path`.
  - Matches the strict token allowlist specification (FR-TOOL-004), which tokenizes and compares the first N tokens exactly.
  - Allows granular control of allowed file directories and prevents destructive writes when the server is `RUNNING` (FR-TOOL-006).
- **Cons**:
  - Requires blocking I/O calls (`fs.realpathSync`) or async fs resolutions during check operations.
- **Satisfies**: `FR-TOOL-002`, `FR-TOOL-004`, `FR-TOOL-006`, `FR-TOOL-008`, `FR-TOOL-009`, `NFR-SEC-001`, `NFR-SEC-002`, `NFR-SEC-003`
- **Tensions**: None.

---

## Decision

We will implement a custom Tool Sandbox Broker that validates paths using canonical file system resolution and checks commands using exact tokenized prefix matching.

---

## Rationale

Option 2 resolves path traversal risks by converting all paths to their canonical absolute forms before checking containment. If the resolved path does not start with the server's canonical path, it is rejected.
For command allowlisting, tokenizing prevents bypasses where space manipulation (e.g. double spaces or `/say`) could slip past filters. Under the tokenized approach, space collapses, and comparisons are done token-by-token.

---

## Consequences

**Positive**:

- Prevents agents from accessing private host files or reading `.env` records.
- Restricts command executions to safe Minecraft console command sub-ranges.
- All blocked security breaches are logged with audit metadata (NFR-OBS-004).

**Negative**:

- Validating path containment incurs minor I/O latency for file checks (resolved via caching canonical roots in memory).

**Neutral**:

- The system does not prevent game corruption if a permitted command allowlist entry itself is inherently destructive (e.g. allowing `/stop`).

---

## Mitigations for negative consequences

- **File check latency** → Cache the canonicalized `server.path` roots during server start and hot-reload operations to avoid repeating realpath checks on the root folder.
- **Destructive allowed commands** → Train operators to restrict allowlists to non-destructive commands (e.g., limit allowlists to `say`, `tellraw`, `difficulty`, or `weather` and block administrative commands like `op`, `deop`, `stop`).

---

## Links

- Related ADRs: None
- SRS sections: Section 4.9 (Agent Tool Authorization and File Safety Requirements), Section 7.3 (Command Allowlist Matching)
- External references: [OWASP Path Traversal prevention](https://owasp.org/www-community/attacks/Path_Traversal)
