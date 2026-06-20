# F-002: STRIDE "Top 3 Residual Risks" heading but the section lists 4 risks

- **Severity**: Minor
- **Dimension**: threat-model
- **Lens**: security
- **Location**: `docs/hld/07-security.md` line 33 heading; lines 35–42 list
- **Status**: Resolved

## Finding

`docs/hld/07-security.md` line 33 reads:

```
## Top 3 Residual Risks
```

Lines 35 through 42 then enumerate four risks:

1. Minecraft Offline Mode Vulnerability (Spoofing)
2. Plain-Text File Overwriting (Tampering)
3. LLM Hallucination of Commands
4. Shared Terminal Misuse

The heading promises three, the body delivers four.

## Why it matters

The "Top 3 Residual Risks" callout is a deliberate reviewer-facing
highlight. LLD authors and security reviewers will look here for the
most consequential unresolved risks; an inconsistent count dilutes that
signal. Stakeholders may also infer that only the first three were
deliberately ranked, leaving the fourth unranked.

## Recommendation

Either rename the heading to `## Top Residual Risks` (matches the actual
content and preserves the prioritization signal) or reduce the list to
three risks by merging the LLM hallucination and shared-terminal misuse
items into a single "operator configuration hygiene" entry.

**Auto-fix?** Yes if the rename is preferred (single-token change,
unambiguous); reducing the list to three risks requires authoring judgment and is a propose-level change.

## Cross-references

- HLD: `docs/hld/07-security.md`
- Existing tracking: `docs/hld/suggested-revisions.md` line 67 ("Minor Safe Fix Available F-003")
