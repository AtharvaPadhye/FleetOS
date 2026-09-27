# FleetOS — Product Roadmap & Implementation Plan

> **Status:** Planning complete, Phase 0 not started. Created 2026-09-26.
> **Fresh session?** Read "Handoff" + "Decision log", then open `tasks/todo.md` and resume at the first unchecked task.
> **Rule:** one task = one commit that ticks `tasks/todo.md`, **pushed immediately to `origin/main`** (no feature branches while the product is early stage) so Atharva can follow progress. Every push to `main` triggers the GitHub Pages deploy of the prototype, so never push a commit that breaks `npm run build` / the Pages workflow.

## Handoff

FleetOS is an **operations control tower for owners of autonomous (Tesla Cybercab) fleets that are financed as assets**. The MVP (`https://atharvapadhye.github.io/FleetOS/`, identical to this repo's `src/main.js` at `6a32124`) is a static, hard-coded prototype of 9 screens. This plan turns it into a real multi-tenant SaaS: requirements → design → foundation → data platform + simulator → Tesla Fleet API (read) → features screen-by-screen → Copilot → vehicle commands → hardening.

**The core loop the product exists for:**
detect issue → rank by **revenue at risk** → dispatch vendor → track **SLA** → return to service → post cost to the **vehicle's P&L** → roll up into **investor / lender reporting**.

## Decision log (don't relitigate without new information)

Full reasoning for architecture decisions: `docs/architecture/adr/` (ADR-0001…0013, task 1.1). Newer decisions: pg-boss for timers (0010), Supabase Realtime Broadcast for telemetry (0011), Redis Pub/Sub telemetry dispatcher (0007).

| Decision | Chosen | Rejected & why |
|---|---|---|
| Vehicle data source | **Simulator first** behind a `VehicleProvider` adapter; Tesla Fleet API swapped in when access exists | Blocking on Tesla access — no account yet, and Cybercab third-party access is unconfirmed |
| Revenue / ride data | **Simulated rides + CSV payout-statement import** | Tesla Robotaxi payouts API (not public / speculative); own ride-hailing layer (huge scope: rider app, payments, dispatch) |
| Stack | **Next.js (App Router, TS) on Vercel + Supabase (Postgres/PostGIS, Auth, Realtime, Storage, Vault) + Dockerized worker on Fly.io** | AWS (ECS/RDS/Timescale/Redpanda/KMS): 2–3× setup, ~$250–600/mo floor, idle at 84 cars. Vanilla JS: innerHTML templates won't scale to data-driven screens |
| Migration guardrails | Domain logic in framework-agnostic `packages/*`; plain SQL migrations; worker is a container | — keeps a future move of the telemetry hot path to AWS a migration, not a rewrite |
| Move-to-AWS triggers | >1–2k streaming vehicles, customer demands VPC/KMS, or Tesla grants production command access | — |
| Tenancy | **Multi-tenant B2B SaaS**; `org_id` on every row + Postgres RLS from day one | Single-operator tool (hard to sell later); vendor portal deferred to optional Phase 9 |
| Repo | **Monorepo in this repo**: MVP → `prototype/` (still deployed to Pages), `apps/web`, `apps/worker`, `packages/*`, `supabase/` | Separate repo (splits history + design reference); replace-in-place (breaks live demo) |
| Git | Commit per task **with the `tasks/todo.md` update in the same commit**, push straight to `main` right away; phase exits are review checkpoints, not PRs | Feature branch + PR per phase (Atharva prefers trunk-based while early stage); push per phase (Atharva needs to follow progress continuously) |
| Copilot LLM | Claude (default `claude-sonnet-5`) with tool-use over RLS-scoped read APIs; verify via `claude-api` skill at build time | — |
| API versioning | **Single `/api/v1` with per-endpoint stability tags.** `stable` = backed by a source we have today (Tesla Fleet API fields, native records, CSV imports). `preview` = placeholder for a source we don't have yet (platform rides/earnings, cabin & autonomy events, dispatch, charger/vendor/tariff feeds): simulated in demo orgs, `501 capability_unavailable` elsewhere, shape may change until it goes stable. `/api/v2` is reserved for real breaking changes. See §3a | `/v1` = available + `/v2` = future: misuses versions to mean source availability, so a real breaking change to v1 would have to jump to v3 (decided 2026-09-26, then reversed the same day) |
| Requirements defaults | Recommended answers to the open questions in `prd.md` §9, `kpis.md` §7 and `vehicle-states.md` §9 accepted by Akshat on 2026-09-26 (contribution = revenue − variable costs, proposed grade weights, 24 h service window, 40% low-SOC, Incident outranks Offline, …) | — |
| Substitute data | Every stand-in for a real source (simulator, CSV, manual, inferred, static, fixture) carries a `SUBSTITUTE(<capability>, <kind>)` comment with the real source and replacement step; inventoried by `pnpm substitutes`. Rule lives in `CLAUDE.md` | Tracking substitutes only in docs (drifts from code) |
| Prototype infra | **Vercel + Supabase only** (free tiers) with a per-minute `pg_cron` tick until a real Tesla is connected; always-on container + domain added in task 4.0 (ADR-0014) | Fly worker from day one (cost/setup with no prototype benefit) |
| Charts | Recharts (or ECharts for dense time-series), validated with the `dataviz` skill | — |

## 1. What the MVP implements (inventory)

Everything is static, hard-coded HTML strings in `src/main.js`. Only navigation, the fleet search box, and the vehicle-detail drill-in actually work; every other button fires a toast.

| Screen | Envisioned capability | Key data points |
|---|---|---|
| Shell | Org switcher, 9-section nav, live-data indicator, ⌘K Copilot, mobile nav | Org, region, vehicle count, freshness |
| Overview | Fleet KPIs, **needs-attention queue ranked by revenue at risk**, availability trend, revenue vs cost, downtime by cause, margin by hub, fleet health scores, Copilot recommendation | Total/available/earning vehicles, availability % vs target, revenue, contribution, downtime cost, avg SOC |
| Fleet | Vehicle table w/ filters, columns, pagination, export, add vehicle | VIN, status, location, hub, SOC, revenue, contribution, rev/avail-hr, downtime, open issue, next action |
| Vehicle detail | Facts, tabs (Overview/Operations/Service History/Financials/Telemetry), **per-vehicle P&L statement**, KPIs vs fleet avg, event timeline, incident financial impact | Odometer, availability, platform fees, electricity, cleaning, maintenance, insurance, downtime cost, financing |
| Exceptions | Intervention queue by severity, recommended response, est. downtime, revenue at risk, owner/status, rules & automation | Severity, type, detected time/location, vendor, status |
| Service ops | Tickets with **SLA countdown**, vendor/ETA/cost, lost revenue, evidence photos, lifecycle actions, activity log | Detection source, policy (e.g. CLN-02), timestamps |
| Hubs | Chargers/bays/turnaround/electricity price, **hourly capacity forecast**, overload warning, rebalancing actions | Assigned/present vehicles, chargers occupied, $/kWh, utilization % |
| Vendors | Partner network, SLA %, response time, job cost, rating, capacity | Categories: cleaning, detailing, tires, towing, charging |
| Financials | Fleet unit economics, weekly revenue/contribution, cost breakdown, anomaly insight, vehicle ranking | Rev/vehicle, rev/avail-hr, cost/revenue-mile, maintenance reserve |
| Reports | **Monthly investor/lender asset report**, covenant (uptime > 94%), asset health grade, risk grid, PDF export, share | Uptime, contribution/avail-hr, cleaning/1K rides, recovery time, reserve |
| Settings | Tesla Fleet API connect flow (client ID, region, scopes), data mapping; stubs for org, policies, rules, users/roles, notifications, billing | — |
| Copilot | Grounded Q&A + recommendations over fleet data | — |

**Inconsistencies to resolve in Phase 0:** see `docs/requirements/kpis.md` §4 (exceptions 7 vs 6, two meanings of "contribution", downtime counted as a cost, revenue-at-risk mismatch, "P0A7F" OBD code, vehicle detail always renders 047). *"76 available / 68 earning" was wrongly listed here: it reconciles with the fleet mini-stats.*

## 2. Tesla APIs — verified 2026-09-26

Full verified reference, costs and the field → source matrix: **`docs/requirements/data-sources.md`** (task 0.4). Summary:
- Auth: authorize `https://auth.tesla.com/oauth2/v3/authorize`; **all** server-side token calls to `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token` (mandated 2025-07). Hosts `fleet-api.prd.{na,eu}.vn.cloud.tesla.com`, `fleet-api.prd.cn.vn.cloud.tesla.cn`. Refresh tokens are single-use (3-month expiry, 24 h grace).
- **Business token** (Tesla-for-Business consent) covers a whole fleet; personal OAuth for owner-operators.
- 12 scopes; FleetOS needs `openid offline_access vehicle_device_data vehicle_location vehicle_charging_cmds` (+ `vehicle_cmds` in Phase 7, partner `vehicle_specs`).
- Paid since 2025-01-01: streaming 150k signals/$1, data 500 req/$1, commands 1k/$1, wakes 50/$1; $10/month credit; app disabled until a payment method is added. ≈ $4 per robotaxi per month streaming vs ≈ $72 polling → **never poll on a schedule**.
- **Fleet Telemetry needs the virtual key + signed config via `tesla-http-proxy`**, so pairing moves to Phase 4.
- **No sandbox**: Phase 4 needs a real Tesla.
- Not exposed by Tesla: rides, earnings, cabin cleanliness, autonomy incidents, dispatch. These stay preview capabilities. Tesla doesn't sell Cybercab fleets yet (interest form only, 2026-09-03).

## 3. Target architecture

```
Browser ── Next.js app (Vercel): UI, route handlers, server actions, Copilot endpoint
              │ supabase-js (user JWT → RLS)          ▲ Realtime (vehicle state, exceptions)
              ▼                                        │
        Supabase: Postgres + PostGIS (partitioned telemetry, ledger, views) · Auth · Storage · Vault
              ▲
        Worker (Docker on Fly.io, Node/TS)
          · provider ingestion (Simulator | Tesla poller | fleet-telemetry dispatcher)
          · normalizer → current state, samples, status events
          · rules engine → exceptions · SLA timers · forecasts · rollups · PDF render
          · tesla-http-proxy (signed commands, Phase 7)
              ▲
        Simulator · Tesla Fleet API + fleet-telemetry (Go, mTLS) · CSV imports · Claude API
```

## 3a. API surface: one `/api/v1`, with stability tags

**Rules**
1. **One version, `/api/v1`.** Version numbers mean breaking changes only. `/api/v2` is reserved for a real breaking change to stable endpoints, with a deprecation window.
2. **Every operation carries `x-fleetos-stability`** in the OpenAPI spec (generated from zod schemas in `packages/domain`) and in a response header of the same name.
   - `stable`: backed by a source we can connect today. Breaking changes are not allowed within v1.
   - `preview`: a placeholder for a data source we don't have yet. Its shape **may change** without a version bump, because we're guessing at a feed nobody has seen.
3. **Preview endpoints never pretend to be empty.** In demo/simulator orgs they return simulated data with `x-fleetos-data-source: simulated`. In orgs without the source they return `501 {"error":"capability_unavailable","capability":"<name>"}`, never `200 []`. That way "not connected" can't be mistaken for "zero" (for example, $0 revenue).
4. **Preview → stable once.** When a real source is connected, the endpoint's schema is finalised against real data and flipped to `stable`. The URL doesn't change.
5. **Capability registry.** `GET /api/v1/capabilities` returns each capability's state for the current org (`live` | `simulated` | `unavailable`). The UI uses it to show real data, a "Simulated" badge, or a "Connect source" empty state.
6. All routes are org-scoped via the user's JWT + RLS; the org id is never passed in the URL.

**Stable: sources available now**

| Endpoint | Methods | Source |
|---|---|---|
| `/api/v1/capabilities` | GET | native |
| `/api/v1/vehicles` (filters: status, hub, soc, issue, q, sort, page) | GET, POST | Tesla roster / simulator + native |
| `/api/v1/vehicles/{id}` | GET, PATCH | Tesla state / simulator + native |
| `/api/v1/vehicles/{id}/telemetry?fields&from&to&interval` | GET | Tesla Fleet Telemetry / simulator |
| `/api/v1/vehicles/{id}/status-events` | GET | derived from telemetry + tickets |
| `/api/v1/vehicles/{id}/alerts` | GET | Tesla `recent_alerts` / simulator |
| `/api/v1/vehicles/{id}/charging-sessions` | GET | Tesla charging history + hub tariffs |
| `/api/v1/vehicles/{id}/battery-health` | GET | Tesla `specs` (partner token): SoH, capacity |
| `/api/v1/vehicles/{id}/commands` | POST, GET | Tesla signed commands (enabled in Phase 7) |
| `/api/v1/hubs`, `/hubs/{id}` | GET, POST, PATCH | native |
| `/api/v1/hubs/{id}/occupancy`, `/hubs/{id}/forecast` | GET | derived (vehicle state at hub + SOC projection) |
| `/api/v1/exceptions`, `/exceptions/{id}` | GET, POST, PATCH | rules engine over stable data + manual |
| `/api/v1/exception-rules` | GET, POST, PATCH, DELETE | native |
| `/api/v1/tickets`, `/tickets/{id}`, `/tickets/{id}/events`, `/tickets/{id}/attachments` | GET, POST, PATCH | native + Storage |
| `/api/v1/vendors`, `/vendors/{id}`, `/vendors/{id}/jobs` | GET, POST, PATCH | native |
| `/api/v1/revenue/imports` | POST (CSV), GET | payout-statement CSV |
| `/api/v1/revenue-lines`, `/api/v1/cost-lines` | GET, POST | filtered views of `ledger_entries` (CSV + native) |
| `/api/v1/kpis/fleet`, `/kpis/hubs`, `/kpis/vehicles/{id}` | GET | derived |
| `/api/v1/financials/pnl?scope=fleet\|hub\|vehicle&period` | GET | derived from ledger |
| `/api/v1/reports`, `/reports/{id}`, `/reports/{id}/pdf` | GET, POST | derived snapshots |
| `/api/v1/policies`, `/api/v1/members`, `/api/v1/notifications` | CRUD | native |
| `/api/v1/integrations/tesla` (+ `/connect`, `/callback`, `/disconnect`) | GET, POST | Tesla OAuth |
| `/api/v1/copilot/chat` | POST (stream) | Claude over stable + available preview tools |

**Preview: placeholders for sources we don't have yet**

| Endpoint | Methods | Capability | Future real source | Screens that need it |
|---|---|---|---|---|
| `/api/v1/rides`, `/rides/{id}` | GET | `rides` | Robotaxi platform trip feed (pickup/dropoff, fare, duration, distance) | Fleet revenue, vehicle detail, financials |
| `/api/v1/vehicles/{id}/earnings` | GET | `earnings` | Platform payout API (live gross, platform fee, net) | Overview revenue, vehicle P&L |
| `/api/v1/vehicles/{id}/cabin-events` | GET | `cabin_events` | Interior camera / cleanliness signals (spill, debris, lost item + confidence) | Exceptions, service tickets, cleaning KPIs |
| `/api/v1/vehicles/{id}/autonomy-events` | GET | `autonomy_events` | Disengagements, remote-assist sessions, incidents | Exceptions, reports (incidents/10K rides) |
| `/api/v1/dispatch/availability` | GET, POST | `dispatch` | Robotaxi network control (put vehicle in/out of service, zones) | "Return to service", rebalancing actions |
| `/api/v1/hubs/{id}/chargers/live` | GET | `charger_telemetry` | Depot charger telemetry (OCPP / charger vendor API) | Hubs occupancy, capacity forecast accuracy |
| `/api/v1/vendor-jobs/{id}/tracking` | GET, POST (webhook) | `vendor_tracking` | Vendor integrations / portal (ETA, geofenced arrival, evidence) | Service SLA countdown, vendor SLA stats |
| `/api/v1/energy/tariffs/live` | GET | `live_tariffs` | Utility time-of-use pricing API | Hub $/kWh, charging cost optimisation |

Until a preview capability is live, the stable figures that depend on it use the best available fallback: revenue from CSV imports into the ledger, cleanliness exceptions created manually or from simulator events, and "return to service" as a FleetOS status change only.

Monorepo (pnpm + Turborepo):
```
prototype/            MVP static site (still deployed to Pages)
apps/web/             Next.js app
apps/worker/          ingestion, jobs, simulator runner (Dockerfile)
packages/domain/      types, status state machine, KPI calculators (pure, tested)
packages/providers/   VehicleProvider interface, simulator, tesla
packages/ui/          design tokens + shared components
supabase/             migrations, seed, RLS tests
docs/                 requirements, architecture/ADRs, plans
```

## 4. Phases

Each task: **Goal · Where · Verify**. One commit each (Conventional Commits).

### Phase 0 — Requirements & discovery
Exit: every MVP number has a written formula and a named data source; PRD reviewed by Akshat (+ Atharva).
- **0.1 PRD** — personas (fleet owner/CFO, ops manager/dispatcher, hub lead, finance/investor-relations, org admin; vendor later), jobs-to-be-done, user stories per screen. `docs/requirements/prd.md`. Verify: every MVP screen has ≥3 stories with acceptance criteria.
- **0.2 KPI dictionary** — formulas, units, time windows, targets for availability, rev/avail-hr, contribution & margin, downtime cost, revenue at risk, cost/revenue-mile, SLA compliance, cleaning/1K rides, incidents/10K rides, asset health grade, maintenance reserve. Resolve the MVP inconsistencies. `docs/requirements/kpis.md`. Verify: MVP overview numbers reproducible from a worked example.
- **0.3 Vehicle status state machine** — In Service, Ready, Charging, Cleaning, Maintenance, Incident, Offline; transitions, triggers, who/what can cause each. `docs/requirements/vehicle-states.md` (mermaid stateDiagram).
- **0.4 Data-source matrix + Tesla verification** — every field → Tesla endpoint/telemetry field | simulator | CSV | native | derived, and tagged **stable** (source available now) or **preview** (placeholder, source needed later) per §3a. Re-verify Tesla endpoints, scopes, telemetry fields, pricing, rate limits against developer.tesla.com. `docs/requirements/data-sources.md`.
- **0.5 NFRs** — tenancy, RBAC matrix, token/key security, audit, freshness (live ≤ 15 s), retention (raw telemetry 30 d, rollups forever), a11y (WCAG 2.2 AA), browser support, costs. `docs/requirements/nfr.md`.

### Phase 1 — Design
Exit: ERD, API contract, provider interface, design tokens reviewed.
- **1.1 Architecture + ADRs** — the decisions above as ADR files. `docs/architecture/`.
- **1.2 Domain model / ERD** — orgs, memberships, hubs, chargers, bays, vehicles, vehicle_state_current, telemetry_samples (daily partitions), vehicle_status_events, rides, revenue_lines, cost_lines, exception_rules, exceptions, tickets, ticket_events, vendors, vendor_services, vendor_jobs, attachments, policies, report_snapshots, integrations, command_log, audit_log. `docs/architecture/erd.md` (mermaid erDiagram).
- **1.3 API contract** — `/api/v1` OpenAPI (§3a) generated from zod schemas with `x-fleetos-stability` per operation, capability registry, 501 `capability_unavailable` shape, stability/data-source headers, Realtime channel list, `VehicleProvider` TS interface + normalized `VehicleSnapshot` (Tesla-shaped). `docs/architecture/api.md` + `openapi.yaml`.
- **1.4 Design system** — `frontend-design` → `ui-ux-pro-max`: extract MVP tokens (dark palette, DM Sans/Manrope, spacing, radii, status colors) and component inventory (Metric, Card, StatusPill, Bar, Sparkline, DataTable, Timeline, Modal, Toast, CommandPalette). `docs/design/design-system.md`.
- **1.5 UX flows** — states the MVP lacks: loading/empty/error, filters, detail tabs, exception→ticket→dispatch→return flow, command confirmation, CSV import mapping. `docs/design/flows.md`.

### Phase 2 — Foundation
Exit: on a Vercel preview URL you can sign in, create/switch org, and navigate the empty shell; RLS isolation tests pass in CI; Pages still serves the prototype.
- **2.1 Monorepo + prototype move** — move MVP to `prototype/`, pnpm workspaces + Turborepo, update `deploy-pages.yml` to build `prototype/` **in the same commit** (every push to `main` deploys Pages), and add a `paths:` filter (`prototype/**`, the workflow file) so only prototype changes redeploy Pages; keep `workflow_dispatch`. Verify: live site byte-identical after deploy; a docs-only push triggers no Pages run. Verify: `pnpm --filter prototype build` produces identical `dist/`.
- **2.2 Next.js app** — `apps/web` (App Router, TS strict, Tailwind, shadcn/ui), tokens in `packages/ui`; ESLint, Prettier, Vitest, Playwright; GitHub Actions CI (lint, typecheck, test); `pnpm substitutes` script that inventories `SUBSTITUTE(...)` markers (file:line, capability, kind) and fails CI on malformed ones (see `CLAUDE.md`).
- **2.3 Supabase baseline** — local CLI stack, migrations for orgs/memberships/profiles, `auth.org_ids()` helper, RLS policies, pgTAP isolation tests.
- **2.4 Auth + orgs + roles** — magic link + Google; roles owner/admin/ops/finance/viewer; middleware route protection; org switcher.
- **2.5 App shell** — sidebar, header, 9 routes, ⌘K palette stub, mobile nav, ported from MVP look.
- **2.6 Env + observability** — zod env schema, Sentry (free), structured logs, Vercel previews, Supabase remote project (free tiers per ADR-0014).

### Phase 3 — Data platform & simulator (API implementation, part 1)
Exit: simulator runs 24 h for 84 Cybercabs across 3 Phoenix hubs; state, rides, costs, status events land in Postgres; KPI views match hand-calculated fixtures.
- **3.1 `packages/domain`** — types, status state machine, KPI calculators (unit tests from 0.2 worked examples).
- **3.2 Vehicle/hub schema** — hubs, chargers, bays, vehicles, vehicle_state_current, telemetry_samples (partitioned), status_events + RLS.
- **3.3 `VehicleProvider` interface** — `listVehicles`, `getSnapshot`, `streamTelemetry`, `sendCommand`; contract tests any provider must pass.
- **3.4 Simulator provider** — seeded RNG; Phoenix geography; SOC drain/charge; trips with fares; events (cleanliness, tire pressure, fault, breakdown, offline); emits Tesla-shaped payloads.
- **3.5 Engine + tick** — `packages/engine` (ingest → normalise → upsert current state, append samples, derive status events, rules, SLA sweep, rollups) run by a per-minute `pg_cron` → tick route (ADR-0014); Realtime via Postgres Changes. No Fly yet; `apps/worker` container comes in Phase 4.
- **3.6 Rides & revenue + CSV import** — `rides`, `revenue_imports`, revenue categories in `ledger_entries`; payout CSV importer with column mapping + validation report; default layout modelled on the Uber Fleet Portal vehicle-earnings export.
- **3.7 Cost ledger** — hub tariffs → energy cost; vendor job costs; per-vehicle allocations (insurance, financing, platform fees) → cost categories in `ledger_entries` (one ledger, see `docs/architecture/erd.md`).
- **3.8 Stable read APIs + rollups** — `/api/v1` fleet list (filter/sort/paginate), vehicle detail, KPI materialized views refreshed by worker; Realtime subscriptions.
- **3.9 Preview (placeholder) APIs** — the preview routes from §3a, served by the simulator in demo orgs and `501 capability_unavailable` elsewhere; `/api/v1/capabilities`; contract tests assert both behaviours and that preview routes never return `200` with empty data for unconnected orgs.

### Phase 4 — Tesla Fleet API (read-only)
Exit: a real Tesla (any model; there's no sandbox) connected via OAuth, with the virtual key paired, appears in the fleet within 60 s with live SOC/location via Fleet Telemetry. CI runs recorded-fixture contract tests. Prerequisite: payment method on the Tesla developer account (default billing limit is $0).
- **4.0 Always-on infrastructure** — custom domain; one container host (Fly or equivalent) for `apps/worker` + `tesla/fleet-telemetry` + Redis; move the tick's `packages/engine` into the worker; pg-boss + Broadcast per ADR-0007/0010/0011.
- **4.1 Registration** — EC P-256 keypair, public key at `/.well-known/appspecific/com.tesla.3p.public-key.pem` on the product domain (must match `allowed_origins`), partner token + `POST /api/1/partner_accounts` script per region.
- **4.1a Virtual key + command proxy** — pairing flow (`https://tesla.com/_ak/<domain>?vin=`), per-vehicle key status from `fleet_status`, `tesla-http-proxy` deployed in the worker with the private key in Vault. Required for signing telemetry configs; commands stay disabled until Phase 7.
- **4.2 OAuth** — business-token consent flow (Tesla-for-Business `auth_code`) first, personal OAuth second; all token calls to `fleet-auth.prd.vn.cloud.tesla.com` with regional `audience`; single-use refresh tokens stored atomically in Supabase Vault; refresh job; region lookup; disconnect.
- **4.3 `TeslaProvider` read** — roster sync, `fleet_status`, `recent_alerts`, `service_data`, `specs` battery health, charging history/invoices; `vehicle_data` (with `location_data`) only for backfill or on demand, never scheduled, never waking; 408 handling; passes provider contract tests.
- **4.4 Fleet Telemetry** — deploy `tesla/fleet-telemetry` on Fly (mTLS, full CA chain) with the Redis Pub/Sub dispatcher; signed per-VIN `fleet_telemetry_config` with the field set in `data-sources.md` §3; poll until `synced`; alerts/errors/connectivity streams → worker normalizer (same path as simulator).
- **4.5 Integrations page** — real connection status, region, scopes, per-vehicle telemetry health & errors.

### Phase 5 — Features (vertical slices, each UI + API + tests)
Exit: every MVP screen is live-data driven with working interactions; Playwright E2E covers the core loop.
- **5.1 Fleet list** — filters (status/hub/SOC/profit/issue), column chooser, pagination, CSV export, add vehicle.
- **5.2 Vehicle detail** — facts, map, 5 working tabs, telemetry charts, event timeline, economics statement.
- **5.3 Overview** — KPI strip, needs-attention queue, charts (dataviz-validated), live updates.
- **5.4 Exceptions engine** — declarative rules (condition → severity → recommended action), revenue-at-risk calc, dedupe, lifecycle, UI filters, rules editor in Settings.
- **5.5 Service tickets** — create from exception, SLA policies, countdown timers (worker jobs), actions (assign, escalate, arrived, complete, return to service), evidence uploads (Storage), activity log.
- **5.6 Vendors** — directory CRUD, categories, PostGIS service areas, pricing, SLA stats from jobs, dispatch ranking (ETA × cost × SLA).
- **5.7 Hubs** — capacity model, live charger/bay occupancy, hourly utilization forecast from SOC projections, overload alerts, rebalancing recommendations with Apply.
- **5.8 Financials** — fleet & vehicle P&L from ledger, period picker, cost breakdown, cohort anomaly insights, export.
- **5.9 Reports** — monthly snapshot job, sections, asset health grade, covenant thresholds, PDF render in worker (Playwright), share link.
- **5.10 Settings** — organization, fleet policies (min SOC, cleanliness CLN-02…), users & invites, notifications, billing stub.
- **5.11 Notifications** — in-app bell, email, Slack webhook for critical exceptions.

### Phase 6 — FleetOS Copilot
Exit: golden-question eval ≥ 90% grounded answers on simulator seed; every recommendation is a confirmable action.
- **6.1 Tool layer** — `get_fleet_kpis`, `list_exceptions`, `get_vehicle_economics`, `forecast_hub_capacity`, … executed with the user's JWT (RLS).
- **6.2 Chat UI** — ⌘K, streaming, record citations, proposed-action cards.
- **6.3 Evals** — golden questions + regression run in CI.

### Phase 7 — Vehicle commands (write path)
Exit: with a paired test vehicle (or simulator), a dispatcher can start charging with confirmation; every command is audited.
- **7.1 Command enablement** — request `vehicle_cmds` scope (re-consent), per-org admin switch, check key presence via `fleet_status` before sending (rejected commands are still billed). *(Pairing moved to 4.1a.)*
- **7.2 Signed commands** — route commands through the proxy deployed in 4.1a; idempotency guards (no auto-retry of non-idempotent commands on 408); 30 commands/min per vehicle budget.
- **7.3 Command policy** — RBAC, confirmations, dual approval for risky commands, rate limits, command_log, audit_log.
- **7.4 Wire actions** — charge start/stop/limit, navigate to hub, lock, flash/honk for vendor.

### Phase 8 — Hardening & launch
Exit: security sweep clean of high/critical; 1,000-vehicle simulator load passes; pilot tenant onboarded.
- **8.1 Security** — `security-sweep`, RLS pen tests, secrets audit.
- **8.2 Performance** — 1,000-vehicle load test; telemetry retention + rollups; query budgets.
- **8.3 Accessibility & responsive** — `web-design-guidelines` audit.
- **8.4 Onboarding** — org wizard, hub setup, CSV imports, seeded demo tenant.
- **8.5 Ops** — runbooks, backups, uptime monitoring, pilot; decide prototype's future (keep as marketing demo).

### Phase 9 — (optional) Vendor portal
Vendor logins, job accept/decline, ETA, geofenced arrival, photo evidence, invoices.

## 5. Mental map

```mermaid
flowchart LR
  P0[0 Requirements<br/>PRD · KPIs · states · data sources · NFRs] --> P1[1 Design<br/>ADRs · ERD · API · design system · flows]
  P1 --> P2[2 Foundation<br/>monorepo · Next.js · Supabase · auth · shell]
  P2 --> P3[3 Data platform<br/>domain pkg · schema · provider · simulator · worker · ledger]
  P3 --> P4[4 Tesla read<br/>OAuth · roster · polling · Fleet Telemetry]
  P3 --> P5[5 Features<br/>fleet · vehicle · overview · exceptions · service · vendors · hubs · financials · reports · settings]
  P4 --> P5
  P5 --> P6[6 Copilot<br/>tools · chat · evals]
  P4 --> P7[7 Commands<br/>virtual key · signed cmds · audit]
  P5 --> P7
  P6 --> P8[8 Hardening & launch]
  P7 --> P8
  P8 -.-> P9[9 Vendor portal]
```

Phase 4 can run in parallel with Phase 5 because the simulator stands in for Tesla.
