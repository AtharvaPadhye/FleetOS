# FleetOS — Progress Checklist

Spec: `docs/superpowers/plans/2026-09-26-fleetos-roadmap.md`

**Workflow:** one task = one commit that includes the ticked checkbox here → pushed immediately to `origin/main` (trunk-based, so Atharva can follow along). Pages redeploys only when `prototype/` changes. Phase exits are review checkpoints.
Progress also logged in Obsidian: `claude_memory/projects/FleetOS/progress-log.md`.

## Phase −1 — Planning
- [x] Study MVP + live site (identical to `6a32124`)
- [x] Decisions: simulator-first · simulated + CSV revenue · Next.js + Supabase + worker · multi-tenant · monorepo · push every task
- [x] Roadmap written + committed
- [x] Git workflow: commit + push `tasks/todo.md` with every task, directly to `main`
- [x] Open questions from 0.1–0.3 resolved with recommended defaults
- [x] Research archive + `SUBSTITUTE(...)` code-marker convention (`CLAUDE.md`)
- [x] ADR-0014: prototype on Vercel + Supabase only (free tiers); container + domain from Phase 4
- [x] Paused Atharva's legacy Vercel project `fleet-os` (auto-deploys failing since 2026-09-07) via root `vercel.json` `git.deploymentEnabled: false`; re-enable when the app's Vercel project is set up (2.6/4.0)
- [x] API versioning: single `/api/v1`; `stable` vs `preview` (placeholder) tags; `/api/v2` reserved for breaking changes

## Phase 0 — Requirements & discovery
- [x] 0.1 PRD — personas, JTBD, stories per screen (`docs/requirements/prd.md`, accepted)
- [x] 0.2 KPI dictionary + resolve MVP inconsistencies (`docs/requirements/kpis.md`, accepted)
- [x] 0.3 Vehicle status state machine (`docs/requirements/vehicle-states.md`, accepted)
- [x] 0.4 Data-source matrix + Tesla docs re-verification (`docs/requirements/data-sources.md`)
- [x] 0.5 Non-functional requirements (`docs/requirements/nfr.md`)
- [ ] Phase 0 review with Akshat + Atharva → checkpoint

## Phase 1 — Design
- [x] 1.1 Architecture + ADRs (`docs/architecture/README.md`, ADR-0001…0013)
- [x] 1.2 Domain model / ERD (`docs/architecture/erd.md`)
- [x] 1.3 API contract (single v1, stable/preview tags) + VehicleProvider interface (`docs/architecture/api.md`, `openapi.yaml`: 99 ops, 11 preview, lint-clean)
- [x] 1.4 Design system (tokens + components) (`docs/design/design-system.md`: Night Depot + Paper themes, "colour is data", Bleed line signature)
- [x] 1.5 UX flows & states (`docs/design/flows.md`: URL map, 8 flows, state matrix, criteria for the 45 remaining stories)
- [ ] Phase 1 review → checkpoint

## Phase 2 — Foundation
> **Order changed 2026-09-26:** Supabase confirmed (ADR-0015); hosted project creation waits for Akshat + Atharva. Next up: **2.5 app shell → 3.1 domain → 3.3 provider interface → 3.4 simulator**, then 2.3/2.4 once the project exists.
- [x] 2.1 Monorepo + move MVP to prototype/ + Pages path filter (pnpm 10.34.5 + Turborepo; prototype build byte-identical)
  - Verified 2026-09-26: Pages run 36284425903 succeeded with the pnpm build; live `index.html`, `main.js`, `style.css` byte-identical to the pre-move build; this docs-only commit triggered no Pages run.
- [x] 2.2 Next.js app + CI + `pnpm substitutes` marker inventory (Next 16.3.6, React 19.2.8, Tailwind 4.3.3, TS 6.0.3, ESLint 9.39.5, Vitest 5, Playwright 1.63; 21 ui + 1 web unit tests, 4 script tests, 8 e2e incl. axe WCAG 2.2 AA)
- [x] 2.3 Supabase baseline + RLS tests (local Supabase, Postgres 17; orgs/profiles/memberships/invitations/audit_log, role helpers, last-owner guard; 23 pgTAP tests proven to fail when isolation is broken; CI database job). Hosted project: later, `supabase db push`.
- [x] 2.4 Auth, orgs, roles (magic-link sign-in via local inbox, proxy.ts route protection, onboarding + create_org with city, org switcher with roles, sign-out; 58 e2e incl. real magic-link journeys). Deferred: Google sign-in (needs Google credentials), MFA for owner/admin (NFR SEC-2) before integrations in Phase 4.
- [x] 2.5 App shell (sidebar with 9 sections, header with org/date/freshness, ⌘K menu, phone nav sheet, skip link, focus on navigate, honest section placeholders; typed routes; 38 e2e incl. axe on every page + open menu)
- [ ] 2.6 Env + observability — zod env schema + `pnpm db:env` done in 2.4; Sentry, CSP, Vercel previews and hosted Supabase still to do
- [ ] Phase 2 exit check → checkpoint

## Phase 3 — Data platform & simulator
- [x] 3.1 packages/domain (status rules + debounce, vehicle-time accounting, P&L/rates/baselines/revenue at risk, SLA, labels, anomalies, grade, covenants; 85 tests incl. kpis.md E1–E7; 100% lines, 98.8% branches)
  - [x] Rulebook page `/design/kpis`: runs the real rules on the kpis.md examples so 3.1 is visible (42 e2e incl. axe)
- [x] 3.2 Vehicle/hub schema (tariffs, hubs, chargers, bays, vehicles, live state, status events, alerts, holds, battery health, day-partitioned telemetry + 1m/1h rollups; PostGIS; composite org FKs; engine-only writes; raw telemetry limited to owner/admin/ops; pg_cron partition upkeep; 20 new pgTAP tests, sabotage-verified)
- [x] 3.3 VehicleProvider interface + contract tests (`packages/providers`: Tesla-shaped types, errors, reusable contract suite; VIN check digit added to domain)
- [x] 3.4 Simulator provider (84 Cybercabs, 3 Phoenix hubs, trips/fares, charging queues, cleaning/faults/breakdowns/tyres/signal loss, sleep, Fleet-Telemetry-style streaming; deterministic by seed; passes the contract; `pnpm sim:day` scores a day with the rulebook in ~0.4 s; SUBSTITUTE markers for tesla/rides/cabin_events/vendor_tracking)
- [x] 3.5 Engine + per-minute tick (`packages/engine`; simulator save/restore; `/api/internal/tick` via pg_cron→pg_net; demo-fleet onboarding; live freshness chip; engine matches simulator truth within 3 pts over a day; 61 e2e)
- [x] 3.6 Rides & revenue + CSV import (rides + one `ledger_entries` table + `revenue_imports`; tick books simulator fares and platform fees; Financials → Import payouts with auto-detect, manual mapping, row/column errors, idempotent commit; Uber-Fleet-Portal-style headers are an assumption until a real export is checked)
- [x] Dev auto-login: `next dev` + `DEV_AUTO_LOGIN_EMAIL` skips the magic link and signs in as org owner with a demo fleet (`/auth/dev-login`; real sign-in unchanged under `next start`/CI; e2e port configurable)
- [ ] 3.7 Cost ledger
- [ ] 3.8 Stable read APIs + rollups
- [ ] 3.9 Preview (placeholder) APIs + capability registry
- [ ] Phase 3 exit check → checkpoint

## Phase 4 — Tesla Fleet API (read)
- [ ] 4.0 Always-on container + custom domain (ADR-0014 switch-over)
- [ ] 4.1 Registration + public key
- [ ] 4.1a Virtual key pairing + command proxy (needed for telemetry)
- [ ] 4.2 OAuth + token vault
- [ ] 4.3 TeslaProvider read
- [ ] 4.4 Fleet Telemetry server
- [ ] 4.5 Integrations page
- [ ] Phase 4 exit check → checkpoint

## Phase 5 — Features
- [ ] 5.1 Fleet list
- [ ] 5.2 Vehicle detail
- [ ] 5.3 Overview
- [ ] 5.4 Exceptions engine
- [ ] 5.5 Service tickets
- [ ] 5.6a (optional) Airtable inputs: vendor job forms + vendor directory (ADR-0015)
- [ ] 5.6 Vendors
- [ ] 5.7 Hubs
- [ ] 5.8 Financials
- [ ] 5.9 Reports
- [ ] 5.10 Settings
- [ ] 5.11 Notifications
- [ ] Phase 5 exit check → checkpoint

## Phase 6 — Copilot
- [ ] 6.1 Tool layer
- [ ] 6.2 Chat UI
- [ ] 6.3 Evals

## Phase 7 — Vehicle commands
- [ ] 7.1 Command enablement (scope, admin switch, key check)
- [ ] 7.2 Signed commands
- [ ] 7.3 Command policy + audit
- [ ] 7.4 Wire actions

## Phase 8 — Hardening & launch
- [ ] 8.1 Security  - [ ] 8.2 Performance  - [ ] 8.3 A11y  - [ ] 8.4 Onboarding  - [ ] 8.5 Ops

## Review
_(filled in at the end of each phase)_

### Phase 1 — Design (tasks done 2026-09-26, awaiting checkpoint)
- **Delivered:** `docs/architecture/` → `README.md` (context, components, flows, environments, NFR mapping), ADR-0001…0013, `erd.md` (~40 tables, RLS matrix), `api.md` + `openapi.yaml` (99 operations, 11 preview, Redocly-valid); `docs/design/` → `design-system.md` (Night Depot + Paper themes, Bleed line, WCAG-checked tokens), `flows.md` (URL map, 8 flows, state matrix).
- **Exit criterion** "ERD, API contract, provider interface, design tokens reviewed": all written; review pending.
- **New decisions:** pg-boss for timers, Supabase Realtime Broadcast for telemetry, one `ledger_entries` table, `X-FleetOS-Org` header, "colour is data" + chalk buttons, Archivo + IBM Plex, Bleed line signature.
- **All 67 PRD stories now have testable acceptance criteria** (45 added in `flows.md` §4).

### Phase 0 — Requirements (tasks done 2026-09-26, awaiting Akshat + Atharva checkpoint)
- **Delivered:** `docs/requirements/` → `prd.md` (67 stories), `kpis.md` (formulas + worked examples), `vehicle-states.md` (7-state machine), `data-sources.md` (verified Tesla reference + field matrix), `nfr.md` (tenancy, RBAC, security, performance, retention); research evidence in `docs/research/`.
- **Exit criterion** "every MVP number has a written formula and a named source": met via `kpis.md` + `data-sources.md` §4.
- **Changed the plan:** contribution redefined (variable costs only); virtual key + command proxy moved to Phase 4; business-token auth first; no scheduled Tesla polling; Pages path filter in 2.1; `SUBSTITUTE(...)` markers required.
- **Open for the checkpoint:** Cybercab fleets aren't purchasable yet, so who is the pilot customer (Tesla rideshare fleets?); a real Tesla + payment method needed for Phase 4.
