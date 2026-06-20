# F-003: Agent Executor in-game response delivery pipeline (FR-INV-004..011) is not specified in the LLD

- **Severity**: Major
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**: `docs/lld/tui-cli-process/sequences.md` §3 lines 187–189 (single `tellraw` write) and `docs/lld/tui-cli-process/openapi.yaml` line 774 (`TellrawRequest.text.maxLength: 256`)
- **HLD reference**: `docs/hld/00-requirements.md` rows `FR-INV-004`, `FR-INV-005`, `FR-INV-006`, `FR-INV-007`, `FR-INV-008`, `FR-INV-009`, `FR-INV-010`, `FR-INV-011`
- **SRS reference**: `docs/srs/srs.md` lines 352–359 (the entire FR-INV-004..011 group)
- **Status**: Resolved

**Resolution**: `design.md` now includes Algorithm 6 for formatting-strip, 200-character chunking, `/tellraw` delivery, `/say` fallback, audit events, and 500 ms inter-chunk delay. `sequences.md`, `errors.md`, `observability.md`, `openapi.yaml`, and `traceability.md` were updated.

**Finding**: Eight MUST-level SRS requirements defining the in-game response delivery pipeline are not addressed in the LLD:

- **FR-INV-004** (wrap output in `/tellraw` JSON) — the LLD has a `/ingame/tellraw` endpoint whose body shape is just `{serverId, text, selector}`. The actual `/tellraw` JSON wrapping (`{"text":"...","color":"..."}`) is implicit but never documented.
- **FR-INV-005** (`/say` fallback on `/tellraw` failure) — not mentioned anywhere.
- **FR-INV-006** (always attempt `/tellraw` first, never latch to `/say`) — not mentioned.
- **FR-INV-007** (responses visible to all players; default selector `@a`) — `TellrawRequest.selector` defaults to `@a` so this is implicitly satisfied, but the design.md does not state this rationale.
- **FR-INV-008** (strip `§` and `&` formatting markers before delivery) — not mentioned.
- **FR-INV-009** (chunk size max **200** characters per SRS line 357) — the OpenAPI `TellrawRequest.text.maxLength` is **256**. This is a direct SRS violation.
- **FR-INV-010** (split preference: sentence → clause → word boundary, never mid-word) — not mentioned.
- **FR-INV-011** (500 ms delay between chunks) — not mentioned.

`design.md`'s capability mapping table for the Agent Executor lists `a /tellraw writer that, on RunEvent.run.finish, calls serverMgr.sendCommand(serverId, 'tellraw @a ...')` — a single command, with no mention of formatting sanitization, chunking, fallback, or inter-chunk delay. `sequences.md` §3 confirms: one `tellraw` write at the end of the agent run, no chunking logic shown.

The LLD `traceability.md` lists FR-INV-001, FR-INV-002, FR-INV-003, FR-INV-009 — but not 004, 005, 006, 007, 008, 010, 011.

**Why it matters**: An implementer following the LLD will produce code that delivers a single (potentially very long) `/tellraw` per agent run, without sanitizing `§`/`&` markers (which Minecraft uses for color codes), without chunking, and without a `/say` fallback. A 4000-character agent response would either be truncated by the Minecraft 256-char chat limit or rejected. The user-visible behavior will diverge from the spec.

Additionally, the 200-vs-256 char mismatch is a literal SRS MUST violation: "MUST NOT exceed 200 characters" vs `maxLength: 256`.

**Recommendation**:
1. Add a new algorithm in `design.md` — "Algorithm 6: In-game response delivery pipeline" — that documents: (a) strip `§`/`&` formatting, (b) wrap in `/tellraw` JSON (`{"text":"..."}`), (c) chunk at sentence/clause/word boundaries with max chunk size 200 chars, (d) write chunks with 500 ms delay, (e) fall back to `/say` only if `/tellraw` write fails, (f) always re-attempt `/tellraw` on the next response (no latching).
2. Update `openapi.yaml` `TellrawRequest.text.maxLength` from 256 to 200 (the chunking happens above the API surface).
3. Update `traceability.md` to map FR-INV-004..011 to the new algorithm + `sequences.md` (which needs a new diagram for chunked delivery with `/say` fallback).
4. Update `errors.md` to add error codes for `/say` fallback (`TELLRAW_FALLBACK`) and chunking failures if needed.

**Customer/designer question**: The 200-char limit comes from the SRS and predates the LLD. The Minecraft client limit is 256. Which should win — the SRS or the modern Minecraft limit? If 256, FR-INV-009 should be amended; if 200, the OpenAPI spec needs the fix proposed above.
