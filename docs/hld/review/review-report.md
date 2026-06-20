# HLD Technical Review Report — explorers-cli (Minecraft Server Manager TUI)

**HLD reviewed**: `docs/hld/` (9 docs + 8 ADRs)
**Source SRS**: `docs/srs/srs.md` v1.4 (formal ISO/IEC/IEEE 29148-style SRS refactor)
**HLD version**: Ready for LLD (per `docs/hld/README.md`)
**Review date**: 2026-06-19
**Reviewer**: QA Principal
**Review context**: Intended next step is LLD via `low-level-designer`. The HLD already contains a prior `suggested-revisions.md` addressing four findings from an earlier review pass; this report is the formal hld-reviewer pass.

## Executive summary

The HLD is structurally complete and traces fully to the SRS. All 42 NFRs are addressed, every functional requirement maps to a component, all six constraints are respected, all five external interfaces appear in C4 L1, and all 8 ADRs cite SRS requirements. The architecture is a single-process Bun CLI with a clear C4 L2 (1 internal container, 1 external Java process, 3 data stores), a sound C4 L3 (8 components), and a high-quality STRIDE threat model with concrete threats tied to real ADRs.

The review surfaced **7 Minor findings** and **0 Majors or Blockers**. All 7 Minor findings have been resolved in the HLD artifacts.

**Verdict: Ready for LLD.** SRS coverage is 100%. All blockers to LLD component design are absent.

## Readiness verdict

**Verdict**: Ready for LLD

**Rationale**: The HLD has complete SRS coverage (100% FR, 100% NFR, 100% constraint, 100% EI), 0 Blockers, 0 Majors, and all 7 Minor findings resolved. Container decomposition is sensible for a single-process CLI, no ADR contradictions exist, the NFR matrix is complete and consistently formatted, and the deployment topology is consistent with the NFR-AVAIL/NFR-SCAL profile (which is N/A for a local CLI).

**Conditions**: None.

## Metrics

| Metric             | Count      |
| ------------------ | ---------- |
| Blockers           | 0          |
| Majors             | 0          |
| Minors             | 7 resolved |
| Auto-fixed         | 3          |
| Proposed revisions | 0          |
| Customer questions | 0          |
| Total findings     | 7          |

### Findings by dimension

| Dimension               | Count            |
| ----------------------- | ---------------- |
| SRS traceability        | 0                |
| Container decomposition | 0                |
| ADR quality             | 2 (F-004, F-007) |
| NFR matrix completeness | 2 (F-003, F-005) |
| Threat model quality    | 1 (F-002)        |
| Deployment topology     | 0                |
| Diagram quality         | 0                |
| Internal consistency    | 2 (F-001, F-006) |

### SRS coverage

| SRS category                | Total | Mapped to HLD | Coverage |
| --------------------------- | ----- | ------------- | -------- |
| Functional requirements     | 105   | 105           | 100%     |
| Non-functional requirements | 42    | 42            | 100%     |
| Constraints                 | 6     | 6             | 100%     |
| External interfaces         | 5     | 5             | 100%     |

Notes on coverage:

- **FR count of 105** includes UI-1..5 (5), CMD-1..9 (9), CHAT-1..3 (3), CFGIF-1..5 (5), LLMIF-1..3 (3), MCIF-1..5 (5), FR-CFG-001..013 (13), FR-HOT-001..010 (10), FR-SRV-001..020 (20), FR-FLG-001..003 (3), FR-AGT-001..011 (11), FR-CHAT-001..011 (11), FR-INV-001..013 (13), FR-SES-001..011 (11), FR-TOOL-001..012 (12), FR-DEF-001..004 (4 deferred). Each FR is mapped in `00-requirements.md`'s "Functional and Interface Requirements Traceability" table with an "HLD Owner" column and an evidence/decision column referencing either an ADR file or `03-components.md`. The Deferred FR-DEF-\* entries have an explicit "Scope boundary" evidence record rather than being silently omitted.
- **NFR count of 42** matches the SRS Section 5. The matrix `08-nfr-traceability.md` covers all 42 rows; all 42 have an addressing entry (ADR reference or `_Non-Architectural_` or `_Out of Scope_`).
- **Constraint coverage (6/6)**: C-01 (Bun) → ADR-003; C-02 (@opentui) → 03-components.md TUI View Engine; C-03 (@infinityi libs) → ADR-006, ADR-007; C-04 (process streams only) → ADR-003, ADR-005, MCIF-1..5; C-05 (file lock) → FR-SRV-020 → Lock & Lockout Service; C-06 (SQLite + pids.json) → ADR-002, 02-architecture.md PID Registry.
- **EI coverage (5/5)**: EI-01 (operator CLI input), EI-02 (TUI output), EI-03 (MC process IO), EI-04 (LLM APIs), EI-05 (config watcher) — all present as labeled arrows in C4 L1 (`01-context.md`).

### Findings by HLD file

| HLD file                                                | Findings           |
| ------------------------------------------------------- | ------------------ |
| `docs/hld/06-deployment.md`                             | F-001 (auto-fixed) |
| `docs/hld/07-security.md`                               | F-002 (auto-fixed) |
| `docs/hld/08-nfr-traceability.md`                       | F-003, F-005       |
| `docs/hld/adrs/ADR-003-process-management-bun-spawn.md` | F-004              |
| `docs/hld/adrs/ADR-002-sessions-sqlite-wal.md`          | F-007              |
| `docs/hld/suggested-revisions.md`                       | F-006 (auto-fixed) |

## Top findings to address first

All findings have been addressed. No further HLD review findings need to be resolved before LLD.

## Customer questions

None. The HLD trace is complete and no requirement is ambiguous enough to require customer input. The Minor findings are presentation/formatting refinements that the architect can resolve independently.

## Applied revisions (auto-fixed)

The following Minor findings were fixed directly in the HLD. Review the diff to verify. If you disagree, revert and update the finding card's status to "Open".

- **F-001**: Renamed `TUI & CLI Application` → `TUI & CLI Process` in `docs/hld/06-deployment.md` line 20 to align with the canonical name used in `02-architecture.md`, `03-components.md`, and `07-security.md`.
- **F-002**: Renamed `## Top 3 Residual Risks` → `## Top Residual Risks` in `docs/hld/07-security.md` line 33 to match the actual count of 4 risks listed in the section.
- **F-006**: Removed the stale `## F-004: Settle Windows Process Cleanup Semantics` block from `docs/hld/suggested-revisions.md` (lines 51–64 of the prior version); the proposed diff was already reflected in `ADR-003-process-management-bun-spawn.md` line 75. The substantive concern that the original F-004 was tracking is now subsumed under finding F-004 of this review (which restates the issue against the _current_ ADR-003 and proposes a broader Options-section restructure).

## Resolved proposed revisions

The four originally proposed revisions have been applied:

- **F-003** — Standardized the NFR-traceability matrix addressing column.
- **F-004** — Restructured ADR-003 to compare both spawn library and cleanup strategy decisions.
- **F-005** — Strengthened NFR-COMP-003 mapping to include both ADR-003 and ADR-006.
- **F-007** — Justified the `bun:sqlite` driver choice in ADR-002 against C-01.

## Unmapped SRS requirements

None. All 105 functional requirements and 42 NFRs are mapped. All 6 constraints are respected. All 5 external interfaces appear in C4 L1.

## All findings

| ID    | Severity | Dimension            | Lens                 | Title                                                                                                              | Card                                                    |
| ----- | -------- | -------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| F-001 | Minor    | internal-consistency | solution-architect   | Container name "TUI & CLI Application" diverges from canonical "TUI & CLI Process"                                 | `findings/F-001-container-name-inconsistency.md`        |
| F-002 | Minor    | threat-model         | security             | STRIDE "Top 3 Residual Risks" heading but the section lists 4 risks                                                | `findings/F-002-top-residual-risks-count-mismatch.md`   |
| F-003 | Minor    | nfr-matrix           | traceability-auditor | NFR-traceability matrix mixes ADR references and "Owner:" entries in same column                                   | `findings/F-003-nfr-matrix-mixed-formats.md`            |
| F-004 | Minor    | adr-quality          | solution-architect   | ADR-003 "Options considered" only compares spawn libraries but the Decision commits to specific cleanup strategies | `findings/F-004-adr-003-conflates-decisions.md`         |
| F-005 | Minor    | nfr-matrix           | traceability-auditor | NFR-COMP-003 (vanilla Minecraft 1.20+ support) mapped to ADR-006 with a chat-parsing rationale                     | `findings/F-005-nfr-comp-003-weak-mapping.md`           |
| F-006 | Minor    | internal-consistency | solution-architect   | suggested-revisions.md F-004 diff is stale relative to current ADR-003                                             | `findings/F-006-stale-suggested-revision-diff.md`       |
| F-007 | Minor    | adr-quality          | solution-architect   | ADR-002 commits to bun:sqlite without comparing SQLite drivers                                                     | `findings/F-007-adr-002-driver-choice-not-justified.md` |

## Cross-cutting observations (informational)

These observations are not formal findings — they are noted for context and do not affect the readiness verdict.

- **C4 L2 container count (2)** is well below the typical 4–8 range, but defensible: this is a single-process CLI tool. The HLD correctly distinguishes "runtime containers" from "data stores" (SQLite, PID registry, lock file), in line with C4 conventions. `02-architecture.md` makes this distinction explicit in its preamble.
- **STRIDE table** has 11 rows across all 6 STRIDE categories, each referencing a specific container, a real ADR, and a real NFR/FR. Threats are concrete (e.g. "agent tools execute path traversal (`..` or symlinks) to read/edit system configuration files") rather than boilerplate.
- **All 8 ADRs** follow MADR format (Status, Context, Requirements driving this decision, Options considered, Decision, Rationale, Consequences with Positive/Negative/Neutral, Mitigations, Links). Each cites at least 4 SRS requirements in the "Requirements driving this decision" section.
- **The prior `suggested-revisions.md`** indicates the HLD already went through one round of architectural review. Two of its four proposed edits (F-001 alignment, F-002 NFR mapping) have been substantively applied; one (F-003 in the prior numbering, the threat-model heading) was partially applied; one (F-004 Windows cleanup) was applied during a subsequent ADR-003 edit, which made the diff in the file stale.
- **SRS Sections covered**: Section 1 (Intro), 2 (Overall Description), 3 (External Interface Requirements), 4 (Specific Requirements), 5 (Non-Functional Requirements), 6 (Data Requirements), 7 (Behavioral Requirements), 8 (Error Handling), 9 (Acceptance Criteria), 10 (Verification), 11 (Rollout), 12 (Open Questions), 13 (Traceability Matrix), Appendices A–D. All have HLD coverage.

## Next steps

1. **No customer questions to send** — verdict is Ready with no open questions blocking LLD.
2. **Begin LLD**. Recommended container-level LLD sequence (per `02-architecture.md`):
   - **TUI & CLI Process** container LLD: a single LLD covering all 8 components (TUI View Engine, Configuration Service, Lock & Lockout Service, Server Process Manager, Log Reader & Rate Limiter, Chat Parser & Authorizer, Agent Executor, Tool Sandbox Broker). The HLD's own "HLD-Level Follow-Up for LLD" section (`08-nfr-traceability.md` lines 56–62) lists 5 specific LLD work items already flagged.
   - **Minecraft Java Server**: external; no LLD required (black-box subprocess per `03-components.md` lines 105–108).
   - **Data stores** (SQLite, PID registry, lock file): LLD only the SQLite schema (indexes per NFR-PERF-006) and the PID/lock file atomic-write conventions.
3. **Optional confirmation pass**: re-run the HLD review if you want an independent check of the applied ADR-003 restructure.

**No re-review required for the verdict to stand.** The verdict is Ready for LLD.
