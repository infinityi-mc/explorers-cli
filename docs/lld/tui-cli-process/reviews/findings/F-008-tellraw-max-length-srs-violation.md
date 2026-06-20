# F-008: `TellrawRequest.text.maxLength: 256` violates SRS FR-INV-009's 200-character chunk limit

- **Severity**: Major
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/openapi.yaml` line 774 (`TellrawRequest.text.maxLength: 256` and description `Chunked by the Agent Executor if the agent's response exceeds 256 chars.`)
  - `docs/lld/tui-cli-process/openapi.yaml` line 775 (`The chat-visible text.`)
- **HLD reference**: `docs/hld/00-requirements.md` row FR-INV-009 ("Split long in-game responses to max 200 characters")
- **SRS reference**: `docs/srs/srs.md` line 357 ("Long in-game responses MUST be split into chunks of at most 200 characters before delivery") and AC-025 ("split at allowed boundaries with 500 ms between chunks" given "response longer than 200 characters")
- **Status**: Resolved

**Resolution**: `TellrawRequest.text.maxLength` is now 200, and Algorithm 6 defines the required chunking behavior.

**Finding**: The OpenAPI `TellrawRequest.text.maxLength` is `256`. The SRS FR-INV-009 mandates chunks MUST NOT exceed 200 characters. AC-025 reinforces: "Given an agent response longer than 200 characters, when delivered in-game, then it is split at allowed boundaries with 500 ms between chunks."

The LLD has chosen to align with the Minecraft client limit (256 chars) rather than the SRS's specification (200 chars). This is a direct, unambiguous MUST-level SRS violation.

Additionally, no chunking pipeline is documented in the LLD (see F-003), so even the 256-char limit is not enforced anywhere — a 1000-char response would be passed to `SrvMgr.sendCommand('survival', 'tellraw @a {...1000 chars...}')` without chunking.

**Why it matters**: An implementation following the LLD produces in-game messages longer than the SRS allows. The Minecraft client may accept them (modern limit is 256), but the spec promises 200-char chunks and AC-025 is a documented acceptance criterion. A QA pass against AC-025 will fail.

**Recommendation**:
1. Change `TellrawRequest.text.maxLength: 256` → `maxLength: 200`.
2. Update the description text to "Chunked by the Agent Executor if the agent's response exceeds 200 chars."
3. Implement the chunking pipeline per F-003.
4. Update `tests.md` §Key scenarios (must-not-break) to include a chunking test with a 250-char agent response that produces 2 chunks (≤200 chars each) with a 500 ms gap.

**Customer/designer question**: The SRS was written before the LLD. If 256 is now preferred (to align with the modern Minecraft client limit), amend FR-INV-009 in the SRS and HLD. If 200 must stand, the LLD must conform. Either way the two must agree before implementation.
