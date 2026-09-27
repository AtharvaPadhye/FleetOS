# ADR-0002: Stack: Next.js on Vercel + Supabase + worker on Fly.io

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
FleetOS needs a web app, Postgres with row-level security, auth, realtime updates, file storage, and always-on processes (Tesla Fleet Telemetry server, ingestion, timers). The team is small and pre-revenue; the pilot is ~84–1,000 vehicles.

## Decision
- **Web:** Next.js (App Router, TypeScript strict, Tailwind, shadcn/ui) on Vercel.
- **Data/platform:** Supabase — Postgres 15+ with PostGIS, Auth, Realtime, Storage, Vault.
- **Always-on:** one Docker image `apps/worker` (Node/TS) plus the `tesla/fleet-telemetry` server, both on Fly.io, with a small Redis (Upstash or Fly) between them.
- **LLM:** Claude API for Copilot.
- **Guardrails** so a later AWS move is a migration, not a rewrite: business logic in framework-agnostic `packages/*`; plain SQL migrations; the worker is a container; no Supabase-only features where a portable option is equally good.

## Consequences
- Days to first feature, ~$50–150/month platform cost at pilot.
- Time-series volume is the first thing to outgrow (see ADR-0009).
- Move-to-AWS triggers: > 1–2k streaming vehicles, a customer requiring VPC/KMS, or production command access from Tesla.

## Alternatives rejected
- **AWS (ECS, RDS + Timescale, Redis, Redpanda, KMS):** 2–3× setup, $250–600/month floor, idle at pilot scale.
- **Keep the vanilla-JS prototype:** innerHTML templates don't scale to 12 data-driven screens.
- **Vite SPA instead of Next.js:** viable; Next.js chosen for route handlers + server-side auth in one deployable.
