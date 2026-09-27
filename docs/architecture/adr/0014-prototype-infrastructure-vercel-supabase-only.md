# ADR-0014: Prototype infrastructure — Vercel + Supabase only until real Tesla

- **Status:** Accepted
- **Date:** 2026-09-26
- **Amends:** ADR-0002 (stack), ADR-0007 (telemetry pipeline), ADR-0010 (jobs), ADR-0011 (realtime)

## Context
FleetOS is at prototype stage with simulated vehicles only; scale doesn't matter yet, cost and setup time do. The always-on container (worker + Tesla telemetry server on Fly) and Redis in ADR-0002/0007 exist for things a prototype doesn't need: permanent vehicle connections, sub-15-second freshness and exact-second timers.

## Decision
Until a real Tesla is connected (Phase 4), run on **Vercel + Supabase + GitHub only**, on free tiers:
- **Tick instead of stream.** Supabase `pg_cron` calls a **tick** endpoint once a minute (via `pg_net` → a secured Vercel route handler or Supabase Edge Function). One tick: advance the simulator, ingest its events, re-derive statuses, run exception rules, sweep due SLA timers, refresh "today" rollups.
- **Timers as a sweep.** SLA deadlines are stored on the ticket (`sla_due_at`); each tick finds overdue ones. pg-boss (ADR-0010) is introduced with the always-on worker.
- **Realtime via Postgres Changes** on `vehicle_state_current` and ops tables; Broadcast batching (ADR-0011) comes with the worker.
- **No Redis, no Fly, no Docker deploy** in this stage.
- **Guardrail:** the tick's logic lives in `packages/*` (`domain`, `providers`, and a `packages/engine` for ingest → status → rules → timers) with no Vercel or Supabase-function specifics, so the same code runs unchanged inside `apps/worker` later.

**Switch to the full ADR-0002/0007/0010/0011 setup when** a real Tesla is connected (Phase 4: telemetry needs a permanent mTLS server), or freshness/timer precision becomes a pilot requirement. At that point add one always-on container (Fly or equivalent, ~$5/month) and a custom domain (Tesla's public key must live on a domain we control).

## Consequences
- $0/month through Phases 2, 3, 5 and 6 (plus Claude API usage).
- Data freshness ≈ 60 s instead of NFR PERF-1's 15 s; SLA breaches detected within ≈ 60 s. NFR PERF-1/PERF-2 and REL-6 apply from Phase 4; until then they're relaxed to 90 s.
- Free-tier limits to watch (verify at setup): Vercel Hobby is for non-commercial use (Pro, $20/member/month, before showing FleetOS to customers as a business); Supabase Free pauses after ~1 week idle and allows 2 active projects.
- The tick endpoint is authenticated with a shared secret and is idempotent (a double tick changes nothing).

## Alternatives rejected
- **Fly worker from day one:** extra account, deploys and cost for no prototype benefit.
- **Vercel Cron:** Hobby cron runs too rarely for a live simulator; `pg_cron` is free and per-minute.
- **Compute simulator state on read (pure function of time):** no stored history for KPIs and timelines.
