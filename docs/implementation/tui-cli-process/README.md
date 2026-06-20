# Implementation Plan - TUI & CLI Process

**Component**: TUI & CLI Process  
**LLD path**: `docs/lld/tui-cli-process/`  
**Output path**: `docs/implementation/tui-cli-process/`  
**Planning mode**: Normal implementation plan, reservation-aware for repo gaps  
**Draft status**: Initial implementation-phase draft  

## Source Baseline

| Source | Path | Status |
| ------ | ---- | ------ |
| LLD entry point | `docs/lld/tui-cli-process/README.md` | Accepted |
| LLD review report | `docs/lld/tui-cli-process/reviews/review-report.md` | Not found |
| HLD baseline | `docs/hld/` | Ready for LLD |
| HLD review report | `docs/hld/review/review-report.md` | Ready for LLD, 0 blockers |
| Current app | `src/index.tsx` | OpenTUI starter only |

This plan treats the accepted LLD as the source of truth. Because no LLD review report exists, implementation can start, but PHASE-001 should include a quick LLD readiness checkpoint before production code begins.

## Phase List

| Phase | Goal | Primary dependency |
| ----- | ---- | ------------------ |
| [PHASE-001 - Foundation, Boot, And Verification](./phases/PHASE-001-foundation-boot-verification.md) | Establish the repo skeleton, validation harness, config boot path, runtime mode parsing, and observability baseline. | None |
| [PHASE-002 - Persistence And Host State](./phases/PHASE-002-persistence-host-state.md) | Add the deploy-safe local state layer: lock file, PID registry, SQLite session store, audit table, and pruning metadata. | PHASE-001 |
| [PHASE-003 - Operator Router And Read-Only Gate](./phases/PHASE-003-operator-router-read-only-gate.md) | Implement command contracts, idempotency, read-only enforcement, and non-mutating operator commands. | PHASE-001, PHASE-002 |
| [PHASE-004 - Server Lifecycle](./phases/PHASE-004-server-lifecycle.md) | Implement `/start`, `/stop`, `/restart`, child process ownership, crash detection, and PID cleanup. | PHASE-002, PHASE-003 |
| [PHASE-005 - Log Ingestion And Hot Reload](./phases/PHASE-005-log-ingestion-hot-reload.md) | Add bounded stdout ingestion, TUI scrollback, hot-reload validation, and pending-restart handling. | PHASE-004 |
| [PHASE-006 - Chat Parser And Authorization](./phases/PHASE-006-chat-parser-authorization.md) | Parse Minecraft chat, enforce player permissions and rate limits, and emit mention/help outcomes. | PHASE-005 |
| [PHASE-007 - Agent Executor And Operator Chat](./phases/PHASE-007-agent-executor-operator-chat.md) | Wire engine-lib providers, agents, sessions, streaming `/chat`, and provider error mapping. | PHASE-002, PHASE-003 |
| [PHASE-008 - In-Game Agent Responses](./phases/PHASE-008-ingame-agent-responses.md) | Connect authorized mentions to agent runs and deliver chunked `/tellraw` responses with fallback. | PHASE-006, PHASE-007 |
| [PHASE-009 - Tool Sandbox Broker](./phases/PHASE-009-tool-sandbox-broker.md) | Register the v1 tool surface and enforce command/file sandbox policies with audit evidence. | PHASE-007, PHASE-008 |
| [PHASE-010 - Release Hardening](./phases/PHASE-010-release-hardening.md) | Complete E2E, performance, cross-platform, runbook, and packaging readiness work. | PHASE-001 through PHASE-009 |

## How To Use This Plan

Start each implementation PR from the matching phase card. Each card lists the LLD files, implementation units, work items, tests, acceptance criteria, and review evidence needed for that PR. Do not implement later-phase behavior inside an earlier phase unless the card explicitly allows it.

Reviewers should use `review-checklist.md` with the phase card and compare changed behavior against the cited LLD sections. `phase-plan.md` contains the full inventory and dependency graph. `traceability.md` maps LLD elements and HLD ADRs to phases.

## Assumptions

- The accepted LLD is authoritative even though an LLD review report is absent.
- Implementation remains forge-first and engine-lib-first per ADR-LLD-001.
- Tests use `bun:test`; current repo scripts are expected to be expanded during PHASE-001.
- Feature delivery is one focused PR per phase unless a phase card names an explicit PR stack.
- No inbound HTTP server is introduced; OpenAPI remains a contract-test artifact.

## Blockers And Open Questions

| ID | Type | Item | Proposed handling |
| -- | ---- | ---- | ----------------- |
| OQ-001 | Review gap | No LLD review report exists under `docs/lld/tui-cli-process/reviews/`. | Run an optional LLD review before or during PHASE-001. Do not block planning because LLD status is Accepted. |
| OQ-002 | Repo gap | `package.json` has only `dev`; no `test`, `check`, `lint`, or build/package scripts. | PHASE-001 adds implementation verification scripts before feature work. |
| OQ-003 | Dependency gap | LLD says YAML parsing uses the `yaml` package, but `package.json` does not list it. | PHASE-001 adds the selected YAML parser or records an LLD revision if a different parser is chosen. |
| OQ-004 | Version gap | LLD stack table says TypeScript 6 strict, while `package.json` currently has `peerDependencies.typescript: ^5`. | PHASE-001 reconciles package metadata with the LLD or opens an LLD correction. |
| OQ-005 | Native gap | ADR-LLD-002 permits either a native addon or `ffi-napi` for Windows Job Objects. | PHASE-004 makes this a review gate before Windows cleanup is marked complete. |

## Package Contents

- `phase-plan.md` - inventory, dependency graph, phase sequence, deployment/rollback, risk register.
- `traceability.md` - LLD, HLD ADR, requirement, and review-finding mapping.
- `review-checklist.md` - per-phase and cross-phase review checklist.
- `phases/` - phase cards with executable work items and verification expectations.
