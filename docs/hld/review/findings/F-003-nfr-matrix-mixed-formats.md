# F-003: NFR-traceability matrix mixes ADR references and "Owner:" entries in same column

- **Severity**: Minor
- **Dimension**: nfr-matrix
- **Lens**: traceability-auditor
- **Location**: `docs/hld/08-nfr-traceability.md` lines 12, 13, 14, 15, 46, 47
- **Status**: Resolved

## Finding

The NFR-traceability matrix uses three different conventions in the
"Addressed by" column:

1. ADR-only references (e.g. line 9: `` `ADR-003` (Process Management) ``)
2. "Owner: <component>; rationale: ..." (e.g. line 12: `` Owner: `Server Process Manager`; rationale: user-space process model in `ADR-003` ``)
3. "_Out of Scope_" (e.g. line 15)

Lines 12–14 and 46–47 use convention #2. Conventions #1 and #2 carry the
same semantic intent (name the architectural owner) but read
inconsistently, which makes matrix scanning harder.

Specifically:

- Line 12 (`NFR-COMP-004`): `Owner: `Server Process Manager`; rationale: user-space process model in `ADR-003``
- Line 13 (`NFR-COMP-005`): `Owner: Deployment documentation; rationale: operational documentation record`
- Line 14 (`NFR-COMP-006`): `Owner: Compliance documentation; rationale: operational documentation record`
- Line 46 (`NFR-MNT-001`): `Owner: Tool Sandbox Broker documentation; rationale: extension documentation record linked to `ADR-004``
- Line 47 (`NFR-MNT-002`): `Owner: Release management process; rationale: repository governance record`

## Why it matters

The matrix is the authoritative SRS-NFR-to-architecture mapping. Mixed
formats force LLD authors to re-read cells to determine whether a
non-ADR row actually has an architectural owner (e.g.
NFR-COMP-004 references ADR-003 inside the "rationale" sub-phrase; an
LLD author skimming the column would not notice).

## Recommendation

Pick one format and apply it uniformly. Recommendation:

- Use ADR-only references for any NFR with an architectural decision.
- Use a single explicit token (e.g. `_Non-Architectural_`) for NFRs whose
  architectural ownership is documentation/process only.
- Move the "rationale" text into the "Residual Risk / Status" column
  where it is currently being smuggled into the addressee column.

Specific rewrites (proposal, not auto-fix because the rewrites involve
author judgment on residual-risk prose):

| NFR          | Current                                                                                                     | Proposed                        |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------- |
| NFR-COMP-004 | `Owner: \`Server Process Manager\`; rationale: user-space process model in \`ADR-003\``                     | `ADR-003` (Process Management)  |
| NFR-COMP-005 | `Owner: Deployment documentation; rationale: operational documentation record`                              | `_Non-Architectural_`           |
| NFR-COMP-006 | `Owner: Compliance documentation; rationale: operational documentation record`                              | `_Non-Architectural_`           |
| NFR-MNT-001  | `Owner: Tool Sandbox Broker documentation; rationale: extension documentation record linked to \`ADR-004\`` | `ADR-004` (Sandbox Tool Broker) |
| NFR-MNT-002  | `Owner: Release management process; rationale: repository governance record`                                | `_Non-Architectural_`           |

Add a footnote explaining the `_Non-Architectural_` token: "Rows marked
`_Non-Architectural_` are requirements with no LLD-level design decision.
Each such row must name the owning non-design artifact in the
residual-risk column."

## Cross-references

- HLD: `docs/hld/08-nfr-traceability.md`
- Resolution tracking: `docs/hld/suggested-revisions.md` Applied Minor Revisions
