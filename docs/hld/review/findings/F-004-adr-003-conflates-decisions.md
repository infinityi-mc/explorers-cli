# F-004: ADR-003 "Options considered" only compares spawn libraries but the Decision commits to specific cleanup strategies

- **Severity**: Minor
- **Dimension**: adr-quality
- **Lens**: solution-architect
- **Location**: `docs/hld/adrs/ADR-003-process-management-bun-spawn.md` lines 33–79
- **Status**: Resolved

## Finding

ADR-003's `## Options considered` section compares two options:

- **Option 1**: Standard Node.js `child_process` (spawn / spawnSync)
- **Option 2**: Native Bun Process Spawning (`Bun.spawn`)

Both options are framed purely around the **spawning** library choice.
However, the `## Decision` section (lines 63–78) commits to four
distinct cleanup strategies that were not analyzed in the Options
section:

1. Spawn with `detached: true` (POSIX process groups) and kill via negative PID
2. Spawn under a Job Object (Windows) with cleanup-on-close semantics
3. Use `taskkill /T /F /PID <pid>` only as a fallback
4. Record PIDs in `data/pids.json` immediately on spawn

The Mitigations section re-affirms these strategies but does not explain
why the alternatives (e.g. tree-kill libraries, Node-ffi job handle
APIs, or pure `taskkill` without Job Objects) were rejected.

## Why it matters

ADR-003 is the only HLD artifact that records _why_ the cleanup model
is what it is. NFR-REL-001 (process cleanup) and AC-005 (force-kill on
shutdown timeout) depend on this design being correct on both Windows
and Linux. LLD authors need to understand the alternatives that were
considered (e.g. why not `tree-kill` everywhere? why not pure
`taskkill`?) so they can defend the design in code review and avoid
re-introducing the alternatives later.

The "nfr-matrix" completeness lens also indirectly depends on this:
`NFR-REL-001` is mapped to `ADR-003`, but if the ADR only justifies the
spawn library and not the cleanup strategy, the matrix is overstating
coverage.

## Recommendation

Restructure the Options section to compare two orthogonal decisions,
or add explicit sub-options for the cleanup model.

Recommended structure (proposal):

```
## Options considered

### Decision A: Process spawning library

#### Option 1: Node `child_process`
...
#### Option 2: Bun `Bun.spawn`  ← chosen
...

### Decision B: Process cleanup mechanism

#### Option 1: Process groups + Job Objects + taskkill fallback  ← chosen
- Pros: native OS handles cleanup; survives parent crash; taskkill
  covers stale PIDs from prior crashes
- Cons: platform-specific implementation paths
#### Option 2: Pure `taskkill` on Windows, `kill -9 -pid` on POSIX
- Pros: simple, no Job Object lifecycle management
- Cons: does not survive a parent crash on POSIX; child processes can
  leak on manager SIGKILL
#### Option 3: tree-kill npm library on both platforms
- Pros: portable single implementation
- Cons: requires PID tree walks; not guaranteed under crash; does not
  bind child lifetime to parent lifetime
```

Then a single `## Decision` section can state both choices.

## Cross-references

- HLD: `docs/hld/adrs/ADR-003-process-management-bun-spawn.md`
- SRS: `NFR-REL-001`, `NFR-COMP-001`, `FR-SRV-013`, `AC-005`
- Matrix entry: `docs/hld/08-nfr-traceability.md` line 24 (NFR-REL-001 → ADR-003)
