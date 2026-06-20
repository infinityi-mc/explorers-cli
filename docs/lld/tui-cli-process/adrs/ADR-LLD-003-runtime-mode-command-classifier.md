# ADR-LLD-003: Runtime mode command classifier for `--read-only` enforcement

- **Status**: Proposed
- **Date**: 2026-06-19
- **Deciders**: Engineering (LLD pass)
- **Tags**: security, runtime-mode, command-router, read-only
- **Implements HLD ADR(s)**: ADR-008 (Runtime Config and Safe Modes)
- **Supersedes HLD ADR(s)**: none
- **Affects LLD files**: `design.md` (Algorithm 5; Command Router component), `sequences.md` (§8), `errors.md` (`READ_ONLY_BLOCKED`), `openapi.yaml` (read-only blocked response on mutating endpoints), `tests.md` (§Security)

## Context

HLD ADR-008 mandates a centralized runtime mode gateway with three modes:

1. **Normal TUI mode** — full operator control.
2. **Read-only TUI mode** — observer/kiosk mode; mutating operator actions
   denied at the shared command router before reaching downstream
   components.
3. **Validation-only mode** — `--validate-config`; load + validate + exit,
   no TUI / no Java / no DB / no LLM.

The HLD explicitly states: "Read-only mode blocks all operator-originated
mutating actions, including TUI agent chat, direct server stdin commands,
server start/stop/restart commands, and TUI configuration edits. Non-
mutating actions such as navigation, log viewing, `/help`, `/session`
inspection, and viewing validation errors remain allowed."

The HLD leaves the LLD the task of defining **the explicit allow/deny
table** ("The command router LLD must maintain an explicit allow/deny table
for read-only mode and cover it with tests") and the **classification
mechanism**.

The `--validate-config` mode is a terminal bootstrap path (load + validate
+ exit) — it does not need a classifier. The classifier is only for
distinguishing mutating from non-mutating commands in normal vs. read-only
mode.

`forge/config` resolves the CLI flags at boot (via `cliSource` parsing
`--read-only` / `--validate-config`). `forge/lifecycle`'s `boot` runs the
validation-only short-circuit. Neither library provides a "command
classifier" primitive — that's application-specific (what counts as
"mutating" depends on the application's command surface).

## Requirements driving this decision

- `NFR-SEC-009` — `--read-only` mode disables TUI chat (and per ADR-008,
  all other operator mutations).
- `CMD-4`, `CMD-9` — route TUI chat and direct server console input through
  controlled command paths (so the gate has a single enforcement point).
- `NFR-MNT-003` — `--validate-config` exits non-zero on failure (handled
  by the bootstrap short-circuit, not the classifier — but listed for
  context).
- ADR-008's explicit instruction: "The command router LLD must maintain an
  explicit allow/deny table for read-only mode and cover it with tests."

## Options considered

### Option 1: Per-command inline checks

Each command handler checks `runtimeMode` at the top of its function and
returns `READ_ONLY_BLOCKED` if mutating.

**Pros**:
- Simple to implement.

**Cons**:
- No single source of truth — easy to forget a check when adding a new
  command.
- ADR-008 explicitly requires "a shared command classification model".
- Test coverage is per-command, not centralized.

**Satisfies**: partial.
**Tensions**: ADR-008.

### Option 2: Annotation/decorator-based classification

Mark each command handler with a `@mutating` decorator; the router reads
the annotation and rejects if `runtimeMode === 'read-only'`.

**Pros**:
- Single declaration per command.
- Hard to forget (the decorator is visible on the handler).

**Cons**:
- TypeScript decorators are an implementation detail — the LLD avoids
  implementation choices.
- Doesn't handle commands whose mutating-ness depends on args (e.g.
  `/session` is non-mutating but `/clear` is mutating — both deal with
  sessions).

**Satisfies**: most.
**Tensions**: ADR-008 (testability — annotations are harder to enumerate
than a table).

### Option 3: Centralized `MutatingCommandClassifier` table — chosen

Define a single host-owned `MutatingCommandClassifier` with an explicit
table:

```
MUTATING_COMMANDS = {
  'start',          // /start <server>
  'stop',           // /stop <server>
  'restart',        // /restart <server>
  'chat',           // /chat <agent> <message>
  'send-stdin',     // raw stdin to MC server (TUI feature)
  'clear-session',  // /clear
  'config-edit',    // TUI config editor save
}

NON_MUTATING (allowed in read-only):
  'help',                // /help
  'session-list',        // /session
  'session-resume-view', // /resume <id> (read-only op — loads history into TUI)
  'log-view',            // scrollback navigation
  'config-view',         // TUI config viewer (read-only)
  'navigate',            // TUI focus / tab switching
  'quit'                 // Ctrl+C / :q
```

The classifier is invoked by the `CommandRouter` before dispatching to any
handler. If `runtimeMode === 'read-only'` and the command is in
`MUTATING_COMMANDS`, the router returns `READ_ONLY_BLOCKED` without
invoking the handler.

The table is enumerable (a `Set`), so tests can iterate it and assert
each entry is rejected in read-only mode.

**Pros**:
- Single source of truth — ADR-008's explicit requirement.
- Enumerable — easy to test ("for each cmd in MUTATING_COMMANDS, assert
  rejected").
- Survives new command additions (the new command must be added to the
  table or it defaults to non-mutating, which is the safe default for
  observability commands but NOT for mutations — so the LLD also requires
  a lint rule that flags any new command not present in either set).
- The classifier is the only enforcement point — handlers don't need to
  know about runtime mode.

**Cons**:
- A new mutating command that's accidentally omitted from the table would
  be allowed in read-only mode. Mitigation: the lint rule + test that
  asserts every command in the router's dispatch table is in either
  `MUTATING_COMMANDS` or `NON_MUTATING`.

**Satisfies**: `NFR-SEC-009`, `CMD-4`, `CMD-9`, ADR-008.
**Tensions**: none.

## Decision

We adopt **Option 3**. The `MutatingCommandClassifier` is a host-owned
module with:

1. Two enumerable sets: `MUTATING_COMMANDS` and `NON_MUTATING`.
2. A `classify(command, runtimeMode)` function returning
   `{allowed: true} | {allowed: false, reason: 'READ_ONLY_BLOCKED'}`.
3. A test that asserts every command in the `CommandRouter`'s dispatch
   table is in one of the two sets (catches omissions).
4. A test that iterates `MUTATING_COMMANDS` and asserts each is rejected
   in read-only mode.
5. A test that iterates `NON_MUTATING` and asserts each is allowed in
   read-only mode.

The classifier is invoked by the `CommandRouter` (host-owned) before
dispatching to any handler. The handlers are unaware of runtime mode.

`--validate-config` mode is handled separately: `forge/lifecycle`'s `boot`
short-circuits after `forge/config`'s `defineConfig` resolves, before any
component starts. The classifier is not involved.

## Rationale

ADR-008 explicitly requires "a shared command classification model that
distinguishes mutating from non-mutating actions" and "an explicit
allow/deny table for read-only mode". Option 3 is the most direct
implementation of that requirement.

The table is the single source of truth. It's enumerable for testing. It's
easy to review (one screen of code). It survives refactoring (move a
handler, the classification stays).

The default for an unclassified command is **non-mutating** (allowed in
read-only mode). This is the safer default for an interactive terminal
app — an unanticipated observability command should work in kiosk mode.
The lint rule + test catch the dangerous case (a new mutating command
that's accidentally omitted).

## Consequences

**Positive**:
- ADR-008's "explicit allow/deny table" requirement is satisfied by
  construction.
- Single enforcement point — handlers don't repeat the check.
- Enumerable for testing.

**Negative**:
- A new mutating command omitted from the table is silently allowed in
  read-only mode. Mitigated by the lint rule + test.

**Neutral**:
- The `send-stdin` command (raw stdin to MC server) is in
  `MUTATING_COMMANDS` even though it's not a slash-command — it's a TUI
  feature for power users. The classifier covers it because it flows
  through the same `CommandRouter`.

## Mitigations for negative consequences

- **Omitted mutating command** → The test "every command in the dispatch
  table is in `MUTATING_COMMANDS` or `NON_MUTATING`" fails CI if a new
  command is added without classification. The lint rule is a second
  line of defense.
- **Operator confusion** → The TUI help text (`/help`) and startup banner
  list the blocked commands when started in `--read-only` mode. The
  `HelpResponse` in `openapi.yaml` includes a `mutating: boolean` field
  per command so the TUI can render them differently.

## Links

- Implements HLD ADR: ADR-008
- Related LLD ADRs: ADR-LLD-001 (the classifier is host-owned because no
  forge/engine-lib primitive covers it — application-specific command
  surface)
- SRS sections: §3.2 (Operator Command Interface), §4.2 (Commands), §5.4
  (Security — NFR-SEC-009), §5.6 (Maintainability — NFR-MNT-003)
- Affected LLD files: `design.md` (Algorithm 5; Command Router), `sequences.md`
  (§8), `errors.md` (`READ_ONLY_BLOCKED`), `openapi.yaml` (mutating field
  on `HelpResponse`), `tests.md` (§Security)
