# F-001: FR-SES-006 silent deviation — composite session ID replaces timestamp+random-suffix

- **Severity**: Blocker
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**: `docs/lld/tui-cli-process/adrs/ADR-LLD-004-shared-session-key-multi-tenant.md` lines 100–119 (Option 3, "Session ID = composite `serverId:agentId`, tenantId = serverId — chosen") and `docs/lld/tui-cli-process/traceability.md` (FR-SES-006 absent from the table)
- **HLD reference**: `docs/hld/00-requirements.md` row "FR-SES-006 | Uniqueness of session ID: timestamp + random suffix"
- **SRS reference**: `docs/srs/srs.md` line 372 ("FR-SES-006 | Session IDs MUST append a random suffix to timestamp-based IDs to guarantee uniqueness within the same millisecond. | Must") and §6.3 line 576 (`sessionId: string; // timestamp plus random suffix`)
- **Status**: Resolved

**Resolution**: ADR-LLD-004 now conforms to FR-SES-006 by using `serverId:agentId:<timestamp>-<randomSuffix>` session IDs. `data-model.md`, `domain.md`, `sequences.md`, and `traceability.md` were updated to describe the suffixed active-session model.

**Finding**: The LLD's `ADR-LLD-004` chooses Option 3 ("Session ID = composite `serverId:agentId`") as the session identifier. The SRS `§6.3 SessionEntry` shape and `FR-SES-006` both mandate that session IDs are timestamp-based with an appended random suffix. The LLD's traceability matrix omits FR-SES-006 entirely. ADR-LLD-004's "Context" lists `FR-SES-001`, `FR-SES-004`, `FR-CHAT-011`, `NFR-PERF-006`, `NFR-PRV-001`, `NFR-CAP-002` as drivers, but never names `FR-SES-006` as a requirement the ADR supersedes, and does not explain how the composite ID satisfies the uniqueness-within-the-same-millisecond intent of FR-SES-006.

**Why it matters**: A silent deviation from a MUST-level SRS requirement is the kind of defect that becomes a re-architecture cost in implementation. If implementation blindly follows the LLD, the schema will not satisfy FR-SES-006 as written, and a follow-up migration to add a random suffix on top of the composite key may collide with the engine-lib tenant claim contract. Additionally, downstream tooling that introspects session IDs (e.g. log readers, the audit panel, debug introspection) will not match what the spec promises.

**Recommendation**: Either:
1. **Conform** — change `SessionId` to a composite that includes both `serverId:agentId` AND a timestamp+random-suffix portion (e.g. `survival:assistant:1718814896000-a4f9b2`). Update ADR-LLD-004, `data-model.md`, and `domain.md` accordingly. Add `idx_sessions_sessionId` and explain the resolution rule.
2. **Document supersession** — keep the composite ID but add a paragraph in `ADR-LLD-004` explicitly stating "This ADR supersedes the implementation hint in FR-SES-006; uniqueness is structurally guaranteed by the (serverId, agentId) composite — there is at most one session per pair, so within-the-millisecond collision is impossible. The decision is recorded here so an auditor can confirm intent." Update `traceability.md` to map FR-SES-006 → ADR-LLD-004 with note.

Option 2 is the more economical path because the SRS intent (uniqueness) is preserved, but either way, the silent gap must be closed before implementation.

**Customer/designer question**: The FR-SES-006 wording strongly suggests the spec author wanted timestamp-based session IDs (one session per chat episode, restartable). Your LLD argues for stable composite IDs (one session per server/agent pair, persistent across restarts). These are semantically different products. Which does the customer actually want — a session per conversation or a session per server/agent for life? If the latter, FR-SES-006 should be amended; if the former, the LLD's design is wrong.
