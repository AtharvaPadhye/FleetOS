# FleetOS — Non-Functional Requirements

> Roadmap task 0.5 · Status: **accepted** (recommended defaults, 2026-09-26)
> Quality bars every phase must meet. Each requirement has an ID so tests, ADRs and reviews can reference it. "Pilot" = first real operator (Phase 8); "scale" = the 5,000-vehicle design point before the telemetry path would move to AWS. Plan limits for Supabase, Vercel and Fly are **verified in task 2.3/2.6** before these targets are relied on.

## 1. Multi-tenancy (TEN)

| ID | Requirement | Verified by |
|---|---|---|
| TEN-1 | Every tenant-owned row has `org_id`; Postgres **RLS is enabled on every tenant table** with policies based on the caller's memberships. | Migration lint: a table without RLS fails CI |
| TEN-2 | Org id is **never** taken from the URL or request body for authorisation; it comes from the session + membership. | Code review, API tests |
| TEN-3 | The browser only ever uses the user's JWT (anon key + session). The Supabase **service role key is used only by the worker and server-side jobs**, never in `apps/web` client bundles. | Bundle scan in CI |
| TEN-4 | Automated **cross-org isolation tests**: for every table and every `/api/v1` route, a user of org A gets nothing from org B (404, not 403, to avoid leaking existence). | pgTAP + API tests in CI |
| TEN-5 | Storage buckets (ticket photos, reports) are keyed `org_id/...` with RLS-equivalent storage policies. | Storage tests |
| TEN-6 | Realtime channels are filtered by org; a client can't subscribe to another org's channel. | Realtime test |

## 2. Roles & permissions (RBAC)

Roles: `owner` · `admin` · `ops` · `finance` · `viewer`. External: report recipient (share link), vendor (Phase 9).

| Capability | owner | admin | ops | finance | viewer |
|---|:-:|:-:|:-:|:-:|:-:|
| View Overview, Fleet, Vehicle, Hubs, Vendors | ✓ | ✓ | ✓ | ✓ | ✓ |
| View Exceptions & Service | ✓ | ✓ | ✓ | ✓ | ✓ |
| Create/assign/update exceptions & tickets, dispatch vendors | ✓ | ✓ | ✓ | | |
| Return to service (no blocking issue) | ✓ | ✓ | ✓ | | |
| **Override** return to service with a blocking ticket open | ✓ | ✓ | | | |
| Pull vehicle from service | ✓ | ✓ | ✓ | | |
| Manage vendors & hubs | ✓ | ✓ | ✓ | | |
| View Financials | ✓ | ✓ | | ✓ | |
| Import revenue CSV, edit cost allocations | ✓ | ✓ | | ✓ | |
| Generate / export reports | ✓ | ✓ | | ✓ | |
| **Share** reports externally | ✓ | ✓ | | ✓ | |
| Exception rules & fleet policies | ✓ | ✓ | | | |
| Users & roles | ✓ | ✓ | | | |
| Tesla / data integrations | ✓ | ✓ | | | |
| **Vehicle commands** (Phase 7) | ✓ | ✓ | ✓ (only if enabled per org) | | |
| Enable commands for the org | ✓ | | | | |
| Billing, delete org | ✓ | | | | |
| Copilot | ✓ | ✓ | ✓ | ✓ | ✓ (read-only answers, no proposed actions) |

- RBAC-1: permissions are enforced **in the database (RLS / security-definer functions) and the API**, never only by hiding UI.
- RBAC-2: an org always has ≥ 1 owner; the last owner can't leave or be demoted.
- RBAC-3: Copilot tools run with the asking user's permissions; it can't read or propose anything the user couldn't do.

## 3. Security (SEC)

| ID | Requirement |
|---|---|
| SEC-1 | Target **OWASP ASVS Level 2** for `apps/web` and the API. |
| SEC-2 | Sign-in: email magic link + Google; **MFA required for `owner` and `admin`** before accessing integrations, users or commands. Sessions expire after 12 h idle / 7 days absolute. |
| SEC-3 | **Tesla tokens and the virtual-key private key** are stored only in Supabase Vault (encrypted), read only by the worker/server. Never logged, never sent to the browser, never in env files committed to git. Refresh-token rotation is written atomically (single-use tokens). |
| SEC-4 | All secrets come from the platform secret stores (Vercel, Fly, Supabase); `.env*` is git-ignored; CI runs a secret scanner (gitleaks) on every push. |
| SEC-5 | TLS everywhere; HSTS; strict **Content-Security-Policy** (no inline scripts except hashed); `X-Frame-Options: DENY` (except the report share view if embedding is later required). |
| SEC-6 | All API input validated with zod schemas (the same ones that generate OpenAPI); unknown fields rejected. |
| SEC-7 | Rate limiting on `/api/v1`: 600 req/min per user, 60/min for writes; stricter on auth and CSV import. |
| SEC-8 | File uploads: allow-listed types (JPEG, PNG, HEIC, PDF, CSV), ≤ 20 MB, stored privately, served through short-lived signed URLs. |
| SEC-9 | Report share links: random ≥ 128-bit tokens, expire (default 30 days), revocable, view-only, access-logged, watermarked with recipient. |
| SEC-10 | **Audit log** (append-only) for: sign-ins, role changes, integration connect/disconnect, policy/rule changes, return-to-service overrides, report shares, CSV imports, every vehicle command. Retained 2 years. |
| SEC-11 | **Vehicle commands** (Phase 7): off by default per org; explicit confirmation in UI; dual approval for unlock/remote-start; per-vehicle key check before sending; never auto-retried when non-idempotent. |
| SEC-12 | **Copilot / LLM safety:** vehicle, vendor and ticket text is treated as data, never instructions (prompt-injection resistant tool design); Copilot can only *propose* actions; no org data is used to train models; LLM calls carry no secrets. |
| SEC-13 | Dependency scanning (Dependabot + `npm audit` in CI); no high/critical vulns at release. `security-sweep` before each phase exit from Phase 2 on. |

## 4. Privacy & compliance (PRV)

| ID | Requirement |
|---|---|
| PRV-1 | **Least privilege with Tesla:** request only the scopes in `data-sources.md` §2.2; no `user_data`. Don't sell or share vehicle data; keep it only as long as needed (Tesla Fleet API Agreement). |
| PRV-2 | Location is sensitive: precise location history follows the retention in §7, and access to raw location history is limited to `owner`/`admin`/`ops`. |
| PRV-3 | Region: North America first; CCPA-ready (org-level data export and deletion). GDPR work only when an EU customer is in scope. |
| PRV-4 | Org data export (all tables as CSV/JSON + files) and org deletion: soft delete for 30 days, then hard delete including Storage and Vault secrets; Tesla consent revoked on disconnect. |
| PRV-5 | SOC 2 readiness (policies, access reviews, change management) starts in Phase 8; we don't claim compliance before an audit. |
| PRV-6 | "Tesla" is used only descriptively ("connect your Tesla fleet"); no Tesla logos or implied endorsement. |

## 5. Performance & freshness (PERF)

| ID | Requirement | Target |
|---|---|---|
| PERF-1 | Telemetry event → visible in UI (Realtime) | **p95 ≤ 15 s** |
| PERF-2 | Derived status change committed after its condition holds | ≤ 60 s debounce + ≤ 5 s processing |
| PERF-3 | `/api/v1` read latency (lists, detail, KPIs) at 1,000 vehicles | p95 ≤ 300 ms, p99 ≤ 800 ms |
| PERF-4 | Dashboard pages | LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 on a mid-range laptop over 4G |
| PERF-5 | "Today" KPI rollups refresh | every ≤ 60 s |
| PERF-6 | Monthly report generation incl. PDF | ≤ 60 s |
| PERF-7 | CSV import of 100k rows | ≤ 2 min, with progress |
| PERF-8 | Ingest throughput | pilot: 1,000 vehicles; design point 5,000 vehicles × ~1 msg/s bursts without backlog > 30 s |
| PERF-9 | Copilot first token | ≤ 3 s; full answer ≤ 20 s |

## 6. Reliability (REL)

| ID | Requirement |
|---|---|
| REL-1 | App availability SLO **99.5%** monthly at pilot (web + API); worker ingest **99.5%**. |
| REL-2 | Backups: daily at minimum from day one; point-in-time recovery enabled before the pilot. **RPO ≤ 24 h now, ≤ 1 h at pilot; RTO ≤ 4 h.** Restore rehearsed once per phase from Phase 3. |
| REL-3 | Ingest is **idempotent**: duplicates (at-least-once delivery) are deduplicated by (vehicle, field, event time). Late events re-derive the affected window. |
| REL-4 | Graceful degradation: if Tesla or the telemetry server is down, the UI shows data age and "stale" badges; KPIs keep working on the last known state; nothing shows zero for missing data. |
| REL-5 | Tesla API calls: timeouts, exponential backoff with jitter, circuit breaker per org, honour `RateLimit-*` headers, never auto-retry non-idempotent commands. |
| REL-6 | Worker jobs (SLA timers, rollups, reports) are durable: a restart doesn't lose scheduled timers (persisted in Postgres). |
| REL-7 | Zero-downtime deploys; database migrations are backward compatible for one release (expand → migrate → contract). |

## 7. Data retention (RET)

| Data | Retention |
|---|---|
| Raw telemetry samples | **30 days** (daily partitions dropped) |
| 1-minute rollups | 13 months |
| Hourly / daily rollups, KPIs | life of the org |
| Vehicle status events | life of the org |
| Tickets, exceptions, activity logs | life of the org |
| Attachments (photos) | 2 years, then deleted unless attached to an open ticket |
| Report snapshots & PDFs | life of the org |
| Audit log | 2 years |
| Tesla tokens / keys | until disconnect; deleted immediately on disconnect or org deletion |
| Deleted org | 30-day soft delete, then hard delete |

## 8. Observability & cost control (OBS)

| ID | Requirement |
|---|---|
| OBS-1 | Errors to Sentry (web, API, worker) with `org_id`, `request_id`, release; no PII or tokens in events. |
| OBS-2 | Structured JSON logs with correlation ids across web → API → worker. |
| OBS-3 | Metrics & alerts: ingest lag, telemetry connections, `fleet_telemetry_errors` per VIN, job failures, SLA-timer drift, API error rate, p95 latency. |
| OBS-4 | **Tesla spend tracking per org** (signals, requests, commands, wakes) with a monthly budget; alert at 80%, hard stop for non-essential calls at 100%. |
| OBS-5 | **LLM spend tracking per org** for Copilot, with a monthly cap. |
| OBS-6 | Infra budget at pilot: **≤ $150/month** platform cost (Vercel, Supabase, Fly, Redis, Sentry), excluding Tesla (~$4/vehicle/month) and LLM usage. Reviewed at each phase exit. |

## 9. Accessibility & UX quality (A11Y)

| ID | Requirement |
|---|---|
| A11Y-1 | **WCAG 2.2 AA.** Checked with axe in Playwright on every page + a manual `web-design-guidelines` audit per phase. |
| A11Y-2 | Full keyboard operation (tables, filters, command palette, modals with focus trap); visible focus. |
| A11Y-3 | Status and severity are never shown by colour alone (text label + icon); contrast ≥ 4.5:1 in the dark theme. |
| A11Y-4 | Charts have text alternatives (summary + data table) and pass the `dataviz` colour validator. |
| A11Y-5 | Respects `prefers-reduced-motion`; live updates don't steal focus (polite live regions for critical alerts only). |
| A11Y-6 | Every screen has loading, empty, error and "source not connected / simulated" states. |

## 10. Compatibility & localisation (CMP)

| ID | Requirement |
|---|---|
| CMP-1 | Last 2 versions of Chrome, Edge, Safari, Firefox. No IE. |
| CMP-2 | Responsive from **375 px** (ops on phones) to ultrawide; tables scroll inside their container. |
| CMP-3 | English, USD, miles and °F first; units and currency stored neutrally (cents, metres, °C) and converted for display, so km/°C/EUR are a settings change later. |
| CMP-4 | All times shown in the org's time zone with the zone indicated where ambiguous. |

## 11. Maintainability (MNT)

| ID | Requirement |
|---|---|
| MNT-1 | TypeScript `strict` everywhere; no `any` in `packages/domain`. |
| MNT-2 | Test coverage: `packages/domain` ≥ 90% lines (KPI worked examples from `kpis.md` §6 are mandatory tests); overall ≥ 70%; E2E covers the core loop (detect → dispatch → return to service → P&L). |
| MNT-3 | Provider contract tests: simulator and Tesla providers pass the same suite. |
| MNT-4 | Every substitute data source carries a `SUBSTITUTE(...)` marker (`CLAUDE.md`); `pnpm substitutes` passes in CI. |
| MNT-5 | Architecture decisions recorded as ADRs (`docs/architecture/`); requirement IDs from this file cited in PRs/commits where relevant. |
| MNT-6 | Migrations are plain SQL, reviewed, reversible where practical, and tested against a seeded database in CI. |

## 12. How these are checked

| When | Checks |
|---|---|
| Every push (CI) | lint, typecheck, unit + contract tests, RLS/isolation tests (TEN-4), bundle scan (TEN-3), gitleaks (SEC-4), dependency audit (SEC-13), `pnpm substitutes` (MNT-4), axe on changed pages (A11Y-1) |
| Each phase exit | `security-sweep`, `web-design-guidelines` audit, cost review (OBS-6), backup restore rehearsal (REL-2, from Phase 3) |
| Phase 8 | load test at 1,000 vehicles (PERF-3, PERF-8), SLO dashboards live (REL-1), SOC 2 readiness kickoff (PRV-5) |
