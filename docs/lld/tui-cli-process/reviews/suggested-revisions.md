# Suggested Revisions — TUI & CLI Process LLD Follow-up Review

## F-021: INTERNAL_ERROR leaks raw exception message to callers

**Severity**: Major
**Location**: `docs/lld/tui-cli-process/errors.md` — error table row for `INTERNAL_ERROR`
**Finding**: The catch-all error response currently includes `{error.message}`, which can disclose internal implementation details.

**Current**:

> `INTERNAL_ERROR` | 500 operator (any) / 500 agent run | An unexpected error occurred: {error.message} | Something went wrong. Check `logs/explorers-cli.log` for details. | retry-after-backoff | Unhandled exception (catch-all)

**Proposed**:

> `INTERNAL_ERROR` | 500 operator (any) / 500 agent run | An unexpected error occurred | Something went wrong. Check `logs/explorers-cli.log` with the request ID for details. | retry-after-backoff | Unhandled exception (catch-all); internal exception details are logged after redaction, never returned in the response |

If the OpenAPI spec models a 500 catch-all on additional operations, add an example like:

```yaml
ErrorInternal:
  summary: Unexpected internal error
  value:
    code: INTERNAL_ERROR
    message: An unexpected error occurred
    details:
      request_id: 550e8400-e29b-41d4-a716-446655440000
```

**Rationale for the change**: Raw exception messages may contain filesystem paths, SQL fragments, provider details, or other sensitive implementation context. A stable generic message preserves operator usability through request-ID correlation without leaking internals through the contract.

**Customer/designer question**: Should unexpected errors ever show raw technical details to the local operator, or should the UI always show a stable generic message plus a request ID while the detailed exception goes only to logs?
