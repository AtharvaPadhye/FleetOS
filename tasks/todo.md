# FleetOS — Progress Checklist

Spec: `docs/superpowers/plans/2026-09-26-fleetos-roadmap.md` · One task = one commit · Push per phase.
Progress also logged in Obsidian: `claude_memory/projects/FleetOS/progress-log.md`.

## Phase −1 — Planning
- [x] Study MVP + live site (identical to `6a32124`)
- [x] Decisions: simulator-first · simulated + CSV revenue · Next.js + Supabase + worker · multi-tenant · monorepo · push per phase
- [x] Roadmap written + committed
- [x] API versioning split: v1 = sources available now, v2 = sources needed later (simulated)

## Phase 0 — Requirements & discovery
- [ ] 0.1 PRD — personas, JTBD, stories per screen
- [ ] 0.2 KPI dictionary + resolve MVP inconsistencies
- [ ] 0.3 Vehicle status state machine
- [ ] 0.4 Data-source matrix + Tesla docs re-verification
- [ ] 0.5 Non-functional requirements
- [ ] Phase 0 review with Akshat → push

## Phase 1 — Design
- [ ] 1.1 Architecture + ADRs
- [ ] 1.2 Domain model / ERD
- [ ] 1.3 API contract (v1 available-now / v2 needed-later) + VehicleProvider interface
- [ ] 1.4 Design system (tokens + components)
- [ ] 1.5 UX flows & states
- [ ] Phase 1 review → push

## Phase 2 — Foundation
- [ ] 2.1 Monorepo + move MVP to prototype/ (Pages still works)
- [ ] 2.2 Next.js app + CI
- [ ] 2.3 Supabase baseline + RLS tests
- [ ] 2.4 Auth, orgs, roles
- [ ] 2.5 App shell
- [ ] 2.6 Env + observability
- [ ] Phase 2 exit check → push

## Phase 3 — Data platform & simulator
- [ ] 3.1 packages/domain
- [ ] 3.2 Vehicle/hub schema
- [ ] 3.3 VehicleProvider interface + contract tests
- [ ] 3.4 Simulator provider
- [ ] 3.5 Worker ingestion (Fly)
- [ ] 3.6 Rides & revenue + CSV import
- [ ] 3.7 Cost ledger
- [ ] 3.8 v1 read APIs + rollups
- [ ] 3.9 v2 preview APIs (simulated) + capability registry
- [ ] Phase 3 exit check → push

## Phase 4 — Tesla Fleet API (read)
- [ ] 4.1 Registration + public key
- [ ] 4.2 OAuth + token vault
- [ ] 4.3 TeslaProvider read
- [ ] 4.4 Fleet Telemetry server
- [ ] 4.5 Integrations page
- [ ] Phase 4 exit check → push

## Phase 5 — Features
- [ ] 5.1 Fleet list
- [ ] 5.2 Vehicle detail
- [ ] 5.3 Overview
- [ ] 5.4 Exceptions engine
- [ ] 5.5 Service tickets
- [ ] 5.6 Vendors
- [ ] 5.7 Hubs
- [ ] 5.8 Financials
- [ ] 5.9 Reports
- [ ] 5.10 Settings
- [ ] 5.11 Notifications
- [ ] Phase 5 exit check → push

## Phase 6 — Copilot
- [ ] 6.1 Tool layer
- [ ] 6.2 Chat UI
- [ ] 6.3 Evals

## Phase 7 — Vehicle commands
- [ ] 7.1 Virtual-key pairing
- [ ] 7.2 Signed commands
- [ ] 7.3 Command policy + audit
- [ ] 7.4 Wire actions

## Phase 8 — Hardening & launch
- [ ] 8.1 Security  - [ ] 8.2 Performance  - [ ] 8.3 A11y  - [ ] 8.4 Onboarding  - [ ] 8.5 Ops

## Review
_(filled in at the end of each phase)_
