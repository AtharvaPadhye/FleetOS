# ADR-0013: Copilot: Claude with RLS-scoped tools and propose-only actions

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Copilot answers questions about the fleet and recommends actions. It must never see or do more than the asking user, and fleet text (vendor notes, alerts) must not be able to steer it.

## Decision
- Claude via the Anthropic API from a server route; model chosen and verified with the `claude-api` skill at build time (default `claude-sonnet-5`).
- Tools wrap `/api/v1` read operations executed with the **user's JWT** (RLS applies).
- Actions are returned as proposals; the UI asks the user to confirm, then calls the normal API.
- Tool results are delimited as data; answers cite the records used; simulated/unavailable data is stated as such.
- Per-org LLM spend cap (NFR OBS-5); evals with golden questions (Phase 6).

## Consequences
- Safe by construction; no separate permission model.
- Latency depends on tool round-trips; answers stream.

## Alternatives rejected
- Giving the model SQL access: unbounded and hard to secure.
- Autonomous actions: unacceptable for vehicle operations.
