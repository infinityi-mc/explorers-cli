# PHASE-009 - Tool Sandbox Broker

**Status**: Planned  
**Goal**: Register the v1 agent tools and enforce command/file sandbox policies with contract and audit evidence.  
**Depends on**: PHASE-007, PHASE-008  
**LLD sources**: `design.md` Tool Sandbox Broker mapping; `api.md` Agent tools; `openapi.yaml` `/agent-tools/*`; `sequences.md` section 6; `errors.md` tool codes; `observability.md` `tool_blocked`; ADR-LLD-001; `tests.md` Security scenarios  
**Review findings addressed**: None

## Scope

- Register `run_command`, `read_file`, and `write_file` tool schemas through engine-lib tool packs.
- Configure `tools-shell` with per-agent token-prefix command allowlists and server-state checks.
- Configure `tools-fs` with per-server `allowedRoots`, symlink containment, and running-server NBT deny rules.
- Compose governance policies and role/tool authorization.
- Audit tool success, blocked, and failed outcomes with redacted target and argument digests.
- Add tool contract tests and security negative tests.

## Out Of Scope

- Custom plugin SDK or third-party tool packs; deferred by LLD.
- Additional filesystem tools beyond the v1 advertised surface unless engine-lib registers them internally without exposing them to the v1 contract.
- Manual human approval workflows unless required by engine-lib defaults; not in the v1 LLD surface.

## Implementation Units

| Unit ID | Type          | Summary                                                                                                   | Source                              | Risk   |
| ------- | ------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------ |
| IU-031  | security      | Register shell/fs tools with per-server roots, command allowlists, NBT deny rules, and server-state gate. | `design.md` Tool Sandbox Broker row | High   |
| IU-032  | contract      | Validate `run_command`, `read_file`, and `write_file` schemas and ToolResult contract.                    | `openapi.yaml` AgentTools           | Medium |
| IU-033  | observability | Audit tool success, blocked, and failed outcomes with redacted targets and argument digests.              | `data-model.md` `audit_entries`     | Medium |
| IU-034  | test          | Cover tool sandbox security cases.                                                                        | `tests.md` Security scenarios       | High   |

## Work Items

1. Create a per-server/per-agent tool factory that consumes current config and Server Process Manager state.
2. Register `run_command` through `engine-lib/tools-shell` with exact token-prefix allowlist semantics.
3. Return `OFFLINE_FAIL` for command execution when the target server is not RUNNING.
4. Register `read_file` and `write_file` through `engine-lib/tools-fs` with `allowedRoots:[server.path]`.
5. Enforce symlink escape and cross-server path denial through engine-lib filesystem policies.
6. Add custom deny rule for `.nbt`, `.dat`, `.mca`, and `.schem` writes while server is RUNNING.
7. Compose shell and filesystem policies through engine-lib governance.
8. Attach tools to agent definitions and ensure provider-advertised schemas match `openapi.yaml`.
9. Return recoverable ToolFailure for domain denials and throw only for unexpected implementation faults.
10. Emit audit entries for `command_exec`, `file_read`, and `file_write` with redacted target and `argumentsDigest`.
11. Add tests for allowlist success, `op Steve` denial, path traversal, symlink escape, cross-server access, running NBT write, and offline command.

## Data And Deployment Notes

- Tool denials must fail closed and should not mutate filesystem or server stdin.
- Audit rows are append-only and retained indefinitely.
- Rollback removes tool registration from agent definitions; agent chat still works without tools.

## Tests And Verification

- Unit tests: command tokenizer/prefix matching, NBT deny list, ToolResult mapping.
- Integration tests: real temp filesystem sandbox, stub server stdin for allowed `run_command`, symlink and cross-root denial, offline failure.
- Contract tests: tool argument schemas and ToolResult validate against OpenAPI.
- End-to-end or smoke tests: agent tries blocked command then allowed command using mock provider tool-call script.
- Manual checks: audit rows for blocked and allowed tool calls include digests and no secrets.
- Commands: `bun test`; `bun run check`.

## Observability And Operations

- Metrics: agent tool calls total by agent/tool/outcome and tool duration.
- Logs: `tool_blocked` fields from `observability.md` with redaction.
- Audit: `command_exec`, `file_read`, `file_write` action types with `ok`, `blocked`, and `failed` outcomes.

## Acceptance Criteria

- `run_command` executes only when server is RUNNING and command matches the agent allowlist.
- `read_file` and `write_file` cannot escape `server.path`, including symlink and cross-server cases.
- NBT-sensitive writes are blocked while the server is RUNNING.
- Tool domain failures are returned to the model as recoverable ToolFailure.
- Contract and security tests cover all LLD tool error branches.

## Review Packet

- Expected files or modules touched: tool factory, policy composition, agent definition wiring, audit mapping, tests.
- LLD sections reviewers should compare against: `design.md` Tool Sandbox Broker row, `sequences.md` section 6, `openapi.yaml` AgentTools, `errors.md` tool rows.
- Expected evidence: security negative test output, contract validation output, audit sample, tool-call E2E output.

## Risks And Questions

- Confirm whether engine-lib registers additional filesystem tools by default. If yes, ensure only the v1 advertised surface is exposed to agents unless the LLD is revised.
