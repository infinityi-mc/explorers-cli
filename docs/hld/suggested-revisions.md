# Suggested Revisions — HLD Readiness Review (2026-06-19)

Reviewer: QA Principal
Review date: 2026-06-19
Source review report: `review/review-report.md`

All Minor findings from the HLD readiness review have been resolved in the HLD artifacts. No proposed revisions remain open.

## Applied Minor Revisions

- **F-001** (container name consistency): `docs/hld/06-deployment.md` uses canonical `TUI & CLI Process` naming.
- **F-002** (residual-risk heading count): `docs/hld/07-security.md` uses `## Top Residual Risks`.
- **F-003** (NFR matrix format): `docs/hld/08-nfr-traceability.md` standardizes `Addressed By` cells around ADR references, `_Non-Architectural_`, or `_Out of Scope_`.
- **F-004** (ADR-003 option structure): `docs/hld/adrs/ADR-003-process-management-bun-spawn.md` now separates the process-spawning decision from the cleanup-mechanism decision.
- **F-005** (NFR-COMP-003 mapping): `docs/hld/08-nfr-traceability.md` maps vanilla Minecraft 1.20+ support to both `ADR-003` and `ADR-006`.
- **F-006** (stale suggested diff): the obsolete Windows cleanup proposal was removed from this file.
- **F-007** (`bun:sqlite` justification): `docs/hld/adrs/ADR-002-sessions-sqlite-wal.md` cites `C-01` and explains why `bun:sqlite` is the selected driver.

## Current Status

**Ready for LLD.** There are no remaining Blocker, Major, or Minor review findings open.
