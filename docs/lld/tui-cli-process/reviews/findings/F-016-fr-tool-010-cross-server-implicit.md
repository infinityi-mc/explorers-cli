# F-016: FR-TOOL-010 cross-server filesystem isolation is implicit in `allowedRoots: [server.path]` but not explicitly stated

- **Severity**: Minor
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/design.md` line 43 (Tool Sandbox Broker row: `engine-lib/tools-fs` → `filesystemTools({allowedRoots:[server.path]})`)
  - `docs/lld/tui-cli-process/traceability.md` row FR-TOOL-008 (Sandbox to `server.path`) — addressed
  - `docs/lld/tui-cli-process/traceability.md` (FR-TOOL-010 NOT in the table)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-TOOL-010 ("Block cross-server folder traversal by agent tools")
- **SRS reference**: `docs/srs/srs.md` line 392 ("Cross-server filesystem access by agent tools MUST NOT be allowed")
- **Status**: Resolved

**Resolution**: FR-TOOL-010 is now explicit in traceability and the security test scenarios.

**Finding**: FR-TOOL-010 mandates that agent tools MUST NOT access another server's `server.path`. The LLD's `design.md` configures `filesystemTools({allowedRoots:[server.path]})` per-server — which structurally prevents cross-server access because each server's filesystem tool only sees its own path. But:
- `traceability.md` does not include FR-TOOL-010.
- No sequence diagram or test scenario explicitly demonstrates cross-server blocking.
- The HLD's STRIDE threat model treats cross-server access as a real threat; the LLD should call out the per-server `allowedRoots` isolation as the explicit mitigation.

**Why it matters**: Without an explicit traceability entry, an implementer who refactors the tool setup (e.g. consolidates `allowedRoots` across servers for performance) could silently regress FR-TOOL-010. Without a test scenario, a regression wouldn't be caught.

**Recommendation**:
1. Add FR-TOOL-010 row to `traceability.md` pointing to `design.md` Tool Sandbox Broker row and explaining "engine-lib/tools-fs's `allowedRoots` is bound per server, so cross-server access is structurally prevented."
2. Add a test scenario to `tests.md` §Security: "Agent `read_file` with path `<server_A.path>/file.txt` while invoked from server B's context → `PATH_TRAVERSAL_BLOCKED`."
3. Mention FR-TOOL-010 explicitly in ADR-LLD-001 (forge-first rule) under "Tool Sandbox Broker" — confirm engine-lib's `allowedRoots` per-tool binding is the mechanism.

**Customer/designer question**: N/A.
