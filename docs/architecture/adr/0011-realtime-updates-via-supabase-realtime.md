# ADR-0011: Realtime updates via Supabase Realtime

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Screens must reflect telemetry within 15 s p95 (NFR PERF-1) and show new exceptions and ticket changes live.

## Decision
- High-volume vehicle state: the worker publishes **Broadcast** messages on private per-org channels (`org:{org_id}:vehicles`) after each upsert, batched per second.
- Low-volume tables (exceptions, tickets, ticket events, notifications): **Postgres Changes** with RLS.
- Channel access uses Realtime authorization tied to memberships (verify configuration in task 2.3).
- Clients re-fetch via TanStack Query on reconnect to cover gaps.

## Consequences
- No self-hosted websocket server.
- Broadcast payloads are the normalised snapshot delta, not raw telemetry.

## Alternatives rejected
- Postgres Changes for telemetry: too much write amplification.
- SSE from Next.js route handlers: serverless timeouts on Vercel.

## Prototype note (ADR-0014)
Until Phase 4, this decision is implemented in a simplified form: a once-a-minute `pg_cron` tick replaces the always-on worker. See ADR-0014.
