# F-006: suggested-revisions.md F-004 diff is stale relative to current ADR-003

- **Severity**: Minor
- **Dimension**: internal-consistency
- **Lens**: solution-architect
- **Location**: `docs/hld/suggested-revisions.md` lines 51–64
- **Status**: Resolved

## Finding

`docs/hld/suggested-revisions.md` lines 51–64 propose a Windows-cleanup
edit to `docs/hld/adrs/ADR-003-process-management-bun-spawn.md`. The
diff's "current" state shows:

```
-2. Spawning child processes on Windows using nested execution contexts or tracking processes inside Job Objects.
```

The actual current ADR-003 file (line 75 of
`docs/hld/adrs/ADR-003-process-management-bun-spawn.md`) already reads:

```
2. Spawn child processes on Windows under a Job Object owned by the manager process. The Job Object is the primary cleanup mechanism and must be configured to terminate member processes when the manager exits or crashes.
```

(Subtle wording difference aside, the substantive position — Job Object
as the primary Windows cleanup mechanism — is the same as what the diff
proposes.) The diff's "current" line was the state of the ADR at some
earlier point; the ADR has since been edited, but the proposed diff
remains in `suggested-revisions.md` as if it were still outstanding.

## Why it matters

`suggested-revisions.md` is an active review artifact. An architect or
LLD author picking up the review may try to apply a diff that has
already been applied (or partially applied) to the HLD, producing a
merge conflict or no-op edit. The artifact also signals to reviewers
that work is outstanding when none is.

## Recommendation

Either:

1. Delete the F-004 block from `suggested-revisions.md` (the ADR is
   already in the desired state). Then re-verify F-004 against the
   current ADR-003 text — if the remaining work is the broader
   Options-section restructure (see finding F-004), restate that as a
   fresh diff against the current ADR.

2. Update the diff's "current" lines to match the current ADR-003 file
   and re-issue the proposal.

Option 1 is preferred: the wording is already where the original F-004
wanted it.

**Auto-fix?** Yes — deleting the stale diff is a single-block edit and
unambiguous.

## Cross-references

- HLD: `docs/hld/suggested-revisions.md` lines 51–64
- HLD: `docs/hld/adrs/ADR-003-process-management-bun-spawn.md` line 75 (current state)
