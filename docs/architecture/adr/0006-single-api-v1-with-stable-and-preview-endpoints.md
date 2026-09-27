# ADR-0006: Single /api/v1 with stable and preview endpoints

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
Some data (rides, earnings, cabin events, autonomy events, dispatch, charger telemetry, live tariffs, vendor tracking) has no real source yet but screens need it. An earlier idea of `/v1` = available and `/v2` = future was rejected: versions should mean breaking changes.

## Decision
- One `/api/v1`. Each operation is tagged `x-fleetos-stability: stable | preview` (OpenAPI + response header).
- Preview operations: simulated data in demo orgs (`x-fleetos-data-source: simulated`), `501 {"error":"capability_unavailable","capability":…}` otherwise — **never `200` with empty data**.
- A preview endpoint becomes stable once, when its real source is connected; the URL doesn't change.
- `GET /api/v1/capabilities` returns `live | simulated | unavailable` per capability and drives UI badges.
- `/api/v2` is reserved for breaking changes to stable endpoints.

## Consequences
- Clients use one base URL; the UI can't mistake "not connected" for zero.
- Preview schemas may change without a version bump; clients must honour the stability tag.

## Alternatives rejected
- `/v1` available + `/v2` future: would force a messy `/v3` for real breaking changes (superseded same day).
- Empty `200` placeholders: indistinguishable from real zeros.
