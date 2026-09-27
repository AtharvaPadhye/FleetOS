# Phase 5 — Features (vertical slices)

> 2026-09-27. Executes roadmap Phase 5 (`2026-09-26-fleetos-roadmap.md`). Exit: every MVP screen is live-data
> driven with working interactions; Playwright covers the core loop (detect → dispatch → return to service).
> Visual language: `docs/design/design-system.md`. Flows, URL map, acceptance criteria: `docs/design/flows.md`.

## Build order (dependency-driven, not the roadmap's numbering)

| Step | Task | Why here |
|---|---|---|
| 1 | 5.1 Fleet list (+ Phase 5 foundation) | First screen; builds the shared pieces |
| 2 | 5.2 Vehicle detail | Needs the fleet list's services; P&L + timeline components reused later |
| 3 | 5.6 Vendors | Exceptions dispatch to vendors, so the directory comes first |
| 4 | 5.4 Exceptions engine | Rules produce what Overview and Service consume |
| 5 | 5.5 Service tickets | Created from exceptions; unlocks `vendor_jobs` (and later `vendor_tracking`) |
| 6 | 5.3 Overview | Its attention queue and Bleed lines need exceptions |
| 7 | 5.7 Hubs | Occupancy/forecast/recommendations |
| 8 | 5.8 Financials | Period picker, per-vehicle P&L, insights, export |
| 9 | 5.10 Settings | Org, policies, rules editor, members, capabilities |
| 10 | 5.11 Notifications | Bell, email (Mailpit locally), Slack webhook |
| 11 | 5.9 Reports | Monthly snapshot, Paper theme, PDF, share links |
| — | 5.6a Airtable | **Deferred**: needs the Airtable decision with Atharva (ADR-0015) |

Each step is one commit (or a few if it's large), ticked in `tasks/todo.md`, CI green, logged in Obsidian.

## Shared decisions

1. **Data flow.** Pages are Server Components that call the same service functions as `/api/v1` (moved out of
   the route files into `apps/web/src/lib/services/`), so screens and API can't disagree. Mutations are
   Server Actions or `/api/v1` calls that reuse the same services. Every query runs as the user (RLS).
2. **Live updates.** A small client `LiveRefresh` subscribes to the org's realtime channels and calls
   `router.refresh()` (throttled to ≤ 1 per 10 s) so server-rendered data stays current without client caches.
   Freshness and the Bleed counter tick client-side.
3. **URL is the state.** Filters, sort, page, tabs and periods live in the query string (PRD FL-2); forms are
   plain `<form method="get">` enhanced where useful, so everything deep-links and works without JS.
4. **Charts:** Recharts, lazy-loaded, each with a text summary and "View as table" (A11Y-4), validated with the
   `dataviz` skill.
5. **Map:** MapLibre GL with CARTO's keyless dark basemap (free tier, attribution shown); list alternative for
   keyboard/screen readers. A Mapbox/MapTiler key can replace it later without code changes beyond the style URL.
6. **No worker yet (Phase 4.0).** Exception rules, SLA breach checks and scheduled jobs run in the per-minute
   engine tick; report PDFs render on demand with headless Chromium from a route handler. Both move to the
   worker when it exists.
7. **Preview data** (rides, cabin events, dispatch, chargers, tariffs) is shown with the Simulated badge in
   demo orgs and a "Connect a …" empty state elsewhere — never a zero (design-system Part 4).
8. **Quality bar per screen:** all Part 4 states (loading, empty, error, stale, simulated, not connected,
   permission), keyboard + screen reader, 375/1024/1440 screenshots, axe scan in e2e.

## Out of scope for Phase 5
Tesla connection (Phase 4), Copilot (Phase 6), vehicle commands (Phase 7), Airtable inputs (5.6a, deferred).
