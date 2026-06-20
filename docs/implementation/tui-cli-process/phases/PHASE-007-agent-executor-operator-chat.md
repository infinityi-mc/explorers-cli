# PHASE-007 - Agent Executor And Operator Chat

**Status**: Planned  
**Goal**: Wire engine-lib providers, agents, shared sessions, streaming operator `/chat`, and provider error handling.  
**Depends on**: PHASE-002, PHASE-003  
**LLD sources**: `design.md` Agent Executor mapping and external dependencies; `api.md` `/operator/chat`, `/operator/session`, `/operator/resume`, `/operator/clear`; `sequences.md` sections 4 and 4b; `data-model.md` sessions; ADR-LLD-004; `errors.md` provider and session codes; `idempotency.md` `/operator/chat`; `tests.md` Agent and Session scenarios  
**Review findings addressed**: None

## Scope

- Provider registry from config using engine-lib provider factories.
- Agent definitions with system prompts, tools placeholder, resilience, event hub, telemetry, and stream handling.
- Shared `(serverId, agentId)` session lookup, tenant scoping, LRU handle cache, append/load/recent operations.
- Operator `/chat` online and offline behavior.
- Streaming tokens to the TUI and stable run handle reuse for idempotent `/chat` replay.
- Provider timeout, unavailable, rate limit, max steps, context, budget, and session error mapping.
- Complete `/session`, `/resume`, and `/clear` against persisted sessions.

## Out Of Scope

- In-game mention to agent execution; PHASE-008 wires the parser event.
- In-game `/tellraw` delivery; PHASE-008.
- Tool registration and sandbox policies; PHASE-009.

## Implementation Units

| Unit ID | Type        | Summary                                                                                                             | Source                           | Risk   |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| IU-025  | integration | Build provider registry, agent definitions, event hub subscribers, resilience pipeline, and provider error mapping. | `design.md` Agent Executor row   | High   |
| IU-026  | data        | Implement shared session lookup, tenant scoping, LRU handles, append/load/recent operations.                        | ADR-LLD-004                      | High   |
| IU-027  | flow        | Implement operator `/chat` online/offline, streaming tokens, timeout handling, and partial persistence.             | `sequences.md` sections 4 and 4b | High   |
| IU-028  | contract    | Complete `/session`, `/resume`, and `/clear` behavior against persisted session data.                               | `openapi.yaml` Session schemas   | Medium |
| IU-034  | test        | Cover provider, session, and operator chat behavior.                                                                | `tests.md` Agent scenarios       | High   |

## Work Items

1. Create provider clients from config using engine-lib factories and telemetry/resilience context.
2. Build agent definitions from config with provider, instructions, max steps/handoffs, timeout, and placeholder tool registration.
3. Wire engine-lib event hub subscribers for logging, audit, and telemetry redaction.
4. Implement active shared session lookup by `serverId:agentId:` prefix and suffixed session ID creation.
5. Wrap store access with tenant scoping or tenant claims per ADR-LLD-004.
6. Implement LRU session handle cache with `session.flush()` on eviction.
7. Implement online `/chat` using shared persisted session and offline `/chat` using ephemeral in-memory session.
8. Stream tokens to the TUI via `RunHandle` async iterable and expose completed run state.
9. Persist partial response on provider timeout as specified by `sequences.md` section 4.
10. Map engine-lib and forge errors to stable `errors.md` codes.
11. Complete `/session`, `/resume`, and `/clear` behavior with contract tests.
12. Add integration tests using engine-lib testing mock providers and real SQLite temp stores.

## Data And Deployment Notes

- Online `/chat` writes to `data/sessions.db`; offline `/chat` does not persist and does not deliver in-game.
- `/clear` drops in-memory handles only; persisted rows remain resumable.
- Session IDs must match ADR-LLD-004 composite format.

## Tests And Verification

- Unit tests: session ID format, LRU eviction, error mapping, idempotent run-handle reuse.
- Integration tests: online chat persists messages, offline chat avoids DB writes, timeout persists partial response, provider 429/5xx retry mapping.
- Contract tests: `/operator/chat`, `/session`, `/resume`, `/clear`, and error envelopes validate against OpenAPI.
- End-to-end or smoke tests: operator sends `/chat` to mock provider and sees streamed tokens in TUI.
- Manual checks: inspect session rows and TUI session list after a chat.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Metrics: agent runs total, run duration, tokens total, provider errors, session append total/duration.
- Logs: provider timeout and run finish with runId, agentId, serverId, but no prompt content at INFO.
- Audit: provider timeout and run finish where required by event subscribers.

## Acceptance Criteria

- Operator online `/chat` streams tokens and persists user/assistant turns to the shared session.
- Offline `/chat` streams tokens without persisted session or in-game delivery.
- Provider timeout aborts the request, persists partial output, emits audit/log evidence, and returns `PROVIDER_TIMEOUT`.
- `/session`, `/resume`, and `/clear` behave per OpenAPI and idempotency docs.
- Replayed `/chat` within 5 seconds returns the original run handle.

## Review Packet

- Expected files or modules touched: provider registry, agent executor, session service, router handlers, TUI chat panel, tests.
- LLD sections reviewers should compare against: `design.md` Agent Executor row, `sequences.md` sections 4 and 4b, ADR-LLD-004, `errors.md`, `idempotency.md`.
- Expected evidence: mock provider stream output, session DB rows, timeout test output, contract validation output.

## Risks And Questions

- Verify actual engine-lib API names and event variants against `references/engine-lib/docs/guide/` before coding.
- Tool registration is intentionally incomplete in this phase; agent definitions must be structured so PHASE-009 can add tools without redesign.
