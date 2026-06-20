# F-009: `/operator/restart` and `/operator/clear` OpenAPI operations missing examples and error responses

- **Severity**: Minor
- **Dimension**: api-contract
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/openapi.yaml` lines 169–189 (`/operator/restart` — no request body examples, no error responses)
  - `docs/lld/tui-cli-process/openapi.yaml` lines 292–317 (`/operator/clear` — no request body examples, no error responses)
- **HLD reference**: N/A — these are LLD contract completeness issues
- **SRS reference**: N/A
- **Status**: Resolved

**Resolution**: `openapi.yaml` now includes request examples and error responses for `/operator/restart` and `/operator/clear`.

**Finding**: `/operator/restart` and `/operator/clear` are mutating operations but the OpenAPI spec does not declare any error responses (no 403 for read-only blocking, no 404 for unknown server, no 422 for validation failures, no 409 for state conflicts). Both also lack request-body examples — the other mutating operations (`/operator/start`, `/operator/stop`, `/operator/chat`) include at least one example.

The `idempotency.md` "Per-operation rules" table covers both — restart has the 5-second per-phase window; clear has a 5-second window — but the OpenAPI spec doesn't surface these rules via examples or error mappings.

**Why it matters**: The contract tests in `tests.md` §Contract tests will only assert that the responses match the declared schemas. Without declared error responses, a regression that drops `READ_ONLY_BLOCKED` handling for `/operator/clear` will not be caught by the contract suite. The TUI client implementation will be under-specified.

**Recommendation** (auto-fix candidates):
- Add `requestBody.examples.happy` blocks mirroring `/operator/start`'s pattern.
- Add `responses` blocks with at minimum `403` (READ_ONLY_BLOCKED), `404` (SERVER_NOT_FOUND), and `409` (NOT_RUNNING for restart, NOT_FOUND for clear) for both operations.
- For `/operator/restart`, document the per-phase idempotency in the operation description.

**Customer/designer question**: N/A.
