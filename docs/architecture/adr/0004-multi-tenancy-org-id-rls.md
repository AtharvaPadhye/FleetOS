# ADR-0004: Multi-tenancy with org_id and Postgres row-level security

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
FleetOS is multi-tenant B2B SaaS. Tenant leaks are the worst possible failure. Retrofitting tenancy later is expensive.

## Decision
- Every tenant-owned table has `org_id uuid not null` and RLS enabled, with policies using a `security definer` helper `app.user_org_ids()` / `app.has_role(org_id, role)` built on `memberships`.
- The browser uses only the user's JWT; the service role is confined to the worker and server-only code paths (NFR TEN-3).
- Org id is never trusted from URL/body for authorisation (TEN-2).
- Cross-org isolation tests for every table and route run in CI (TEN-4).

## Consequences
- Every query is tenant-safe by default, including Copilot tools (they run with the user's JWT).
- Worker code using the service role must set `org_id` explicitly; reviewed carefully.
- RLS adds some query cost; indexes lead with `org_id`.

## Alternatives rejected
- Schema-per-tenant or database-per-tenant: heavier ops, awkward with Supabase, unnecessary at this scale.
- App-layer filtering only: one missed `where` leaks data.
