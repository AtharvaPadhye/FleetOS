# ADR-0010: Background jobs and timers with pg-boss

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
SLA countdowns, escalations, rollups, partition maintenance, report generation and forecasts need durable scheduling that survives restarts (NFR REL-6).

## Decision
- Use **pg-boss** (Postgres-backed job queue) in `apps/worker`: delayed jobs for SLA timers, cron for rollups/partitions/reports, retries with backoff.
- Jobs are idempotent and keyed (e.g. `sla-breach:{ticket_id}`) so reschedules replace rather than duplicate.

## Consequences
- No extra infrastructure; timers live in the same database as the data they act on.
- Portable off Supabase.

## Alternatives rejected
- BullMQ on Redis: Redis is fire-and-forget in our setup (ADR-0007) and adds persistence concerns.
- Supabase pg_cron + pgmq: workable but Supabase-specific.
- Vercel cron: not durable per-ticket timers.
