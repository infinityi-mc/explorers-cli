# F-002: Idempotency-Key header declared in OpenAPI but unused — cache key is a different hash

- **Severity**: Major
- **Dimension**: internal-consistency
- **Lens**: backend-architect
- **Location**:
  - `docs/lld/tui-cli-process/openapi.yaml` lines 526–538 (`components.parameters.IdempotencyKey`)
  - `docs/lld/tui-cli-process/idempotency.md` lines 27–29 (`Storage: in-process Map<hash, {response, expiresAt}>. The hash is sha256(command + ':' + serverId + ':' + argsJson).`)
  - `docs/lld/tui-cli-process/idempotency.md` lines 23–25 (`Header: Idempotency-Key: <uuid> (optional on all mutating operator commands; ignored on agent tools).`)
- **HLD reference**: N/A — this is an LLD-level contract invention
- **SRS reference**: N/A — idempotency is LLD-implemented
- **Status**: Resolved

**Resolution**: The LLD now uses the `Idempotency-Key` header value as the operator-command cache key, with the previous hash as a defensive non-TUI fallback. `idempotency.md` and `openapi.yaml` were updated.

**Finding**: The OpenAPI spec defines a reusable `IdempotencyKey` header parameter and applies it to `/operator/start`, `/operator/stop`, `/operator/restart`, `/operator/chat`, and `/operator/clear` (six operations). The `idempotency.md` design, however, derives the dedup cache key from `sha256(command + ':' + serverId + ':' + argsJson)` — the `Idempotency-Key` header value is never read as part of the cache lookup. The header is described as "optional" and "ignored on agent tools", but for operator commands the design says "the TUI generates one automatically when the operator presses Enter" — that generated key is then thrown away, because the cache key is the hash.

This is a dead contract: the OpenAPI parameter advertises idempotency semantics that the implementation does not provide.

**Why it matters**: Contract tests will pass (the header is accepted), but actual idempotency behaves differently from what the OpenAPI description promises. A double-tap on `/start survival foo=1` and `/start survival foo=2` (different args) produces two cache entries (different hashes) but the same `Idempotency-Key` would be expected to produce a single response per the header's description. Worse, the spec implies that two clients sending the same `Idempotency-Key` would get the same cached response — but the cache key is the hash, so this guarantee does not hold.

**Recommendation**: Pick one and align both docs:

1. **Use the header as the cache key** — change `idempotency.md` to key by `Idempotency-Key` (with hash as fallback when absent). This is the standard REST pattern.
2. **Drop the header from OpenAPI** — remove the parameter from the five mutating operations, and remove the description text. Document the hash-based dedup as the actual mechanism.

Option 1 is more interoperable with future clients (e.g. a web dashboard in v2); Option 2 is simpler and matches what the LLD actually designs.

**Customer/designer question**: For a local interactive TUI, idempotency exists to catch double-Enter. Do you want the operator's TUI to send a fresh UUID per press (current design — hash key) or to allow future clients (e.g. automation scripts) to supply their own `Idempotency-Key` (REST-style)? The current LLD design is internally inconsistent — it advertises one and delivers the other.
