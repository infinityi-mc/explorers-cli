# Implementation Traceability - TUI & CLI Process

## LLD Element To Implementation Unit Mapping

| LLD element                                          | Implementation units                                           | Phase                                      |
| ---------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------ |
| `README.md` stack inference and assumptions          | IU-001, IU-002, IU-003, IU-034                                 | PHASE-001                                  |
| `design.md` forge/engine-lib mapping                 | IU-002, IU-003, IU-005, IU-008, IU-018, IU-025, IU-031         | PHASE-001 through PHASE-009                |
| `design.md` Algorithm 1 chat parsing                 | IU-022, IU-023, IU-024                                         | PHASE-006                                  |
| `design.md` Algorithm 2 server start/stop            | IU-014, IU-015, IU-016, IU-017                                 | PHASE-004                                  |
| `design.md` Algorithm 3 bounded log ingestion        | IU-018, IU-019                                                 | PHASE-005                                  |
| `design.md` Algorithm 4 hot-reload validation        | IU-003, IU-020, IU-021                                         | PHASE-001, PHASE-005                       |
| `design.md` Algorithm 5 read-only mode               | IU-011, IU-013                                                 | PHASE-003                                  |
| `design.md` Algorithm 6 in-game delivery             | IU-030, IU-033                                                 | PHASE-008                                  |
| `api.md` operator commands                           | IU-010, IU-011, IU-012, IU-013, IU-015, IU-016, IU-027, IU-028 | PHASE-003, PHASE-004, PHASE-007            |
| `api.md` in-game chat and tellraw surfaces           | IU-022, IU-023, IU-029, IU-030                                 | PHASE-006, PHASE-008                       |
| `api.md` agent tool schemas                          | IU-031, IU-032, IU-033                                         | PHASE-009                                  |
| `openapi.yaml` schemas and examples                  | IU-010, IU-013, IU-027, IU-028, IU-032, IU-034                 | PHASE-003 onward                           |
| `data-model.md` sessions and messages                | IU-008, IU-026, IU-028                                         | PHASE-002, PHASE-007                       |
| `data-model.md` audit entries                        | IU-008, IU-024, IU-033                                         | PHASE-002, PHASE-006, PHASE-009            |
| `data-model.md` pruning state                        | IU-009                                                         | PHASE-002                                  |
| `data-model.md` config, pids, lock shapes            | IU-003, IU-006, IU-007                                         | PHASE-001, PHASE-002                       |
| `migration-plan.md` M-001 through M-004              | IU-006, IU-007, IU-008                                         | PHASE-002                                  |
| `sequences.md` section 1 `/start`                    | IU-011, IU-012, IU-015, IU-018                                 | PHASE-003, PHASE-004, PHASE-005            |
| `sequences.md` section 2 crash cleanup               | IU-017, IU-024                                                 | PHASE-004                                  |
| `sequences.md` section 3 mention agent run           | IU-022, IU-023, IU-025, IU-026, IU-029, IU-030                 | PHASE-006 through PHASE-008                |
| `sequences.md` sections 4 and 4b operator chat       | IU-025, IU-026, IU-027                                         | PHASE-007                                  |
| `sequences.md` section 4c tellraw fallback           | IU-030, IU-033                                                 | PHASE-008                                  |
| `sequences.md` section 5 hot-reload                  | IU-020, IU-021, IU-019                                         | PHASE-005                                  |
| `sequences.md` section 6 tool allowlist block        | IU-031, IU-032, IU-033                                         | PHASE-009                                  |
| `sequences.md` section 7 idempotent `/start`         | IU-012, IU-015                                                 | PHASE-003, PHASE-004                       |
| `sequences.md` section 8 read-only reject            | IU-011, IU-013, IU-024                                         | PHASE-003                                  |
| `domain.md` class diagram and invariants             | IU-014, IU-022, IU-026, IU-031                                 | PHASE-003, PHASE-006, PHASE-007, PHASE-009 |
| `errors.md` error catalog                            | IU-013, IU-015, IU-017, IU-023, IU-027, IU-030, IU-031         | PHASE-003 onward                           |
| `idempotency.md` rules                               | IU-012, IU-027, IU-032                                         | PHASE-003, PHASE-007, PHASE-009            |
| `observability.md` metrics, logs, traces, alerts     | IU-005, IU-017, IU-018, IU-020, IU-024, IU-027, IU-033, IU-035 | All phases                                 |
| `tests.md` test pyramid and must-not-break scenarios | IU-034, IU-035, IU-037                                         | All phases, PHASE-010                      |

## HLD ADR Coverage

| HLD ADR                                | Implementation units                           | Phase                           |
| -------------------------------------- | ---------------------------------------------- | ------------------------------- |
| ADR-001 REST + SSE provider comms      | IU-025, IU-027                                 | PHASE-007                       |
| ADR-002 SQLite WAL session persistence | IU-008, IU-026, IU-009                         | PHASE-002, PHASE-007            |
| ADR-003 Bun.spawn and process cleanup  | IU-006, IU-007, IU-015, IU-016, IU-017, IU-037 | PHASE-002, PHASE-004, PHASE-010 |
| ADR-004 sandboxed tool broker          | IU-031, IU-032, IU-033                         | PHASE-009                       |
| ADR-005 bounded log ingestion          | IU-018, IU-019, IU-035                         | PHASE-005, PHASE-010            |
| ADR-006 chat parser and permissions    | IU-022, IU-023, IU-024, IU-029                 | PHASE-006, PHASE-008            |
| ADR-007 audit and observability        | IU-005, IU-008, IU-024, IU-027, IU-033, IU-035 | PHASE-001 through PHASE-010     |
| ADR-008 runtime config and safe modes  | IU-003, IU-011, IU-020, IU-021                 | PHASE-001, PHASE-003, PHASE-005 |

## LLD ADR Coverage

| LLD ADR                                     | Implementation units                                   | Phase                           |
| ------------------------------------------- | ------------------------------------------------------ | ------------------------------- |
| ADR-LLD-001 Forge-first / engine-lib-first  | IU-002, IU-003, IU-005, IU-008, IU-018, IU-025, IU-031 | All implementation phases       |
| ADR-LLD-002 Process lifecycle is host-owned | IU-006, IU-007, IU-015, IU-016, IU-017, IU-037         | PHASE-002, PHASE-004, PHASE-010 |
| ADR-LLD-003 Runtime mode classifier         | IU-011, IU-013                                         | PHASE-003                       |
| ADR-LLD-004 Shared session key              | IU-026, IU-027, IU-028, IU-029                         | PHASE-007, PHASE-008            |

## Requirement Coverage By Phase

| Requirement group                                       | Phase coverage                                        |
| ------------------------------------------------------- | ----------------------------------------------------- |
| FR-CFG-001..012                                         | PHASE-001, PHASE-005                                  |
| FR-HOT-001..010                                         | PHASE-005                                             |
| FR-SRV-001, 008, 010, 013, 014, 016, 017, 018, 019, 020 | PHASE-002, PHASE-004                                  |
| FR-CHAT-001..011                                        | PHASE-006, PHASE-008                                  |
| FR-INV-001..011                                         | PHASE-007, PHASE-008                                  |
| FR-SES-001, 002, 004, 006, 007, 008, 011                | PHASE-002, PHASE-007                                  |
| FR-TOOL-002, 004, 006, 008, 009, 010, 011               | PHASE-009                                             |
| FR-FLG-001..003                                         | PHASE-001, PHASE-005                                  |
| NFR-PERF-001..006                                       | PHASE-005, PHASE-010                                  |
| NFR-REL-001..007                                        | PHASE-002, PHASE-004, PHASE-005                       |
| NFR-SEC-001..010                                        | PHASE-001, PHASE-003, PHASE-004, PHASE-006, PHASE-009 |
| NFR-OBS-001..005                                        | PHASE-001 through PHASE-010                           |
| NFR-MNT-001, NFR-MNT-003                                | PHASE-001, PHASE-010                                  |
| NFR-PRV-001, NFR-PRV-002                                | PHASE-002, PHASE-007, PHASE-010                       |

## Review Finding Mapping

No LLD review findings were found because no LLD review report exists at `docs/lld/tui-cli-process/reviews/review-report.md`.

| Finding                     | Status        | Phase handling                 |
| --------------------------- | ------------- | ------------------------------ |
| OQ-001 No LLD review report | Open question | PHASE-001 readiness checkpoint |

The HLD review reported 0 blockers and 0 majors. All 7 minor HLD findings are marked resolved in `docs/hld/review/review-report.md`; no HLD review finding requires implementation-phase work beyond preserving the accepted HLD decisions.

## Unplanned LLD Elements

| LLD element                           | Reason                                                |
| ------------------------------------- | ----------------------------------------------------- |
| Music/audio feature                   | Explicitly deferred by LLD scope and traceability.    |
| Remote/network-facing manager API     | Explicitly out of scope; app is local terminal only.  |
| Multi-host clustering                 | Explicitly out of scope; single process and one host. |
| Plugin SDK for third-party tool packs | Documentation-only in v1.                             |
| Future SQLite schema migrations       | Deferred to follow-up LLDs beyond greenfield v1.      |

## Cross-Cutting Units

IU-034 appears in every phase because tests travel with behavior. Observability units appear in the same phases as the behavior they instrument; there is no final catch-all observability phase.
