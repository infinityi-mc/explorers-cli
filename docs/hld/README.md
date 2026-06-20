# Minecraft Server Manager TUI — High-Level Design (HLD)

This directory contains the High-Level Design for `explorers-cli` (codename Minecraft Server Manager TUI) v1.0. This system enables operators to manage up to 10 local Minecraft Java Edition servers, monitor logs, and orchestrate an LLM-backed agent ecosystem that interacts directly with in-game chat players.

## How to Review This HLD

First-time reviewers should read the documents in the following order:

1. `00-requirements.md` — Extracted functional and non-functional requirements.
2. `01-context.md` — System context (C4 Level 1) showing system boundaries.
3. `02-architecture.md` — Container view (C4 Level 2) and core communication design.
4. `08-nfr-traceability.md` — Verification mapping of architectural decisions to requirements.
5. `adrs/` — Architectural Decision Records explaining the choices and trade-offs.
6. `03-components.md` through `07-security.md` — Deep dives into internal components, data models, APIs, deployment, and STRIDE security threats.

## File Directory

- **`00-requirements.md`**: Baseline of FRs, NFRs, constraints, and assumptions.
- **`01-context.md`**: C4 Level 1 System Context diagram and narrative.
- **`02-architecture.md`**: C4 Level 2 Container diagram outlining runtime services.
- **`03-components.md`**: C4 Level 3 component breakdown of key runtime containers.
- **`04-data-model.md`**: Conceptual ER diagram and domain entities.
- **`05-api-surface.md`**: API models, authorization structures, and resources.
- **`06-deployment.md`**: Deployment topology across production/staging environments.
- **`07-security.md`**: STRIDE threat model, trust boundaries, and mitigations.
- **`08-nfr-traceability.md`**: NFR cross-cutting traceability matrix.
- **`adrs/`**: Index of MADR-style architectural decisions (API style, persistence, process management, configuration/runtime modes).

## Status & Ownership

- **Author**: Technical Lead
- **Status**: Ready for LLD
- **Last Updated**: 2026-06-19
- **Review verdict**: Ready for LLD
- **Out of Scope**: Low-level design (class specs, JSON schemas), implementation timelines, and server operations runbooks.
