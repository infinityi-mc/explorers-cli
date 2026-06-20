# F-010: Audit log sink inconsistency — `logs/audit.jsonl` referenced in design.md and observability.md but not in data-model.md or migration-plan.md

- **Severity**: Minor
- **Dimension**: internal-consistency
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/design.md` line 132 (Mermaid node label `Audit["logs/audit.jsonl\n(engine-lib governance auditSubscriber)"]`)
  - `docs/lld/tui-cli-process/observability.md` line 204 ("The audit log (`logs/audit.jsonl`) rotates the same way but at 100 MB (audit entries are higher-volume and the operator may want more history).")
  - `docs/lld/tui-cli-process/data-model.md` lines 187–203 (audit_entries is the SQLite table; no JSONL file mentioned)
  - `docs/lld/tui-cli-process/migration-plan.md` M-001 step 5 (creates `audit_entries` table only)
- **HLD reference**: N/A
- **SRS reference**: N/A
- **Status**: Resolved

**Resolution**: `design.md` now consistently uses `audit_entries` via `forgeDataAuditLog`; `observability.md` and `tests.md` reference the SQLite audit table rather than `logs/audit.jsonl`.

**Finding**: The LLD's audit log design uses `engine-lib/governance`'s `forgeDataAuditLog({db, table: 'audit_entries'})` as the sink (per `data-model.md` and `migration-plan.md`). This is consistent — the SQLite table at `data/sessions.db` is the canonical store.

But `design.md`'s capability mapping flow chart and `observability.md`'s Log rotation section both reference `logs/audit.jsonl` as a separate file sink. This implies either:
1. The LLD uses both sinks (engine-lib `auditSubscriber` configured to write to both JSONL and SQLite).
2. One of the references is stale and should be removed.

The LLD does not declare which is the case. `data-model.md` is silent on the JSONL file. `migration-plan.md` M-001 does not create `logs/audit.jsonl`. `design.md`'s concurrency model says nothing about dual-write. The `auditSubscriber` factory pattern in `engine-lib/governance` accepts only ONE sink.

**Why it matters**: An implementation that wires both sinks will incur 2× audit write I/O on every event. An implementation that wires only one will diverge from one of the LLD's two documented references. The flow chart in `design.md` is a key reference for implementers; if it shows JSONL but the data model says SQLite, the implementer has to guess.

**Recommendation** (auto-fix):
1. Remove the `logs/audit.jsonl` label from `design.md` flow chart line 132; relabel as `Audit["audit_entries (SQLite)\n(engine-lib governance auditSubscriber + forgeDataAuditLog)"]`.
2. Remove the `logs/audit.jsonl` reference from `observability.md` line 204; replace with "The audit table (`audit_entries` in `data/sessions.db`) is high-volume. WAL checkpointing per ADR-002 applies."
3. If the intent was indeed dual-write, document it explicitly in `data-model.md` and add a second migration step; otherwise, remove the JSONL references.

**Customer/designer question**: N/A — this is a documentation cleanup.
