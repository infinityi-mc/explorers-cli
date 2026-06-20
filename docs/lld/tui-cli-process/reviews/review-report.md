# LLD Technical Review Report — TUI & CLI Process

**LLD reviewed**: `docs/lld/tui-cli-process/`
**Source HLD**: `docs/hld/` (status: Ready for LLD)
**Component**: `TUI & CLI Process` (HLD L2 container)
**LLD version**: Draft — ready for review
**Review date**: 2026-06-19
**Reviewer**: QA Principal
**Review context**: Follow-up review after prior findings F-001 through F-020. Intended next step is implementation.

## Executive summary

The revised LLD is structurally complete and now resolves the previous Blocker and Major findings from the first review. HLD ADR coverage is **100%**: all 8 HLD ADRs that touch this container are implemented by the LLD without silent supersession.

The follow-up review found **0 Blockers**, **1 Major**, and **0 new Minors**. The remaining Major is a security/API hygiene issue: `INTERNAL_ERROR` currently permits raw `{error.message}` to be returned to callers. This should be fixed before implementation hardens the shared error envelope, but it does not block most component implementation.

## Readiness verdict

**Verdict**: Ready for implementation

**Rationale**: The LLD has no Blockers, one Major with a clear designer question, and 100% HLD ADR coverage. Implementation can begin, with the condition that F-021 is resolved before implementing the shared error handling layer or contract tests for 500 responses.

## Metrics

| Metric | Count |
| --- | --- |
| Blockers | 0 |
| Majors | 1 |
| Minors | 0 |
| Auto-fixed | 0 |
| Proposed revisions | 1 |
| Customer questions | 1 |
| Total open findings | 1 |

### Findings by dimension

| Dimension | Count |
| --- | --- |
| HLD compliance | 0 |
| API contract quality | 0 |
| Data model soundness | 0 |
| Sequence diagrams | 0 |
| Cross-cutting specs | 1 |
| Internal consistency | 0 |
| Requirements traceability | 0 |
| Implementability | 0 |

### HLD coverage

| HLD category | Total | Implemented by LLD | Coverage |
| --- | --- | --- | --- |
| HLD ADRs (in scope) | 8 | 8 | 100% |
| HLD NFRs (in scope) | 42 | 42 | 100% |
| HLD FRs (in scope) | 105 | 105 | 100% |

### OpenAPI completeness

| Check | Count |
| --- | --- |
| Operations with examples | 13/13 materially covered |
| Mutating ops with `Idempotency-Key` | 5/5 operator mutating commands |
| Error responses using shared `Error` schema | All HTTP-style error responses use `Error`; F-021 covers catch-all message hygiene |
| List endpoints with pagination | N/A — `/operator/session` is intentionally bounded and returns a flat list |

### Delta vs. previous review

| Status | Count |
| --- | --- |
| Fixed | 20 |
| Unresolved | 0 from F-001..F-020 |
| Newly introduced | 1 (F-021) |

## Top findings to address first

1. **F-021** — `INTERNAL_ERROR` leaks raw exception messages to callers. Major; resolve before implementing the shared error mapper.

## Customer/designer questions

1. Should unexpected errors ever show raw technical details to the local operator, or should the UI always show a stable generic message plus a request ID while the detailed exception goes only to logs?

## Applied revisions (auto-fixed)

None in this follow-up review.

## Proposed revisions (in suggested-revisions.md)

- **F-021** — Replace `INTERNAL_ERROR`'s returned machine message with a stable generic string and document that raw exception details go only to redacted logs.

## Unimplemented HLD ADRs

None.

| HLD ADR | Decision | Status |
| --- | --- | --- |
| ADR-001 | REST + SSE for LLM provider comms | Implemented via engine-lib providers |
| ADR-002 | SQLite WAL at `data/sessions.db` | Implemented via engine-lib session store + forge/data |
| ADR-003 | `Bun.spawn` + process groups / Windows Job Objects / `pids.json` | Implemented via host-owned process lifecycle, ADR-LLD-002 |
| ADR-004 | Sandboxed path containment + token-prefix allowlisting | Implemented via engine-lib tools-shell/tools-fs |
| ADR-005 | Bounded log ingestion | Implemented via forge rate limiter + host ring buffer |
| ADR-006 | Chat parser and permissions pipeline | Implemented via host regex pipeline + engine-lib context + forge rate limiter |
| ADR-007 | Structured logs, audit, telemetry privacy | Implemented via forge telemetry + engine-lib governance/events |
| ADR-008 | Runtime mode and config gateway | Implemented via forge config + ADR-LLD-003 classifier |

## All findings

| ID | Severity | Dimension | Lens | Title | Card |
| --- | --- | --- | --- | --- | --- |
| F-021 | Major | cross-cutting-specs | security, backend-architect | `INTERNAL_ERROR` leaks raw exception message to callers | `findings/F-021-internal-error-leaks-error-message.md` |

## Prior findings status

Findings F-001 through F-020 from the first review are resolved in the current LLD baseline. Key resolved areas include session ID conformance, in-game response delivery, `/tellraw` chunk sizing, OpenAPI error responses, runtime server state, audit action types, player context shape, feature flags, hot-reload apply-on-restart behavior, and chat traceability.

## Next steps

1. Resolve F-021 in `errors.md` and, if needed, add an `INTERNAL_ERROR` OpenAPI example.
2. Start implementation on unaffected areas immediately.
3. Before implementing the shared error mapper, decide the F-021 question and update the LLD accordingly.
