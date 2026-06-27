# PHASE-008 - In-Game Agent Responses

**Status**: Planned  
**Goal**: Connect authorized in-game mentions to shared agent sessions and deliver chunked responses back through Minecraft stdin.  
**Depends on**: PHASE-006, PHASE-007  
**LLD sources**: `design.md` Algorithm 6 and Agent Executor mapping; `sequences.md` sections 3 and 4c; `api.md` In-game chat interface; `openapi.yaml` `/ingame/tellraw`; ADR-LLD-004; `errors.md` `OFFLINE_FAIL`, `TELLRAW_FALLBACK`, `CHUNK_SPLIT_FAILED`; `tests.md` E2E happy path  
**Review findings addressed**: None

## Scope

- Mention event subscription from Chat Parser to Agent Executor.
- N-line context injection using engine-lib context, excluding the triggering mention line.
- Shared session use for in-game mentions with player context persisted.
- Final response delivery through `/tellraw @a` chunks.
- Formatting marker strip, sentence/clause/word chunking to <= 200 characters, 500 ms pacing, and `/say` fallback.
- Offline/race handling when server stops during a run.

## Out Of Scope

- Tool calls inside agent runs; PHASE-009.
- Custom chat formats; explicitly out of scope in the LLD.
- Auto-restart on server crash; out of scope for v1.

## Implementation Units

| Unit ID | Type          | Summary                                                                                           | Source                                           | Risk   |
| ------- | ------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------ |
| IU-029  | flow          | Wire Chat Parser mentions to Agent Executor with N-line context injection excluding trigger line. | `sequences.md` section 3                         | High   |
| IU-030  | reliability   | Implement chunked `/tellraw`, formatting strip, pacing, `/say` fallback, and offline failure.     | `design.md` Algorithm 6                          | High   |
| IU-024  | observability | Extend mention audit and metrics through run completion.                                          | `observability.md` Chat parser and agent metrics | Medium |
| IU-034  | test          | Cover end-to-end mention to response delivery.                                                    | `tests.md` E2E scenario 1                        | High   |

## Work Items

1. Subscribe Agent Executor to authorized Mention events emitted in PHASE-006.
2. Load recent session messages and N preceding chat/log lines as required by `ingameMessageWindow`.
3. Exclude the triggering mention line from injected context.
4. Append user and assistant turns with `playerContext.playerName` populated.
5. Stream tokens to TUI during in-game runs.
6. On run finish, strip Minecraft formatting markers from the final response.
7. Split response into <= 200 character chunks using sentence, clause, word, then hard-split fallback.
8. Send `/tellraw @a <json>` through Server Process Manager and pace chunks by 500 ms.
9. Fall back to `/say` for failed chunks and audit each outcome.
10. Return `OFFLINE_FAIL` if the server is not RUNNING at delivery time while preserving the session/TUI response.
11. Add E2E test with a stub server that emits chat and accepts stdin commands.

## Data And Deployment Notes

- Session append happens before in-game delivery, so a failed `/tellraw` does not lose conversation history.
- Delivery uses child stdin only; no RCON or network API is introduced.
- Rollback can disable mention-to-agent subscription while keeping parser and operator `/chat` behavior.

## Tests And Verification

- Unit tests: chunk splitter, formatting strip, offline delivery, fallback command formatting.
- Integration tests: authorized mention triggers agent run and session append; server stops mid-run returns offline delivery failure but keeps session.
- Contract tests: `/ingame/tellraw` request/response shapes validate against OpenAPI.
- End-to-end or smoke tests: boot, start stub server, player mention, mock provider response, `/tellraw` command observed on stdin, stop server.
- Manual checks: TUI shows run tokens and server stdin receives chunked response.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Metrics: agent runs total by server/agent/outcome, session appends, tellraw/say audit writes.
- Logs: `tellraw_sent` and `say_fallback` fields from `observability.md`.
- Audit: `mention_authorized`, `tellraw_sent`, `say_fallback`, and `tellraw_skipped` as applicable.

## Acceptance Criteria

- An authorized in-game `@alias` mention starts exactly one agent run.
- Prompt context includes N preceding lines and excludes the trigger line.
- The response is persisted before delivery.
- Chunks are <= 200 characters and paced by 500 ms.
- `/say` fallback and offline delivery are audited.

## Review Packet

- Expected files or modules touched: mention router, agent executor integration, delivery pipeline, process manager sendCommand seam, TUI chat updates, tests.
- LLD sections reviewers should compare against: `sequences.md` sections 3 and 4c, `design.md` Algorithm 6, ADR-LLD-004, `openapi.yaml` `/ingame/tellraw`.
- Expected evidence: E2E output, stdin command capture, session DB rows, audit sample, chunking test output.

## Risks And Questions

- Delivery pacing tests must use injected time or test clock to avoid slow test suites.

## Tellraw command

```mcfunction
["",{hover_event:{action:"show_text",value:["",{color:"gray",text:"Agent: "},{color:"light_purple",text:"<agent-name>"},{},{color:"gray",text:"Model: "},{color:"green",text:"<model-id>"},{},{color:"gray",text:"Player:"},{color:"aqua",text:" <Who mention agent>"},{},{color:"gray",text:"Token: "},{color:"yellow",text:"<Token usage for this request>"},{},{color:"gray",text:"Status:"},{color:"white",text:" <"},{color:"dark_green",text:"Success "},{color:"white",text:": "},{color:"red",text:"Error code"},{color:"white",text:">"}]},text:"",extra:[{color:"white",text:"["},{color:"aqua",text:"<agent-alias>"},{color:"white",text:"]"}]},{color:"gray",text:" <agent response>"}]
```
