# F-001: Container name "TUI & CLI Application" diverges from canonical "TUI & CLI Process"

- **Severity**: Minor
- **Dimension**: internal-consistency
- **Lens**: solution-architect
- **Location**: `docs/hld/06-deployment.md` line 20
- **Status**: Resolved

## Finding

`docs/hld/06-deployment.md` line 20 labels the application container node
as:

```
tui_process["**TUI & CLI Application**<br/>(Bun Single-Process)<br/>Host memory budget: 200-500 MB"]
```

Every other HLD file refers to the same runtime container as
**TUI & CLI Process**:

- `docs/hld/02-architecture.md` line 16 (`tui_cli["**TUI & CLI Process**..."`)
- `docs/hld/02-architecture.md` line 54 (`**TUI & CLI Process**` row in Runtime Containers Summary)
- `docs/hld/03-components.md` lines 3, 5, 11 (`TUI & CLI Process`)
- `docs/hld/07-security.md` lines 19–29 (STRIDE table "Affected Container" column consistently reads "TUI & CLI Process")

## Why it matters

LLD authors and reviewers will encounter two names for the same
container across the HLD. Traceability from the deployment diagram back
to the runtime summary, component view, and threat model is harder, and
deployment topology cross-checks (e.g. "do all L2 containers appear in
the deployment diagram?") produce false negatives.

## Recommendation

Use `TUI & CLI Process` (the canonical name from `02-architecture.md`)
in the deployment diagram node label. Update the bracketed label in
`06-deployment.md` line 20 only.

**Auto-fix?** Yes. Unambiguous rename; no meaning change.

## Cross-references

- HLD: `docs/hld/02-architecture.md` (canonical), `docs/hld/03-components.md`, `docs/hld/07-security.md`
