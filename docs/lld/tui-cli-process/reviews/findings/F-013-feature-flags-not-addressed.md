# F-013: Feature flags (FR-FLG-001..003) not addressed in the LLD

- **Severity**: Minor
- **Dimension**: requirements-traceability
- **Lens**: traceability-auditor
- **Location**:
  - `docs/lld/tui-cli-process/data-model.md` line 265 (`RuntimeConfig.featureFlags: { ... }` — described but no specific flags documented)
  - `docs/lld/tui-cli-process/traceability.md` (FR-FLG-* not in the FR traceability table)
- **HLD reference**: `docs/hld/00-requirements.md` rows FR-FLG-001..003
- **SRS reference**: `docs/srs/srs.md` lines 309–311 (FR-FLG-001: support feature flags to enable/disable subsystems; FR-FLG-002: `audioplayer` flag defaults to `false`; FR-FLG-003: hide music UI when disabled)
- **Status**: Resolved

**Resolution**: `RuntimeConfig.featureFlags.audioplayer` is documented with default `false`, and FR-FLG-001..003 are traced.

**Finding**: The SRS defines three feature-flag requirements:
- **FR-FLG-001** (Should): Support feature flags in `config.yaml`.
- **FR-FLG-002** (Should): `audioplayer` defaults to `false`.
- **FR-FLG-003** (Should): Hide music UI when `audioplayer` is disabled.

The LLD's `data-model.md` line 265 lists `featureFlags: { ... }` as a `RuntimeConfig` field with the comment `FR-DEF-001 deferred features` — but doesn't enumerate any specific flag. The LLD's `README.md` "Out of scope" section defers "Music / audio search feature (FR-DEF-001, NFR-COMP-007 — Won't-have v1)".

These are conflicting signals:
- The SRS `audioplayer` flag is required (Should-level) and is the principal FR-FLG use case.
- The LLD treats music as Won't-have for v1 and therefore doesn't define the `audioplayer` flag.

Even if music is Won't-have, `featureFlags.audioplayer = false` (the default per FR-FLG-002) is a valid configuration that should be representable. The LLD's config schema must accept this flag and route the hide-music-UI behavior through it, even if all music UI code is gated to never appear in v1.

**Why it matters**: An operator reading `config.yaml.example` and uncommenting `featureFlags: { audioplayer: true }` should get a deterministic "music UI hidden" behavior (per FR-FLG-003). The LLD currently makes that contract unreachable — the schema field exists but no behavior is wired.

**Recommendation**:
1. Add `featureFlags: { audioplayer?: boolean }` to the documented `RuntimeConfig` shape in `data-model.md` with default `false`.
2. Note in `design.md` or `errors.md`: "When `featureFlags.audioplayer === true` and any music-related UI/command is requested, return `FEATURE_DISABLED` error (or simply do not render the UI in the TUI per FR-FLG-003)." Since the feature is Won't-have in v1, the safest implementation is: render the music UI iff `audioplayer === true`, and otherwise omit.
3. Add FR-FLG-001..003 rows to `traceability.md`.

**Customer/designer question**: Even if the audioplayer feature is Won't-have for v1, the `featureFlags` schema field must exist so v1 config files don't fail validation when operators include `audioplayer: false`. Is the intent to ship v1 with the flag defined-but-unused, or to remove the flag entirely from the v1 schema?
