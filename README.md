# FleetOS

An operations control tower for owners of autonomous vehicle fleets: fleet health, exception management, service workflows, hub capacity, vendor SLAs, vehicle-level economics, lender reporting and FleetOS Copilot.

This repo holds both the original **interactive prototype** (static, live on GitHub Pages) and the **production app** being built from it. Plan and progress: [`docs/superpowers/plans/2026-09-26-fleetos-roadmap.md`](docs/superpowers/plans/2026-09-26-fleetos-roadmap.md) · [`tasks/todo.md`](tasks/todo.md).

## Live prototype

[https://atharvapadhye.github.io/FleetOS/](https://atharvapadhye.github.io/FleetOS/). It deploys automatically from `prototype/` whenever files there change; product work elsewhere in the repo doesn't touch it.

## Repository layout

```
prototype/     Frozen MVP (static HTML/JS/CSS) deployed to GitHub Pages
apps/web/      Next.js 16 app (App Router, Tailwind 4, TypeScript)
packages/ui/   Design tokens + shared components (docs/design/design-system.md)
scripts/       Repo tooling (SUBSTITUTE marker checker)
supabase/      Database migrations, policies, seed — from task 2.3
docs/          Requirements, architecture (ADRs, ERD, API), design, research
tasks/         Progress checklist and lessons
```

## Getting started

Requires Node 22+ and pnpm (pinned in `package.json`; corepack installs the right version).

```bash
corepack enable pnpm     # once per machine
pnpm install
```

### Run the prototype

```bash
pnpm prototype:dev       # http://localhost:4173
pnpm prototype:build     # outputs prototype/dist
```

### Run the production app

```bash
pnpm dev                 # apps/web on http://localhost:3000 (Next.js 16, Turbopack)
pnpm build               # build everything (Turborepo)
```

### Local database (Supabase in Docker)

```bash
pnpm db:start            # Postgres, Auth, Studio (http://localhost:54323), inbox (http://localhost:54324)
pnpm db:reset            # re-apply supabase/migrations from scratch
pnpm db:test             # pgTAP tests: tenant isolation, roles, audit
pnpm db:stop
```

### Checks (same as CI)

```bash
pnpm format:check && pnpm substitutes && pnpm test:scripts
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @fleetos/web exec playwright install chromium   # once
pnpm --filter @fleetos/web e2e                                 # end-to-end + WCAG 2.2 AA scan
```

## Documentation

- Requirements: [`docs/requirements/`](docs/requirements/) — PRD, KPI dictionary, vehicle states, data sources (verified Tesla Fleet API reference), non-functional requirements
- Architecture: [`docs/architecture/`](docs/architecture/) — overview, ADRs, ERD, API contract (`openapi.yaml`)
- Design: [`docs/design/`](docs/design/) — design system, UX flows
- Project rules for contributors and Claude: [`CLAUDE.md`](CLAUDE.md)

## Tesla Fleet API

The integration plan (business-token auth, Fleet Telemetry streaming, virtual keys, costs) is in [`docs/requirements/data-sources.md`](docs/requirements/data-sources.md). Until a Tesla account is connected, FleetOS runs on a built-in simulator; every stand-in for real data is marked in code with a `SUBSTITUTE(...)` comment.
