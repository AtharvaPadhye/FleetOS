# ADR-0012: Mark every substitute data source in code

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Much data will come from stand-ins (simulator, CSV, manual entry, inference, static tables, fixtures) until real sources exist. Akshat wants every one findable in code for later replacement.

## Decision
- A `SUBSTITUTE(<capability>, <kind>)` comment with `Real source`, `Replace by` and `Docs` lines sits above each substitute seam (format in `CLAUDE.md`).
- `pnpm substitutes` inventories markers and fails CI on malformed ones; capability names must exist in the capability registry.

## Consequences
- A complete, greppable replacement backlog that can't drift from code.

## Alternatives rejected
- Tracking substitutes only in docs: drifts.
