# PHASE-006 - Chat Parser And Authorization

**Status**: Planned  
**Goal**: Parse Minecraft chat lines, enforce player permissions and rate limits, and emit mention or help outcomes without invoking agents yet.  
**Depends on**: PHASE-005  
**LLD sources**: `design.md` Algorithm 1; `api.md` In-game chat interface; `openapi.yaml` `/ingame/chat`; `errors.md` player rate/permission codes; `observability.md` Chat parser metrics and logs; `tests.md` Chat, Security, Reliability scenarios  
**Review findings addressed**: None

## Scope

- Vanilla Minecraft Java 1.20+ chat-line regex.
- Team prefix/suffix strip, player-name validation, first `@alias` detection, and help trigger parsing.
- Case-insensitive permission index lookup.
- Per `(serverId, agentId, playerName)` rpm limiter and cooldown.
- Mention/help events, silent ignore branches, audit records, and metrics.

## Out Of Scope

- Invoking engine-lib agents from authorized mentions; PHASE-008.
- `/tellraw` response delivery; PHASE-008.
- Tool sandbox behavior; PHASE-009.

## Implementation Units

| Unit ID | Type | Summary | Source | Risk |
| ------- | ---- | ------- | ------ | ---- |
| IU-022 | domain | Implement vanilla chat regex, team strip, player-name sanitization, first `@alias`, and help trigger. | `design.md` Algorithm 1 | Medium |
| IU-023 | security | Enforce deny-by-default authorization, case-insensitive lookup, rpm limiter, and cooldown. | `design.md` Algorithm 1 | High |
| IU-024 | observability | Emit mention authorized/denied/help audit, metrics, and redacted logs. | `observability.md` Chat parser metrics | Medium |
| IU-034 | test | Cover chat parser and authorization branches. | `tests.md` Security scenarios | High |

## Work Items

1. Implement compiled vanilla chat-line regex and ignored-line branch.
2. Implement configurable team prefix/suffix strip before player-name validation.
3. Validate player names with `^[a-zA-Z0-9_]{1,16}$` and silently ignore invalid names.
4. Find the first matching `@alias` in a message and strip the prefix from mention text.
5. Implement help trigger parsing that returns permitted agents without starting an LLM call.
6. Build permission indexes from the current config and rebuild them on PHASE-005 hot-reload hooks.
7. Enforce case-insensitive deny-by-default player authorization.
8. Configure `slidingWindowRateLimiter` per player-agent key and cooldown map.
9. Emit mention authorized/denied metrics and audit rows with redacted message target or digest.
10. Add contract tests for `IngameChatParseResult` branches.

## Data And Deployment Notes

- Parser state is in memory; no session rows are written in this phase.
- Unauthorized and rate-limited mentions are silent to the player but visible in audit/metrics.
- Rollback removes parser subscription from the log reader; log ingestion still works.

## Tests And Verification

- Unit tests: regex match, ignored lines, team strip, invalid name, first alias, help trigger, permission lookup, cooldown, rpm limiter.
- Integration tests: log reader forwards lines to parser and audit receives denied/authorized events.
- Contract tests: mention, help_trigger, and ignored parse results validate against OpenAPI.
- End-to-end or smoke tests: stub server emits chat lines and TUI/audit reflect parser outcomes.
- Manual checks: authorized and unauthorized sample players produce expected silent/audit behavior.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Metrics: chat lines parsed total, mentions authorized total, mentions denied total, rate-limit utilization.
- Logs: mention authorized/denied fields without raw message at INFO.
- Audit: `mention_authorized` and `mention_denied` action types.

## Acceptance Criteria

- Non-chat lines and invalid player names are ignored.
- Only the first matching alias is selected.
- Unauthorized and rate-limited mentions never reach Agent Executor seams.
- Authorized mentions emit a typed event containing server, agent, player, message, and timestamp.
- Contract and security tests cover every branch in Algorithm 1.

## Review Packet

- Expected files or modules touched: chat parser, permission index, limiter registry, event types, audit subscriber wiring, tests.
- LLD sections reviewers should compare against: `design.md` Algorithm 1, `openapi.yaml` `/ingame/chat`, `errors.md` player codes, `observability.md` chat parser metrics.
- Expected evidence: parser branch test output, contract validation output, redacted audit sample.

## Risks And Questions

- The LLD targets vanilla log format only. Do not add plugin-format compatibility without an LLD revision.
