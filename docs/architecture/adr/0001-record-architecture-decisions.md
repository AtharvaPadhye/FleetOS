# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Decisions were made in chat and scattered across the roadmap. Future sessions (human or Claude) need the reasoning, not just the outcome.

## Decision
Keep one short ADR per significant decision in `docs/architecture/adr/`, numbered, with Context / Decision / Consequences / Alternatives. The roadmap's decision log links here. A reversed decision gets a new ADR that supersedes the old one; old ADRs are never edited except to mark them superseded.

## Consequences
- Slight overhead per decision.
- Commits and PRs can cite ADR numbers.

## Alternatives rejected
- Decision log table only in the roadmap: loses the reasoning.
- Wiki/Obsidian only: not versioned with the code.
