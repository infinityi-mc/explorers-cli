# F-004: Missing error responses in OpenAPI `/operator/chat` for codes listed in errors.md

- **Severity**: Major
- **Dimension**: api-contract
- **Lens**: backend-architect
- **Location**: `docs/lld/tui-cli-process/openapi.yaml` lines 220–244 (`/operator/chat` responses block) vs `docs/lld/tui-cli-process/errors.md` lines 28–35 (relevant error codes)
- **HLD reference**: `docs/hld/05-api-surface.md` lines 70–78 (high-level error categories)
- **SRS reference**: N/A
- **Status**: Resolved

**Resolution**: `/operator/chat` now declares the missing `403`, `422`, `429`, `500`, and `503` responses and examples in `openapi.yaml`.

**Finding**: The OpenAPI spec for `POST /operator/chat` declares only three response codes: `200` (success), `404` (agent or server not found), `504` (provider timeout). The LLD's `errors.md` defines the following additional operator-`/chat` error codes that are NOT mapped to OpenAPI responses:

| Error code | HTTP per errors.md | Missing from OpenAPI |
|---|---|---|
| `PROVIDER_TIMEOUT` | 504 | ✓ present |
| `PROVIDER_UNAVAILABLE` | 503 | ✗ missing |
| `PROVIDER_RATE_LIMITED` | 429 | ✗ missing |
| `CONTEXT_WINDOW_EXCEEDED` | 500 | ✗ missing |
| `MAX_STEPS_EXCEEDED` | 500 | ✗ missing |
| `MAX_HANDOFFS_EXCEEDED` | 500 | ✗ missing |
| `BUDGET_EXCEEDED` | 500 | ✗ missing |
| `AGENT_NOT_FOUND` | 404 | ✓ present |
| `SERVER_NOT_FOUND` | 404 | ✗ missing (errors.md row line 26, not surfaced) |
| `READ_ONLY_BLOCKED` | 403 | ✗ missing |
| `CONFIG_INVALID` | 422 | ✗ missing |

Contract tests will only validate the three declared responses. A runtime `PROVIDER_RATE_LIMITED` will return a `429` envelope that the spec doesn't promise, and contract-test-driven documentation will mislead API consumers (here, the TUI client) about which errors it must handle.

**Why it matters**: The OpenAPI spec is the contract — both for client implementation and for the contract tests in `tests.md` §Contract tests. If the contract test only verifies `200`/`404`/`504`, a regression that drops `PROVIDER_RATE_LIMITED` handling won't be caught. The TUI's error-handling code will be incomplete relative to what the spec promises.

**Recommendation**: Add responses for the missing codes to the `/operator/chat` operation in `openapi.yaml`:

```yaml
'403':
  $ref: '#/components/responses/ReadOnlyBlocked'
'422':
  $ref: '#/components/responses/ConfigInvalid'
'429':
  $ref: '#/components/responses/ProviderRateLimited'
'500':
  $ref: '#/components/responses/InternalAgent'
'503':
  $ref: '#/components/responses/ProviderUnavailable'
```

Or simply add inline error responses per code (matching the existing pattern for `/operator/start`). Also add `SERVER_NOT_FOUND` to the `404` response description or split it into separate codes.

The same audit should be done for `/operator/start`, `/operator/stop`, `/operator/restart`, `/operator/clear`, `/operator/resume` — but the gaps there are narrower (mostly missing `READ_ONLY_BLOCKED` and `SERVER_NOT_FOUND`).

**Customer/designer question**: N/A — this is mechanical contract completion.
