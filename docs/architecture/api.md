# FleetOS — API Contract

> Roadmap task 1.3 · 2026-09-26. Machine-readable contract: [`openapi.yaml`](openapi.yaml) (OpenAPI 3.1), **the source of truth**. Since task 3.8 every implemented operation is registered in `apps/web/src/lib/api/operations.ts` with zod request/response schemas; `apps/web/src/lib/api/contract.test.ts` converts them to JSON Schema and fails CI if they send anything the spec doesn't allow (undocumented fields, types, formats, nulls, enum values) or if a route handler isn't registered. Handlers also validate every response against its schema at runtime. This file keeps the conventions.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base | `https://<app-domain>/api/v1` (route handlers in `apps/web`) |
| Auth | Supabase session cookie (browser) or `Authorization: Bearer <user JWT>`. The org is the user's **active org**, sent as `X-FleetOS-Org: <org_id>` and checked against memberships. It's never an authorisation input on its own (NFR TEN-2). Unknown or foreign org → `404`. |
| Stability | Every operation has `x-fleetos-stability: stable \| preview` in the spec and the same response header (ADR-0006). |
| Data source | Responses built from substitutes carry `X-FleetOS-Data-Source: simulated \| csv \| inferred \| static \| manual \| mixed`. Stable endpoints that aggregate substitute data (e.g. revenue from CSV) set it too. |
| Preview, no source | `501` + `{"error":"capability_unavailable","capability":"rides","message":"…","docs":"…"}`. **Never** `200` with empty data. |
| Errors | `application/problem+json`-style body: `{"error": "<code>", "message": "…", "details": [...]?, "request_id": "…"}`. Codes: `invalid_request` 400, `unauthenticated` 401, `forbidden` 403, `not_found` 404, `conflict` 409, `validation_failed` 422, `rate_limited` 429, `capability_unavailable` 501, `upstream_unavailable` 502/503, `internal` 500. |
| Pagination | Cursor-based: `?limit=25&cursor=<opaque>` → `{"data":[…],"page":{"next_cursor":…,"total":N}}`. `total` is exact up to 10k, then estimated. Max `limit` 200. |
| Filtering & sorting | Explicit query params per resource (no generic query language); `sort=field` / `sort=-field`. |
| Money & units | Integers in cents (`*_cents`) plus the org `currency`; SI units (`*_m`, `*_kw`, `*_c`). Clients format. |
| Time | RFC 3339 UTC; period params `from`/`to` (half-open) or `period=today\|mtd\|last_30d\|month:2026-08`. |
| Writes | `POST` creates, `PATCH` partial update. Mutating requests accept `Idempotency-Key` (24 h replay window). Actions are sub-resources (`POST /tickets/{id}/actions/return-to-service`), not status PATCHes. |
| Concurrency | Mutable resources return `ETag`; `PATCH` honours `If-Match` → `409` on conflict. |
| Rate limits | `RateLimit-Limit/Remaining/Reset` headers; 600 req/min per user, 60 writes/min (NFR SEC-7). |
| Versioning | `/api/v2` only for breaking changes to **stable** operations, with ≥ 90 days' deprecation (`Deprecation` + `Sunset` headers). Preview operations may change shape in v1. |
| Tracing | Every response has `X-Request-Id`. |

## 2. Resource map

| Area | Endpoints (all under `/api/v1`) | Stability |
|---|---|---|
| Platform | `GET /capabilities` · `GET /me` · `GET /orgs` · `PATCH /orgs/current` | stable |
| Vehicles | `GET,POST /vehicles` · `GET,PATCH /vehicles/{id}` · `GET /vehicles/{id}/telemetry` · `/status-events` · `/alerts` · `/charging-sessions` · `/battery-health` · `POST /vehicles/{id}/actions/pull-from-service` · `/actions/return-to-service` · `GET,POST /vehicles/{id}/commands` | stable |
| Vehicles (preview) | `GET /vehicles/{id}/earnings` · `/cabin-events` · `/autonomy-events` | preview |
| Rides & dispatch (preview) | `GET /rides` · `GET /rides/{id}` · `GET,POST /dispatch/availability` | preview |
| Hubs | `GET,POST /hubs` · `GET,PATCH /hubs/{id}` · `GET /hubs/{id}/occupancy` · `/forecast` · `/recommendations` · `POST /hubs/{id}/recommendations/{rid}/apply` | stable |
| Hubs (preview) | `GET /hubs/{id}/chargers/live` · `GET /energy/tariffs/live` | preview |
| Exceptions | `GET,POST /exceptions` · `GET,PATCH /exceptions/{id}` · `POST /exceptions/{id}/actions/create-ticket` · `GET,POST /exception-rules` · `PATCH,DELETE /exception-rules/{id}` | stable |
| Tickets | `GET,POST /tickets` · `GET,PATCH /tickets/{id}` · `GET /tickets/{id}/events` · `GET,POST /tickets/{id}/attachments` · `POST /tickets/{id}/actions/{assign-vendor\|escalate\|mark-arrived\|complete\|return-to-service\|cancel}` | stable |
| Vendors | `GET,POST /vendors` · `GET,PATCH /vendors/{id}` · `GET /vendors/{id}/jobs` · `GET /vendors/rank` | stable |
| Vendors (preview) | `GET,POST /vendor-jobs/{id}/tracking` | preview |
| Money | `GET,POST /revenue/imports` · `GET /revenue/imports/{id}` · `POST /revenue/imports/{id}/commit` · `GET,POST /revenue-lines` · `GET,POST /cost-lines` | stable |
| KPIs & finance | `GET /kpis/fleet` · `/kpis/hubs` · `/kpis/vehicles/{id}` · `GET /financials/pnl` · `GET /financials/insights` · `GET /attention` | stable |
| Reports | `GET,POST /reports` · `GET /reports/{id}` · `GET /reports/{id}/pdf` · `POST /reports/{id}/shares` · `DELETE /reports/{id}/shares/{sid}` · `GET /covenants` · `PUT /covenants` | stable |
| Settings | `GET,POST /members` · `PATCH,DELETE /members/{user_id}` · `GET,POST /invitations` · `GET,PUT /policies` · `GET,PUT /notifications/settings` · `GET /notifications` · `POST /notifications/read` | stable |
| Integrations | `GET /integrations/tesla` · `POST /integrations/tesla/connect` · `GET /integrations/tesla/callback` · `POST /integrations/tesla/disconnect` · `GET /integrations/tesla/vehicles` | stable |
| Copilot | `POST /copilot/chat` (SSE stream) | stable |
| Public | `GET /share/{token}` (report view, no auth) · `GET /.well-known/appspecific/com.tesla.3p.public-key.pem` (outside `/api`) | stable |

## 3. Capability registry

`GET /api/v1/capabilities` (implemented in task 3.9; `capabilityStatuses()` in `packages/domain`). Demo org:

```json
{
  "org_id": "…",
  "capabilities": [
    {"name": "tesla",             "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "rides",             "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "earnings",          "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "cabin_events",      "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "autonomy_events",   "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "dispatch",          "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "charger_telemetry", "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "live_tariffs",      "state": "simulated",   "source": "simulator", "fallback": null},
    {"name": "vendor_tracking",   "state": "unavailable", "source": null,        "fallback": "manual"}
  ]
}
```

Any other org (until Phase 4 connects Tesla): every capability `unavailable`, with fallbacks `earnings: csv`, `charger_telemetry: inferred`, `live_tariffs: static`, `vendor_tracking: manual`. `vendor_tracking` stays unavailable even in demo orgs until vendor jobs exist (task 5.5): there's nothing to track yet.

**Preview endpoints (task 3.9)** are gated in one place: an operation declares its capability and `apiRoute` answers `501 capability_unavailable` (with `capability`, `message`, `docs`) before the handler runs, so an unconnected org can never get an empty `200`. In demo orgs they serve: rides and earnings from simulator trips; cabin events from the simulator's cabin camera; autonomy "stuck" events from simulated breakdowns; dispatch availability derived from status plus a FleetOS-side on/off switch (`dispatch_overrides`, no network is told); live charger status inferred from cars charging at the hub; the live tariff from the hub's time-of-use schedule. Each stand-in carries a `SUBSTITUTE` marker.

`fallback` tells the UI which stable approximation is being shown instead. The capability names are the same ones used in `SUBSTITUTE(<capability>, …)` markers (ADR-0012).

## 4. Realtime channels (ADR-0011)

**Implemented (task 3.8d):** `org:{org_id}:vehicles` (`state`, one batched message per tick: `{vehicles: [{vehicle_id, …changed fields}]}`) and `org:{org_id}:status` (`status_changed`), sent by the engine tick through `public.engine_broadcast` (`realtime.send`, private). A policy on `realtime.messages` lets only members of that org subscribe. The header freshness chip listens and updates live. Batching is per tick (1/min in the prototype), within the ≤ 1/s budget below.

| Channel | Mechanism | Payload | Consumers |
|---|---|---|---|
| `org:{org_id}:vehicles` | Broadcast event `state` (batched ≤ 1/s) | `[{vehicle_id, status, soc, location, speed_mps, charge_state, current_hub_id, last_telemetry_at}]` (changed fields only) | Overview, Fleet, Vehicle, Hubs |
| `org:{org_id}:status` | Broadcast event `status_changed` | `{vehicle_id, from, to, at, cause_type}` | Timeline, KPIs |
| `exceptions` | Postgres Changes (RLS) | row | Exceptions, Overview attention, bell |
| `tickets`, `ticket_events` | Postgres Changes (RLS) | row | Service, Vehicle |
| `notifications` | Postgres Changes (RLS, `user_id = auth.uid()`) | row | bell |

On reconnect, clients re-fetch the affected queries (TanStack Query invalidation).

## 5. VehicleProvider interface (`packages/providers`, ADR-0005)

```ts
/** Normalised, Tesla-shaped telemetry event. One per field change. */
export interface TelemetryEvent {
  vehicleRef: string;            // provider's id (VIN for Tesla)
  field: TelemetryField;         // e.g. 'Soc' | 'Location' | 'ChargeState' | … (data-sources.md §3)
  value: number | string | boolean | GeoPoint | null;
  eventTime: Date;               // vehicle time, not ingest time
  source: 'tesla_stream' | 'tesla_rest' | 'simulator';
}

export type ProviderEvent =
  | { kind: 'telemetry'; events: TelemetryEvent[] }
  | { kind: 'alert'; vehicleRef: string; name: string; audiences: string[]; startedAt: Date; endedAt: Date | null }
  | { kind: 'connectivity'; vehicleRef: string; status: 'connected' | 'disconnected'; at: Date }
  | { kind: 'error'; vehicleRef: string; name: string; tags: Record<string, string>; at: Date };

export interface VehicleSummary {
  vehicleRef: string; vin: string; displayName: string | null; model: string | null;
  connectivity: 'online' | 'asleep' | 'offline';
  firmware: string | null; virtualKeyPaired: boolean | null; telemetrySynced: boolean | null;
}

export interface VehicleSnapshot {         // full current state, used for backfill
  vehicleRef: string; takenAt: Date;
  fields: Partial<Record<TelemetryField, TelemetryEvent['value']>>;
}

export type CommandName =
  | 'charge_start' | 'charge_stop' | 'set_charge_limit' | 'navigate_to'
  | 'door_lock' | 'door_unlock' | 'flash_lights' | 'honk_horn';

export interface CommandResult { ok: boolean; error?: string; billed: boolean; raw?: unknown }

export interface ProviderCapabilities {
  streaming: boolean; commands: boolean; batteryHealth: boolean; chargingHistory: boolean;
}

export interface VehicleProvider {
  readonly kind: 'simulator' | 'tesla';
  capabilities(): ProviderCapabilities;
  listVehicles(): Promise<VehicleSummary[]>;
  /** Backfill only. MUST NOT wake the vehicle; returns null if asleep/unavailable (ADR-0007). */
  getSnapshot(vehicleRef: string): Promise<VehicleSnapshot | null>;
  /** Push-based stream of normalised events; resolves when subscribed. */
  subscribe(onEvent: (e: ProviderEvent) => void, signal: AbortSignal): Promise<void>;
  /** Phase 7. Throws if commands are disabled for the org. Never auto-retries non-idempotent commands. */
  sendCommand(vehicleRef: string, command: CommandName, params?: Record<string, unknown>): Promise<CommandResult>;
  getBatteryHealth?(vehicleRef: string): Promise<{ sohPct: number; capacityKwh: number } | null>;
  getChargingHistory?(from: Date, to: Date): Promise<ChargingSessionRecord[]>;
}
```

**Contract tests** (`packages/providers/contract`) every provider must pass: roster shape; `getSnapshot` doesn't wake an asleep vehicle; events carry vehicle time; duplicate delivery is tolerated downstream; late events are ordered by `eventTime`; commands respect the enable switch; unknown vehicles error cleanly.

## 6. Status of the spec

**API reference:** `/docs/api` (Scalar) renders this spec with each operation marked implemented or planned from the code's operation registry; "Try it" calls this deployment directly (no third-party proxy; Scalar's AI agent, MCP generator and telemetry are off), uses the signed-in session cookie, and prefills `X-FleetOS-Org` with the viewer's active org. The annotated JSON is at `/api/openapi.json`.

**Implemented (task 3.8):** `GET /me`, `GET /orgs`, `GET /capabilities`, `GET /vehicles`, `GET /vehicles/{id}`, `GET /vehicles/{id}/status-events`, `GET /vehicles/{id}/charging-sessions`, `GET /kpis/fleet`, `GET /kpis/vehicles/{id}`, `GET /financials/pnl`, `GET /vehicles/{id}/telemetry` (FleetOS fields in SI units, bucketed raw/1m/1h/1d, auto by span per VD-7, owner/admin/ops via RLS), `GET /vehicles/{id}/alerts` (`active=true|false`), `GET,POST /vendors`, `GET,PATCH /vendors/{id}`, `GET /vendors/rank` (score = 0.5 ETA + 0.3 price + 0.2 SLA, relative to the candidates covering the car, × 0.8 for limited vendors; breakdown returned), and all 11 preview operations (§3). `/vendors/{id}/jobs` arrives with service tickets (5.5). **Task 5.4:** `GET,POST /exceptions` (list with an org-wide `summary`: active, by severity, resolved today, revenue at risk — computed from the same rows as the list and the sidebar badge; `status`/`severity` filters, `sort=severity|revenue_at_risk|detected_at`), `GET /exceptions/{id}` (with `trigger` and `events` history), `PATCH /exceptions/{id}` (status, owner, note; owner/admin/ops), `GET,POST /exception-rules`, `PATCH,DELETE /exception-rules/{id}` (owner/admin; system rules can be disabled, not deleted → 409). Revenue at risk = baseline rate at detection × max(expected downtime − elapsed, 15 min) for active exceptions, null once closed. **Task 5.9:** `GET,POST /reports` (owner/admin/finance; POST `{month}` generates a snapshot synchronously → 201; the current month is `preliminary`; a repeat month gets the next `version`; future months 422), `GET /reports/{id}` (summary + the frozen `data` snapshot), `GET /reports/{id}/pdf` (302 to a signed URL valid 5 minutes; rendered on first request with headless Chromium, 503 when no browser is available), `POST /reports/{id}/shares` (`recipient`, `expires_in_days` 1–365 → 201 with the only copy of the link), `DELETE /reports/{id}/shares/{sid}` (204; the link then reads as expired), `GET /covenants` (any member), `PUT /covenants` (owner/admin; replaces the set, one per metric; fractions for everything but incidents per 10k rides; existing reports keep the covenants they were built with). Lenders open shares at `/r/{token}` (a page, not /api/v1); `GET /share/{token}` stays planned. **Task 5.11:** `GET /notifications` (`unread=true`), `POST /notifications/read` (`ids` or `all`; 204), `GET,PUT /notifications/settings` (per-user in-app and email by severity; `slack` is the org's and only owners/admins change it, 403 otherwise). Events call `app.notify` in the database (new exceptions → owner/admin/ops; missed SLA → owner/admin/ops; your ticket completed/returned → you), rows push over `user:<id>:notifications`, and email/Slack go through an outbox the tick drains (5 attempts). **Task 5.10:** `PATCH /orgs/current` (owner/admin; audited; now also `charge_target`, `auto_dispatch_after_min`, `maintenance_reserve_monthly_cents`), `GET /members`, `PATCH,DELETE /members/{user_id}` (last owner protected), `GET,POST /invitations` (emails a 7-day link — Mailpit locally, `RESEND_API_KEY` when hosted — and replaces a pending invite to the same address), `DELETE /invitations/{id}`, `GET,PUT /policies` (MIN-SOC, CHG-TARGET, CLN-02, AUTO-DISPATCH; each writes the setting that drives it), `GET,PUT /sla-policies`. **Task 5.8:** `GET /financials/insights` (owner/admin/finance; up to 5 cars or hubs whose contribution margin is ≥ 1.5 SD below their cohort, each with the cost categories explaining ≥ 70% of the gap measured as cost per revenue dollar vs the fleet, and the margin gap × revenue as `impact_cents`). The page also exports the period's vehicle P&L as CSV (`/financials/export.csv`, not part of /api/v1). **Task 5.7:** `GET,POST /hubs`, `GET,PATCH /hubs/{id}` (chargers and bays as lists; radius hubs — a polygon `geofence` answers 422 for now; overlapping areas 422; tariffs owner/admin), `GET /hubs/{id}/occupancy` (charger use inferred from charging state), `GET /hubs/{id}/forecast` (today only; other dates 422), `GET /hubs/{id}/recommendations` and `POST …/{rid}/apply` (records the decision; routing and charge limits stay manual until Phase 7, flagged `manual: true`). Forecast = each car's battery now drained at the fleet's measured rate (energy charged ÷ battery ÷ hours in service, 7 days; a Cybercab estimate until then) into charging sessions at its home hub, blended 50/50 with the hub's 7-day hourly history once there are 3+ days; past hours show actual use. `/kpis/hubs` stays planned (Overview's margin by hub covers it for now). **Task 5.3:** `GET /attention` (open exceptions grouped by type, ranked by revenue at risk, then severity, then waiting time; each group has one action — `dispatch` (exception id), `open_exception` or `open_fleet` (URL) — and its `bleed`: money lost so far and the per-minute rate from the blocking exceptions' baseline rates). **Task 5.5:** `GET,POST /tickets` (list with `summary`: active, awaiting dispatch, median response and SLA compliance over 30 days, cost today, revenue protected today), `GET,PATCH /tickets/{id}` (PATCH: description and estimate only), `GET /tickets/{id}/events`, `GET,POST /tickets/{id}/attachments` (multipart `file`: JPEG/PNG/HEIC/PDF ≤ 20 MB, type checked from the bytes; signed URLs valid 10 min), `POST /tickets/{id}/actions/{assign-vendor|mark-arrived|complete|return-to-service|escalate|cancel}` (invalid transitions → 422 with the reason; `return-to-service` names what still blocks the car and needs `override` + `reason` from owner/admin), `POST /exceptions/{id}/actions/create-ticket` (`dispatch:true` sends the recommended or given vendor; one live ticket per exception → 409), `GET /vendors/{id}/jobs`, `POST /vehicles/{id}/actions/pull-from-service` and `return-to-service`. Lifecycle changes go through database functions that log every step; completing posts exactly one ledger line (`source=ticket`), and correcting the cost adjusts it. Vendor metrics now come from vendor jobs (90 days). The fleet list pages with opaque offset cursors (fleets are hundreds of cars); history endpoints use keyset cursors on (time, id). Since task 5.1 the list comes from the same service as the `/fleet` page (`lib/services/fleet.ts`): each item carries `today` (revenue, contribution, revenue per available hour — null without money access — and downtime minutes), a 30-day `profitability` label, and `state.location_name`; `profitability=` filters and money sorts need a money role (403 otherwise); `format=csv` returns every matching vehicle as a download. `POST /vehicles` (owner/admin) adds a vehicle by VIN (check digit validated; 409 on duplicate VIN or number). Since task 5.4 each item carries `open_issue` (the car's most severe active exception) and `next_action` (its recommended response), and `issue=any|none|incident|maintenance|cleaning|charging|other` filters by them. Monthly insurance and financing on a vehicle are `null` for roles without money access. Status-event ids are opaque strings (database identities, not UUIDs).

**KPIs:** periods resolve to whole local days in the org's time zone (defaults: `/kpis/fleet` today, `/kpis/vehicles/{id}` last 30 days, `/financials/pnl` month to date). Hours come from the `vehicle_day_hours` rollup (refreshed by the engine tick; it finishes yesterday after midnight and catches up after a pause, up to 31 days); money comes from the ledger at request time, so money-role RLS applies. Money fields are `null` (not 0) for roles without money access; `/financials/pnl` is owner/admin/finance only. Downtime cost uses the fleet revenue per available hour over the trailing `baseline_days`. `utilization.estimated` is `true` until a platform trip feed (`rides`) replaces In Service inferred from telemetry. P&L `scope=hub` answers 400 until ledger lines carry hub attribution for every category. Without a session or valid Bearer token every `/api/v1` route answers `401` JSON (the app's sign-in redirect never applies to `/api`). `/me` and `/orgs` don't need `X-FleetOS-Org` (the spec lists it everywhere; `/me` echoes it as `active_org_id` when valid).


`openapi.yaml` defines every operation above with request/response schemas for the core resources (vehicles, telemetry, status events, hubs, exceptions, tickets, vendors, ledger, KPIs, capabilities, errors). Less central operations (members, invitations, notifications, policies) use generic schemas and get detailed as their Phase 5 tasks start. Lint: `npx @redocly/cli lint docs/architecture/openapi.yaml`.
