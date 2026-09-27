# ADR-0015: Supabase is the system of record; Airtable is an optional input source

- **Status:** Accepted
- **Date:** 2026-09-26
- **Decided by:** Akshat + Atharva (Supabase confirmed; Airtable "later, as needed")
- **Relates to:** ADR-0002 (stack), ADR-0004 (tenancy), ADR-0012 (substitute markers)

## Context
Atharva asked whether Airtable should play a role. FleetOS needs row-level tenant isolation, transactions (ledger postings), time-series telemetry, realtime updates and SQL analytics; Airtable offers none of these at our needs (API ≈ 5 requests/second per base, per-base record caps, no row-level security or transactions). Airtable is strong where non-developers maintain low-volume reference data and where external people submit data through forms without accounts.

## Decision
1. **Supabase (Postgres) is the system of record** for everything, as in ADR-0002/0004.
2. **Airtable may be added later, per org, as a one-way input source** that syncs *into* Postgres. It never becomes a second source of truth and is never read by the UI directly.
3. Candidate uses, in priority order:
   1. **Vendor job updates via Airtable forms** (arrived / completed / cost / photos) → `vendor_jobs`, `ticket_events`, `attachments`. A bridge to, or replacement for, the Phase 9 vendor portal. Capability `vendor_tracking`, kind `manual`.
   2. **Vendor directory & rate cards** → `vendors` (task 5.6).
   3. **Revenue / payout sheets** as an alternative to CSV upload → `ledger_entries` (task 3.6). Capability `earnings`, kind `csv`/`manual`.
   4. **Bulk onboarding** (VINs, hubs, chargers) for a new pilot fleet (Phase 8).
4. **Never in Airtable:** telemetry, vehicle status, exceptions, tickets of record, the ledger of record, users/roles/auth.
5. **Mechanics when built:** per-org `integrations` row (`provider = 'airtable'`), personal access token in Supabase Vault, base/table/field mapping stored in config, sync run by the per-minute tick (ADR-0014) or an Airtable webhook, idempotent on the Airtable record id (`source = 'airtable'`, `source_ref = <record id>`). Synced rows carry a `SUBSTITUTE(<capability>, manual)` marker at the sync seam in code.

## Consequences
- No schema or architecture change now; Airtable work is optional and additive.
- Fields owned by Airtable are read-only in FleetOS for that org (edit in Airtable), shown with a "Managed in Airtable" hint.
- If an Airtable-fed capability later gets a real integration (e.g. Agero for roadside), the Airtable sync for it is retired.

## Alternatives rejected
- **Airtable as the main database:** fails tenancy, transactions, time-series and realtime requirements.
- **Two-way sync:** conflict handling and dual truth for little benefit.
