# F-021: INTERNAL_ERROR leaks raw exception message to callers

- **Severity**: Major
- **Dimension**: cross-cutting-specs
- **Lens**: security, backend-architect
- **Location**: `docs/lld/tui-cli-process/errors.md` — error table row for `INTERNAL_ERROR`: `An unexpected error occurred: {error.message}`
- **Status**: Resolved

## Finding

The error catalog defines the catch-all error as:

> `INTERNAL_ERROR` | 500 operator (any) / 500 agent run | An unexpected error occurred: {error.message} | Something went wrong. Check `logs/explorers-cli.log` for details. | retry-after-backoff | Unhandled exception (catch-all)

Because `message` is the machine response surfaced through the shared OpenAPI `Error` schema, this permits raw exception messages to be returned to the operator or agent run caller. Raw exception messages often include internal class names, file paths, SQL fragments, provider responses, or local filesystem paths.

## Why it matters

The LLD otherwise takes redaction seriously, but this catch-all bypasses that posture at the API/error boundary. Implementers following this catalog will likely serialize `error.message` directly, creating information disclosure risk and inconsistent error hygiene. This also undermines contract tests because the `INTERNAL_ERROR` response becomes non-deterministic.

## Recommendation

Change the returned machine message to a stable non-leaking string and keep raw exception details only in redacted logs/audit entries correlated by `request_id`.

Suggested direction:

```markdown
| `INTERNAL_ERROR` | 500 operator (any) / 500 agent run | An unexpected error occurred | Something went wrong. Check `logs/explorers-cli.log` with the request ID for details. | retry-after-backoff | Unhandled exception (catch-all); internal exception details are logged after redaction, never returned in the response |
```

Also update `openapi.yaml` with an `ErrorInternal` example if `INTERNAL_ERROR` remains a response code in the contract.

## Customer/designer question

Should unexpected errors ever show raw technical details to the local operator, or should the UI always show a stable generic message plus a request ID while the detailed exception goes only to logs?

## Cross-references

- LLD: `docs/lld/tui-cli-process/errors.md`
- LLD: `docs/lld/tui-cli-process/observability.md` §Redaction
