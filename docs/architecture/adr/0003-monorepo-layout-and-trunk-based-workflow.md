# ADR-0003: Monorepo layout and trunk-based workflow

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
The repo holds a live static prototype (GitHub Pages) and will hold a web app, a worker and shared packages. Atharva wants to follow progress on `main`.

## Decision
- pnpm workspaces + Turborepo: `prototype/`, `apps/web`, `apps/worker`, `packages/domain`, `packages/providers`, `packages/ui`, `supabase/`, `docs/`.
- Trunk-based: one task = one commit (with its `tasks/todo.md` tick) pushed straight to `main`; no feature branches while early stage.
- The Pages workflow builds `prototype/` only and has a `paths:` filter so product commits don't redeploy the demo (task 2.1).

## Consequences
- `main` must always build; CI is the safety net (no PR review gate).
- The prototype stays a stable visual reference at the same URL.

## Alternatives rejected
- Separate repo for the product: splits history and design reference.
- Feature branch + PR per phase: rejected by Atharva for this stage.
