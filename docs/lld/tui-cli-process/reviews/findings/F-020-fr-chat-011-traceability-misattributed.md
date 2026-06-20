# F-020: FR-CHAT-011 traceability points to Algorithm 1 which does not actually perform the N-line chat injection

- **Severity**: Minor
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/traceability.md` row FR-CHAT-011 (lists `design.md §Algorithm 1` as the primary addressee)
  - `docs/lld/tui-cli-process/design.md` Algorithm 1 (steps 1–7: regex match → strip → sanitize → find alias → perm check → rate limit → return Mention — no chat-line injection)
  - `docs/lld/tui-cli-process/sequences.md` §3 line 174 (the actual injection step: `Exec->>Exec: build context via engine-lib staticContext`)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-CHAT-011
- **SRS reference**: `docs/srs/srs.md` line 343 ("The system MUST inject the N most recent chat messages preceding the `@mention`, excluding the mention itself, when invoking an agent")
- **Status**: Resolved

**Resolution**: FR-CHAT-011 traceability now points to the Agent Executor/staticContext sequence, and the sequence/test strategy explicitly exclude the current mention line.

**Finding**: `traceability.md` cites `design.md §Algorithm 1` as the design that implements FR-CHAT-011. But Algorithm 1 only produces a `Mention` value object — it does not load or inject the N preceding chat lines. The injection actually happens later, in the Agent Executor (via `engine-lib/context`'s `staticContext`), as shown in `sequences.md` §3 step `Exec->>Exec: build context via engine-lib staticContext`.

Additionally, FR-CHAT-011 mandates the injection **excludes the mention itself**. The LLD does not document this exclusion — neither `design.md` Algorithm 1 nor `sequences.md` §3 calls out that the staticContext's lines must be filtered to exclude the current mention's text. `engine-lib/context`'s `staticContext` is generic; the caller is responsible for the filter, but the LLD doesn't state this.

**Why it matters**: A QA acceptance test for FR-CHAT-011 will inspect the prompt sent to the LLM and check that the preceding N chat lines are present AND that the current mention line is absent. Without explicit documentation of both the injection step and the exclusion filter, an implementer may ship an agent that re-injects its own trigger message into the context, doubling it in the model's view.

**Recommendation**:
1. Update `traceability.md` FR-CHAT-011 row to point to `sequences.md §3` (the staticContext step) and `design.md` Agent Executor row, not `design.md §Algorithm 1`.
2. Add a note in `sequences.md` §3 step: "Exec filters the current mention out of the staticContext lines (FR-CHAT-011 excludes the mention itself)."
3. Add a test scenario to `tests.md` §Key scenarios: "Agent invoked via `@alias hello` from Steve; the prompt sent to the LLM contains the N preceding chat lines BUT NOT the `<Steve> @alias hello` line itself."

**Customer/designer question**: N/A.
