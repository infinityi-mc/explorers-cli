# F-012: `/resume` no-arguments behavior unspecified — SRS FR-SES-011 mandates listing last 20 session IDs

- **Severity**: Minor
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/openapi.yaml` lines 260–290 (`/operator/resume` operation requires `sessionId` in request body; no description of no-arg behavior)
  - `docs/lld/tui-cli-process/api.md` (no entry for `/resume` no-arg behavior)
  - `docs/lld/tui-cli-process/traceability.md` (FR-SES-011 not in the FR traceability table)
- **HLD reference**: `docs/hld/05-api-surface.md` row "FR-SES-011: `/resume` lists last 20 available session IDs" and `docs/hld/00-requirements.md` row FR-SES-011
- **SRS reference**: `docs/srs/srs.md` line 377 ("`/resume` with no arguments SHOULD list the last 20 available session IDs for the current server and agent")
- **Status**: Resolved

**Resolution**: `/operator/resume` now accepts an omitted `sessionId` and returns the last 20 sessions via `SessionListResponse`; FR-SES-011 is traced.

**Finding**: `FR-SES-011` mandates `/resume` with no arguments SHOULD list the last 20 available session IDs for the current server and agent. The LLD's OpenAPI spec for `/operator/resume` has a required `sessionId` field in the request body — making the no-arg case impossible to express. `traceability.md` does not list FR-SES-011.

The OpenAPI `/operator/session` (GET) endpoint already lists sessions (per the OpenAPI `SessionListResponse.items[]` definition). The two endpoints could be conflated, but FR-SES-011 says the listing should be on `/resume` specifically.

**Why it matters**: An operator who types `/resume` with no args expects a picker (the SRS intent). The LLD's design makes the picker unreachable.

**Recommendation**:
1. Update OpenAPI `/operator/resume` to make `sessionId` optional. When omitted, the response is a `SessionListResponse` (the same shape as `/operator/session`). When provided, the response is a `SessionDetailResponse`.
2. Document the no-arg behavior in the operation description: "When `sessionId` is omitted, returns the last 20 session IDs for the current server and agent (FR-SES-011)."
3. Add FR-SES-011 to `traceability.md`.

**Customer/designer question**: N/A — this is a straightforward spec conformance fix.
