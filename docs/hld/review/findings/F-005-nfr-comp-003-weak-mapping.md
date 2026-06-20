# F-005: NFR-COMP-003 (vanilla Minecraft 1.20+ support) mapped to ADR-006 with a chat-parsing rationale

- **Severity**: Minor
- **Dimension**: nfr-matrix
- **Lens**: traceability-auditor
- **Location**: `docs/hld/08-nfr-traceability.md` line 11
- **SRS reference**: NFR-COMP-003
- **Status**: Resolved

## Finding

Line 11 of `docs/hld/08-nfr-traceability.md`:

```
| **NFR-COMP-003** | Minecraft | MUST support vanilla Minecraft Java Edition 1.20+ servers. | `ADR-006` (Chat Parsing) | Low. Log outputs from vanilla servers are highly predictable. |
```

`NFR-COMP-003` says the system MUST support vanilla Minecraft Java
Edition 1.20+. The addressed-by column points to `ADR-006`, whose full
title is "In-Game Chat Parser, Player Identity Verification, and
Permissions Enforcement" (`docs/hld/adrs/ADR-006-chat-identity-permissions.md`).

The residual-risk column justifies the mapping with "Log outputs from
vanilla servers are highly predictable." That argument explains why
chat parsing is feasible on vanilla servers — but it does not justify
that the HLD addresses the requirement to _support_ 1.20+ in general
(server lifecycle, JAR execution, port binding, RCON-not-required,
etc.).

ADR-006 only incidentally depends on vanilla Minecraft because the
chat parser pattern matches the vanilla log format. The architectural
support for running a 1.20+ server is concentrated in `ADR-003` (process
management) and the C-04 constraint (process streams only, no RCON).

## Why it matters

LLD authors looking up `NFR-COMP-003` will land on `ADR-006` and may
conclude that "vanilla 1.20+ support" is purely a chat-parser concern,
missing the process-management and command-channel concerns. A review
auditor verifying the NFR matrix may also flag the gap.

## Recommendation

Two reasonable fixes (architect should choose):

1. **Re-map to ADR-003** with a rationale that emphasizes Java process
   spawning, port binding, and vanilla log format expectations. Keep
   ADR-006 as a co-owner if desired (e.g. `` `ADR-003` (Process Management), `ADR-006` (Chat Parsing) ``).

2. **Keep ADR-006 but add ADR-003 as a co-addressee** so LLD authors
   see both ADRs when looking up the requirement.

Either way, the residual-risk column should mention the process-spawn
layer, not just chat parsing.

## Cross-references

- HLD: `docs/hld/08-nfr-traceability.md` line 11
- SRS: `NFR-COMP-003` (Section 5.1)
- ADR-003: `docs/hld/adrs/ADR-003-process-management-bun-spawn.md`
- ADR-006: `docs/hld/adrs/ADR-006-chat-identity-permissions.md`
