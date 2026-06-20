# PHASE-003 - Operator Router And Read-Only Gate

**Status**: Planned  
**Goal**: Implement the operator command contract boundary with idempotency, read-only enforcement, and non-mutating command behavior.  
**Depends on**: PHASE-001, PHASE-002  
**LLD sources**: `api.md` Operator commands; `openapi.yaml` `/operator/*`; `idempotency.md`; `design.md` Algorithm 5; ADR-LLD-003; `domain.md`; `tests.md` Contract tests  
**Review findings addressed**: None

## Scope

- Command router dispatch table and parsed command model.
- OpenAPI schema loading for contract tests.
- Central `MutatingCommandClassifier` with mutating and non-mutating command sets.
- Idempotency cache for mutating operator commands.
- `/help`, `/session`, `/resume`, and `/clear` initial behavior, with later persistence completion in PHASE-007.
- Core domain value objects needed by command and lifecycle phases.

## Out Of Scope

- Actual `/start`, `/stop`, `/restart` process behavior; PHASE-004.
- Actual `/chat` provider behavior; PHASE-007.
- Chat parser and tool schemas beyond contract loading; PHASE-006 and PHASE-009.

## Implementation Units

| Unit ID | Type | Summary | Source | Risk |
| ------- | ---- | ------- | ------ | ---- |
| IU-010 | contract | Load OpenAPI schemas for contract tests over operator, in-game, and tool surfaces. | `openapi.yaml`, `tests.md` | Medium |
| IU-011 | security | Implement `MutatingCommandClassifier`, read-only command gate, and completeness tests. | ADR-LLD-003 | High |
| IU-012 | reliability | Implement operator idempotency cache with UUID and fallback hash keys, 5 second TTL, and lazy eviction. | `idempotency.md` | Medium |
| IU-013 | flow | Implement router dispatch for `/help`, `/session`, `/resume`, and `/clear` with contract-shaped responses. | `api.md`, `openapi.yaml` | Medium |
| IU-014 | domain | Implement domain value objects and runtime state used by command and lifecycle phases. | `domain.md` | Medium |
| IU-034 | test | Add command router unit and contract tests. | `tests.md` | Medium |

## Work Items

1. Define parsed command types and a router dispatch table for all LLD operator commands, including not-yet-implemented handlers that return stable errors or placeholders where safe.
2. Implement `MUTATING_COMMANDS` and `NON_MUTATING` exactly as ADR-LLD-003 defines them.
3. Add completeness tests ensuring every dispatch-table command appears in one classifier set.
4. Invoke the classifier before every handler and return `READ_ONLY_BLOCKED` for mutating commands in read-only mode.
5. Implement the idempotency cache with supplied UUID key, fallback hash, response caching for success and failure, lazy eviction, and 60 second sweep.
6. Implement `/help` with `mutating` flags and read-only banner data.
7. Implement initial `/session`, `/resume`, and `/clear` seams against the session store where available; leave agent-specific behavior to PHASE-007.
8. Add value object validation for IDs, aliases, player names, canonical paths, and runtime server state enums.
9. Add contract tests that validate responses against `openapi.yaml` schemas.

## Data And Deployment Notes

- Idempotency state is in memory only and must not add database writes.
- `/clear` drops in-memory handles only and must not delete session rows.
- Router behavior can ship before all mutating handlers are complete as long as incomplete handlers do not bypass read-only mode.

## Tests And Verification

- Unit tests: classifier table, router dispatch, idempotency TTL and body matching, value-object invariants.
- Integration tests: read-only mode rejects all mutating commands before handlers run and allows non-mutating commands.
- Contract tests: `/help`, `/session`, `/resume`, `/clear`, and error envelopes validate against OpenAPI.
- End-to-end or smoke tests: boot in read-only, call `/help` and attempted `/start`, verify displayed result.
- Manual checks: TUI help lists blocked commands in read-only mode.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Log command rejections with request IDs and without command argument secrets.
- Audit read-only rejections for mutating actions as specified in `sequences.md` section 8.
- Do not log prompt content for `/chat` attempts at INFO.

## Acceptance Criteria

- Every command is classified as mutating or non-mutating.
- Mutating commands are rejected in read-only mode before reaching handlers.
- Idempotency replay returns the original response within 5 seconds.
- Non-mutating commands remain allowed in read-only mode.
- Contract tests prove response shapes match the LLD OpenAPI spec.

## Review Packet

- Expected files or modules touched: router, classifier, idempotency cache, domain value objects, OpenAPI test helper, TUI command input integration.
- LLD sections reviewers should compare against: ADR-LLD-003, `idempotency.md`, `api.md`, `openapi.yaml`, `domain.md`.
- Expected evidence: classifier test output, idempotency replay test output, contract validation output, read-only terminal capture.

## Risks And Questions

- ADR-LLD-003 states unclassified commands default non-mutating but also requires tests/lint to catch omissions. Prefer the test as the first gate; add lint only if repo tooling supports it.
