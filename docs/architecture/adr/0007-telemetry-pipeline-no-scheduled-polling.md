# ADR-0007: Telemetry pipeline: Fleet Telemetry → Redis → worker; no scheduled polling

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Tesla bills per request; polling `vehicle_data` every minute costs ~$72 per car per month and wakes cars, while Fleet Telemetry streaming costs ~$4. Telemetry configs must be signed through the vehicle-command proxy and need the virtual key.

## Decision
- Self-host `tesla/fleet-telemetry` on Fly (mTLS WebSocket) with the **Redis Pub/Sub** dispatcher; `apps/worker` subscribes, normalises, deduplicates (vehicle, field, event time), upserts `vehicle_state_current`, appends `telemetry_samples`, derives status events, and broadcasts to Supabase Realtime.
- The simulator publishes the same normalised events through the same path.
- `tesla-http-proxy` runs inside the worker from Phase 4 (signing telemetry configs; commands only from Phase 7).
- `vehicle_data` is used only for backfill after reconnects or explicit user requests; never on a schedule, never waking a car.

## Consequences
- One ingestion path for simulator and Tesla.
- Redis Pub/Sub is fire-and-forget: the worker must be up; acceptable at pilot (Tesla vehicles resend with `delivery_policy`), revisit with Kafka/Redis Streams on AWS.

## Alternatives rejected
- Kafka: operationally heavy for pilot scale.
- Polling: 18× the cost and battery drain.

## Prototype note (ADR-0014)
Until Phase 4, this decision is implemented in a simplified form: a once-a-minute `pg_cron` tick replaces the always-on worker. See ADR-0014.
