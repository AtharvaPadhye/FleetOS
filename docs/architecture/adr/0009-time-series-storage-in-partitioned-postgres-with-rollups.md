# ADR-0009: Time-series storage in partitioned Postgres with rollups

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Telemetry volume: ~20 fields per vehicle at 10–300 s intervals. TimescaleDB availability on current Supabase Postgres versions is uncertain (verify in task 2.3).

## Decision
- `telemetry_samples` is a native Postgres table **range-partitioned by day** (partitions created ahead by a worker job, dropped after 30 days, NFR RET).
- Rollups: 1-minute (13 months) and hourly/daily (forever) tables maintained by the worker; KPI views read rollups, not raw samples.
- `vehicle_state_current` (one row per vehicle) serves live screens.
- If TimescaleDB is available on our Supabase version, it may replace hand-rolled partitioning without API changes.

## Consequences
- Portable to any Postgres (AWS RDS included).
- We own partition maintenance; covered by a job + alert.

## Alternatives rejected
- TimescaleDB: great fit but availability uncertain.
- External TSDB (Influx, ClickHouse): another system to run.
