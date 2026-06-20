# ADR-LLD-001: Forge-first / engine-lib-first design rule

- **Status**: Accepted
- **Date**: 2026-06-19
- **Deciders**: Engineering (LLD pass)
- **Tags**: design-rule, infrastructure, dependencies
- **Implements HLD ADR(s)**: All (001, 002, 003, 004, 005, 006, 007, 008)
- **Supersedes HLD ADR(s)**: none
- **Affects LLD files**: `design.md`, `data-model.md`, `observability.md`, `tests.md`

## Context

The HLD's `package.json` already pins `@infinityi/forge ^1.0.1` and
`@infinityi/engine-lib ^2.0.0` as direct dependencies. The HLD's
`03-components.md` decomposes the `TUI & CLI Process` container into 8
internal components (TUI View Engine, Configuration Service, Lock & Lockout
Service, Server Process Manager, Log Reader & Rate Limiter, Chat Parser &
Authorizer, Agent Executor, Tool Sandbox Broker). For each component, the
HLD describes the capability needed but does not pin the implementation
source.

At LLD time, we have a choice for each capability:

1. **Use the forge/engine-lib primitive** that already provides it.
2. **Re-implement** the capability from scratch (or from a third-party
   library).

The HLD ADRs collectively mandate Bun, TypeScript, SQLite WAL, REST+SSE,
sandboxed path containment, structured JSON logs, audit logging, hot-reload
with last-known-good, and read-only mode. forge and engine-lib already
provide production-shaped implementations of every one of these except
child-process lifecycle management (which is intentionally application-
specific).

## Requirements driving this decision

- `C-01` — Execution on the Bun runtime environment.
- All 8 HLD ADRs collectively (each picks forge/engine-lib primitives in
  its rationale).
- `NFR-MNT-001` — Custom tool registration SHOULD be documented (the
  extension surface is `engine-lib`'s `defineTool`; documenting it means
  pointing at the engine-lib contract, not reinventing it).
- `NFR-OBS-001..005` — Observability requirements are all satisfied by
  `forge/telemetry` + `engine-lib/events` + `engine-lib/governance`.

## Options considered

### Option 1: Re-implement each capability from scratch

For each HLD component, write the infrastructure code directly: a custom
YAML config loader, a custom SSE parser, a custom SQLite WAL session store,
a custom token-bucket rate limiter, a custom path canonicalizer, a custom
audit logger, etc.

**Pros**:

- Maximum control over every detail.
- No dependency on the forge/engine-lib release cadence.

**Cons**:

- Massive duplication of effort — forge and engine-lib already ship these
  primitives, tested and documented.
- Higher defect risk — re-implementations don't get the conformance
  batteries that forge/engine-lib ship (`STANDARD_*_SCENARIOS`).
- Slower time-to-v1 — every primitive is a fresh design + impl + test
  cycle.
- Violates the spirit of the HLD, which explicitly chose forge and
  engine-lib as dependencies.
- Makes the LLD much larger — every re-implemented primitive needs its own
  LLD section.

**Satisfies**: none directly.
**Tensions**: `C-01` (Bun-first — forge is Bun-first; re-implementing might
not be), every HLD ADR.

### Option 2: Forge-first / engine-lib-first — import, don't re-implement

For each HLD component, identify the exact forge or engine-lib import that
satisfies the capability. Only write host-owned code where no forge/engine-lib
primitive covers the capability (and document the gap in an LLD ADR).

**Pros**:

- Leverages tested, documented, Bun-first primitives.
- LLD is smaller and more reviewable — the LLD cites the forge/engine-lib
  API, doesn't re-derive it.
- Defect risk is concentrated in the integration glue, not in re-implemented
  primitives.
- Engine-lib's conformance batteries (`runProviderConformance`,
  `runSessionStoreConformance`) become free contract tests for the host.
- HLD ADRs are implemented by construction, not by re-derivation.

**Cons**:

- Tight coupling to forge/engine-lib release cadence — a breaking change in
  either library requires a host update.
- Some host-owned glue is still needed (process lifecycle, PID registry,
  chat regex, OS-specific process cleanup).
- The team must learn the forge/engine-lib API surface (mitigated by the
  GUIDE.md / docs/guide/ in each library).

**Satisfies**: all driving requirements.
**Tensions**: none.

## Decision

We adopt **Option 2: forge-first / engine-lib-first**. The design rule is:

> **For every capability needed by the `TUI & CLI Process` container, the
> LLD MUST first check whether `@infinityi/forge` or `@infinityi/engine-lib`
> already provides it. If yes, import it. If no, write host-owned code AND
> document the gap in an LLD ADR explaining why no library primitive
> covers it.**

The `design.md` "Forge-first / engine-lib-first capability mapping" table is
the canonical reference: for each HLD component, it lists the exact
forge/engine-lib import and the host-owned code (if any).

The host-owned code in v1 is limited to:

1. **`Bun.spawn` + process groups / Windows Job Objects / PID registry**
   (ADR-LLD-002) — no forge/engine-lib primitive covers child-process
   lifecycle.
2. **Chat-line regex pipeline** (Algorithm 1 in `design.md`) — no library
   covers vanilla Minecraft log parsing.
3. **`MutatingCommandClassifier`** (ADR-LLD-003) — the read-only mode gate
   is application-specific.
4. **`explorers.lock` file lock + `data/pids.json` atomic writes** —
   application-specific resources.
5. **`RingBuffer<LogLine>`** for scrollback — trivial enough to inline
   (forge/resilience rate-limit covers the rate limiting half).
6. **YAML source adapter** for `forge/config` — Bun has no built-in YAML
   parser; the `yaml` package is the implementation choice.

Everything else is imported.

## Rationale

The HLD's `package.json` already pins both libraries as direct dependencies.
The HLD's ADRs consistently cite the libraries' capabilities in their
rationales (e.g. ADR-001 says "use the adapters in
`@infinityi/engine-lib/providers`"; ADR-002 says "use Bun's native
`bun:sqlite` bindings"; ADR-007 says "utilizing an opt-in telemetry proxy
that strips player payloads" — which is `engine-lib/governance`
`messageBusSubscriber` with `redaction:"digest"`). Re-implementing these
primitives would contradict the HLD's intent.

The forge/engine-lib API surfaces (documented in `docs/hld/` indirectly via
ADR citations, and fully in each library's GUIDE.md / docs/guide/) cover:

- HTTP client + server + middleware + OpenAPI + RFC 7807 (`forge/http`)
- Resilience pipelines (`forge/resilience`)
- Config + hot-reload + secret redaction (`forge/config`)
- SQLite dialect + pool + transactions + multi-tenant (`forge/data`)
- Messaging + outbox + jobs + DLQ (`forge/messaging`) — not needed in v1
  but available
- JWT/JWKS + AuthZ + audit (`forge/security`) — AuthZ not needed (no
  inbound HTTP); audit is via `engine-lib/governance` instead
- Lifecycle + boot + health + signals (`forge/lifecycle`)
- Telemetry (logs + metrics + traces) + OTLP + Prometheus + redaction
  (`forge/telemetry`)
- LLM providers (OpenAI/Anthropic/Google/compatible) + streaming
  (`engine-lib/providers`)
- Agents + tools + execution loop + multi-agent handoffs (`engine-lib/agent`,
  `engine-lib/tools`, `engine-lib/execution`)
- Sessions + durable stores + compaction (`engine-lib/session`,
  `engine-lib/session-stores`)
- Context window management (`engine-lib/context`)
- Events + telemetry bridge (`engine-lib/events`)
- Approval + authorization + governance + audit (`engine-lib/approval`,
  `engine-lib/authorization`, `engine-lib/governance`)
- Resilience (budgets + retry + circuit breaker + rate limiters)
  (`engine-lib/resilience`)
- Lifecycle adapter (`engine-lib/lifecycle`)
- Tool packs: shell + fs + http + web + sandbox (`engine-lib/tools-*`)
- Testing doubles + conformance batteries (`engine-lib/testing`,
  `engine-lib/testing/conformance`)

The only meaningful capability gaps are child-process lifecycle (host-owned
per ADR-LLD-002), application-specific file locks and PID registries
(host-owned), and the chat-line regex (host-owned, no library covers it).
These gaps are small and well-bounded.

## Consequences

**Positive**:

- The LLD is much smaller than Option 1 would produce — the design narrative
  cites the forge/engine-lib API rather than re-deriving it.
- Implementation can start immediately from the LLD; the team reads the
  forge/engine-lib GUIDE.md for the API details.
- Conformance batteries from engine-lib (`runProviderConformance`,
  `runSessionStoreConformance`) become free contract tests.
- HLD ADRs are implemented by construction.
- Bug fixes in forge/engine-lib propagate to the host by bumping the
  dependency version.

**Negative**:

- Tight coupling to forge/engine-lib release cadence.
- The team must learn both libraries' API surfaces.
- A breaking change in either library requires a host update (mitigated by
  the libraries' stable root barrels and subpath imports — see their
  respective `package.json` `exports` fields).

**Neutral**:

- The host-owned code is concentrated in 6 well-bounded areas (listed in
  the Decision section). Each has its own LLD section or ADR.

## Mitigations for negative consequences

- **Tight coupling** → Pin both libraries with `^` (already done in
  `package.json`). Track upstream releases; bump within 30 days of a new
  minor or patch.
- **Learning curve** → The `design.md` capability mapping table is the
  cheat-sheet. New team members read it first, then drill into the
  relevant forge/engine-lib GUIDE.md section.
- **Breaking changes** → Both libraries use stable root barrels + subpath
  imports with explicit `exports` maps. Breaking changes are signalled by
  major version bumps. CI runs `bun run check` (TypeScript strict) on every
  dependency bump.

## Links

- Implements HLD ADRs: 001, 002, 003, 004, 005, 006, 007, 008
- Related LLD ADRs: ADR-LLD-002 (process lifecycle is the only meaningful
  host-owned gap), ADR-LLD-003, ADR-LLD-004
- SRS sections: §2.5 (Design and Implementation Constraints — C-01 Bun)
- Affected LLD files: `design.md` (capability mapping table), all other
  files (every file cites forge/engine-lib imports)
