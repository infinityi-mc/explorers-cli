# F-007: ADR-002 commits to bun:sqlite without comparing SQLite drivers

- **Severity**: Minor
- **Dimension**: adr-quality
- **Lens**: solution-architect
- **Location**: `docs/hld/adrs/ADR-002-sessions-sqlite-wal.md` lines 76–79
- **Status**: Resolved

## Finding

ADR-002's `## Decision` (line 71) is:

> We will use a local SQLite database file at `data/sessions.db` with Write-Ahead Log (WAL) mode enabled as the session persistence engine.

The `## Rationale` section (lines 76–79) then introduces a second
choice — the SQLite driver — without putting it through Options:

> Bun provides native, high-performance SQLite bindings via `bun:sqlite`, which allows query processing without external binary compilation blocks.

`bun:sqlite` is one of several viable SQLite drivers for this
runtime: `bun:sqlite`, `node:sqlite` (Node 22+), `better-sqlite3`,
`@vscode/sqlite3`. The ADR Options section (lines 25–66) compares
_storage formats_ (JSONL, SQLite default, SQLite WAL) but never
compares driver implementations.

## Why it matters

ADR-002 is the architectural record for the persistence layer. An LLD
author reading it cannot tell whether `bun:sqlite` was the _only_
acceptable driver (because of C-01 Bun runtime constraint) or whether
alternatives were considered and rejected. If a future maintainer wants
to swap drivers (e.g. when migrating off Bun, or for compatibility
reasons), the ADR provides no record of the trade-offs.

The constraint C-01 ("The application MUST execute on the Bun runtime
environment") does effectively mandate `bun:sqlite` for any
single-binary distribution, but this constraint should be cited in the
ADR's requirements-driving list and the rationale should explicitly
tie the driver choice to C-01, not introduce it implicitly.

## Recommendation

Either:

1. **Re-cast the driver choice** as an explicit sub-decision under the
   SQLite-WAL option. Add C-01 to the ADR's "Requirements driving this
   decision" section and add a sentence to the Rationale explaining
   that `bun:sqlite` is required by C-01's Bun mandate and is
   therefore not subject to a multi-driver comparison.

2. **Compare drivers explicitly** in a sub-section. Add Option A
   (`bun:sqlite`), Option B (`better-sqlite3`), Option C
   (`node:sqlite`) with brief pros/cons. Show that `bun:sqlite` is the
   chosen option because Bun provides it natively.

Option 1 is sufficient for v1. Option 2 is more rigorous.

## Cross-references

- HLD: `docs/hld/adrs/ADR-002-sessions-sqlite-wal.md`
- SRS: `FR-SES-001`, `FR-SES-002`, `NFR-REL-004`
- Constraint: `C-01` (Bun runtime)
- Matrix entry: `docs/hld/08-nfr-traceability.md` lines 21, 23, 27, 49 (NFR-PERF-006, NFR-CAP-002, NFR-REL-004, NFR-PRV-001 → ADR-002)
