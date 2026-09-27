# FleetOS — Product Requirements (PRD)

> Roadmap task 0.1 · Status: **accepted** (recommended defaults, Akshat, 2026-09-26) · 2026-09-26
> Source of truth for *what* FleetOS does. KPI formulas live in `kpis.md` (0.2), vehicle states in `vehicle-states.md` (0.3), field-level sources in `data-sources.md` (0.4), quality bars in `nfr.md` (0.5).

## 1. Problem

Autonomous robotaxis (Tesla Cybercabs) are becoming **financed assets owned by operators**, not by the platform that dispatches rides. The owner earns money only while a car is available and carrying riders. Every hour a car is dirty, low on charge, broken or stuck at a crowded hub costs revenue. Lenders who financed the cars want proof the assets are performing.

Today an operator has to piece this together from the vehicle maker's app, ride-platform payouts, vendor texts and spreadsheets. Nobody sees in one place **which problem is costing the most money right now, who is fixing it, and what it did to each car's profit**.

## 2. Product vision

**FleetOS is the operations control tower for autonomous fleet owners.** It turns vehicle signals into prioritised, money-denominated work, and turns that work into per-vehicle economics and investor-grade reporting.

**Core loop (every feature serves one step):**

```
detect → prioritise by revenue at risk → dispatch vendor → track SLA
      → return to service → post cost to vehicle P&L → roll up to owner & lender reporting
```

**Differentiators**
1. **Money-first operations.** Every issue shows revenue at risk; every fix shows cost and revenue protected.
2. **Per-vehicle unit economics.** Each car has its own P&L, compared to the fleet average.
3. **Lender-grade reporting.** Monthly asset reports with covenant tracking, so FleetOS matters to the people who finance fleets.
4. **Copilot grounded in the fleet's own data.** It recommends actions and says what they're worth.

## 3. Personas

| Persona | Role (MVP example) | Uses FleetOS for | Frequency | Primary screens |
|---|---|---|---|---|
| **Ops Manager** | Runs daily fleet operations (Maya Kim, "Fleet operations") | Triage exceptions, dispatch vendors, keep availability on target | All day | Overview, Exceptions, Service, Fleet, Hubs |
| **Fleet Owner** | Owns the business / P&L (Atlas Mobility) | Is the fleet making money? Which cars, hubs and vendors drag margin down? | Daily–weekly | Overview, Financials, Reports |
| **Hub Lead** | Runs a depot (Downtown, Tempe, Scottsdale) | Chargers, cleaning bays, turnaround, evening capacity crunch | Shift-based | Hubs, Fleet |
| **Finance / Investor Relations** | Reports to lenders & investors | Monthly asset report, covenant compliance, cost analysis, exports | Monthly + ad hoc | Financials, Reports |
| **Org Admin** | Sets up the org | Users & roles, integrations (Tesla), policies, exception rules, notifications | Setup + occasional | Settings |
| **Report Recipient** *(external, read-only)* | Lender / investor | Reads a shared monthly report | Monthly | Shared report link |
| **Vendor Dispatcher** *(Phase 9, optional)* | Cleaning / tow / tire partner | Accept jobs, post ETA, arrival, evidence, invoice | Per job | Vendor portal |

**Roles → permissions** (detailed RBAC matrix in `nfr.md`): `owner`, `admin`, `ops`, `finance`, `viewer`.

## 4. Jobs to be done

| # | When… | I want to… | So that… | Persona |
|---|---|---|---|---|
| J1 | I start a shift | see what needs attention, ranked by money at stake | I fix the most expensive problems first | Ops Manager |
| J2 | a car has a problem | get a recommended response and dispatch the right vendor in one step | the car is back earning sooner | Ops Manager |
| J3 | a vendor is working a job | watch the SLA clock and escalate if it slips | downtime stays predictable | Ops Manager |
| J4 | a hub is about to overflow | move cars or delay charging before it happens | I don't lose evening peak revenue | Hub Lead |
| J5 | I review performance | see which cars, hubs and vendors are losing margin and why | I can act (retire, rebalance, switch vendor) | Fleet Owner |
| J6 | the month closes | produce a lender report with covenant status in minutes | financing stays in good standing | Finance / IR |
| J7 | I onboard | connect vehicles and set policies once | the system detects and routes issues automatically | Org Admin |
| J8 | I have a question about the fleet | ask it in plain language and get a grounded answer with a proposed action | I don't have to dig through five screens | All |

## 5. User stories & acceptance criteria

> Stories without inline criteria have their acceptance criteria in `docs/design/flows.md` §4 (task 1.5). Every story now has testable criteria.

Each story is tagged with its data dependency:
- **[S]** = only needs stable data (sources available now: Tesla-shaped vehicle data from the simulator, FleetOS-native records, CSV imports).
- **[P:capability]** = needs a preview capability. Until that capability is live, the story must show simulated data (demo orgs) or a clear "Connect source" state. Never zero.

### 5.1 Global shell (GL)
- **GL-1 [S]** As any user, I can switch between orgs I belong to.
  - The org switcher lists only my orgs; switching reloads all data for that org; no data from another org is ever visible (RLS-enforced).
- **GL-2 [S]** As any user, I see how fresh the fleet data is.
  - The sidebar shows "Fleet data live · Ns" from the last ingested telemetry; it turns amber after 60 s and red after 5 min without data.
- **GL-3 [S]** As any user, I can open Copilot or jump anywhere with ⌘K / Ctrl+K.
  - The palette searches vehicles (number/VIN), pages and actions; Enter navigates; Esc closes.
- **GL-4 [S]** As any user on a phone, I can open the navigation from a menu button.
  - All pages are usable at 400 px width without horizontal page scroll (tables scroll inside their container).
- **GL-5 [S]** As any user, I see a notification bell with unread critical/high exceptions and ticket updates.

### 5.2 Overview (OV)
- **OV-1 [S]** As an Ops Manager, I see today's fleet KPIs: total vehicles, available, availability % vs target, earning, revenue, contribution, downtime cost, average SOC.
  - Each KPI matches its `kpis.md` formula; each shows its comparison (vs yesterday / target / average); values update live (≤ 15 s).
  - Revenue and contribution use the ledger (CSV + simulated). If revenue for today isn't available, show "Awaiting revenue data" rather than $0. **[P:earnings]** improves this to live values.
- **OV-2 [S]** As an Ops Manager, I see a "Needs attention" queue ranked by revenue at risk.
  - Rows group open exceptions by type (e.g. "14 vehicles below 40% battery"); each shows affected vehicles, revenue at risk, recommended action and a one-click action button that opens the right flow.
  - Sort is by revenue at risk descending; ties broken by severity then detection time.
- **OV-3 [S]** As a Fleet Owner, I see availability over the last 30 days against target, revenue vs operating cost this week, downtime by cause today, and contribution margin by hub.
- **OV-4 [S]** As an Ops Manager, I see fleet health scores (cleanliness, charging readiness, maintenance readiness, vendor SLA compliance, incident-free rides).
  - Cleanliness uses cabin events **[P:cabin_events]**; incident-free rides uses **[P:autonomy_events]** and **[P:rides]**. Without those, show the score as simulated or unavailable.
- **OV-5 [S]** As an Ops Manager, I see the top Copilot recommendation with its projected impact and can review the plan.
  - Opens the plan (e.g. hub rebalancing) with the vehicles involved; applying it creates the underlying actions and logs them.

### 5.3 Fleet list (FL)
- **FL-1 [S]** As an Ops Manager, I see every vehicle with: number, VIN, status, location, hub, SOC, revenue today, contribution, revenue per available hour, downtime, open issue, next action.
  - Server-side pagination (default 25/page); total count shown; "Showing 1–25 of N".
- **FL-2 [S]** I can search by vehicle number, VIN or location and filter by status, hub, SOC band, profitability band and issue type.
  - Filters combine (AND), are reflected in the URL (shareable) and persist on back-navigation.
- **FL-3 [S]** I can choose visible columns and sort by any numeric column.
- **FL-4 [S]** I can export the current filtered view as CSV.
- **FL-5 [S]** As an Org Admin, I can add a vehicle manually (VIN, number, hub) or it appears automatically when connected via Tesla.
  - VIN is validated (17 chars, check digit); duplicate VINs within an org are rejected.
- **FL-6 [S]** Clicking a row opens that vehicle's detail page (not always 047).

### 5.4 Vehicle detail (VD)
- **VD-1 [S]** I see the vehicle's header facts: status, location (with map), SOC, odometer, hub, availability today, revenue today / month, contribution margin, open issues.
- **VD-2 [S]** I can switch between tabs: Overview, Operations, Service history, Financials, Telemetry. Each has its own URL.
- **VD-3 [S]** Financials tab: month-to-date P&L statement (gross revenue, platform fees, electricity, cleaning, maintenance, insurance, downtime cost, financing → net contribution), with lines flagged when ≥ 25% above the fleet average.
- **VD-4 [S]** I see performance indicators vs fleet average: availability, revenue per available hour, cost per revenue mile, cleaning per 1K rides **[P:rides]**, maintenance downtime, incident count.
- **VD-5 [S]** I see today's event timeline (status changes, detections, dispatches, vendor arrival, return to service) with timestamps and sources.
- **VD-6 [S]** For each incident I see its financial impact: downtime, service cost, lost revenue, total, plus revenue recovered by finishing inside SLA.
- **VD-7 [S]** Telemetry tab: time-series charts for SOC, speed, odometer, charging power and tyre pressures over a selectable window.
- **VD-8 [S]** I can create a service ticket directly from the vehicle.

### 5.5 Exceptions (EX)
- **EX-1 [S]** As an Ops Manager, I see all active exceptions with severity, vehicle, type, detection time and place, recommended response, estimated downtime, revenue at risk, owner and status.
  - Summary counts by severity plus "resolved today" and total active revenue at risk; the sidebar badge equals the active count (fixes the MVP's 7-vs-6 mismatch).
- **EX-2 [S]** Exceptions are created automatically by rules over vehicle data (low SOC, tyre pressure, fault alerts, offline/no telemetry, stuck vehicle), and manually.
  - The same condition on the same vehicle doesn't create duplicates while an exception is open; each exception records the rule and the triggering data.
  - Cabin cleanliness **[P:cabin_events]** and autonomy incidents **[P:autonomy_events]** produce exceptions only when those capabilities are live or simulated.
- **EX-3 [S]** I can filter by severity and status and see resolved exceptions.
- **EX-4 [S]** From an exception I can open or create a ticket and dispatch the recommended vendor in one step.
- **EX-5 [S]** As an Org Admin, I can manage exception rules: condition, severity, recommended action, auto-actions (e.g. take out of service), enable/disable.

### 5.6 Service operations (SV)
- **SV-1 [S]** I see service KPIs: active tickets, median response time, SLA compliance (30-day), cost today and revenue protected.
- **SV-2 [S]** A ticket shows: status, type, vehicle, location, detection source, created time, vendor, ETA, estimated vs actual cost, downtime, lost revenue, description, policy reference, attachments and a live SLA countdown.
  - The countdown is computed server-side from the SLA policy; a breach notifies the owner and escalation contacts.
- **SV-3 [S]** I can move a ticket through its lifecycle: assign vendor → escalate → mark arrived → complete service → return to service. Each step is logged with actor and time.
  - "Return to service" updates the vehicle status in FleetOS. Changing availability on the robotaxi network needs **[P:dispatch]**; until then the UI states that the platform-side change is manual.
- **SV-4 [S]** I can upload photos and attachments to a ticket.
- **SV-5 [S]** Vendor ETA and arrival are entered manually; **[P:vendor_tracking]** automates them via vendor integrations or geofence.
- **SV-6 [S]** Completing a ticket posts its actual cost to the vehicle's cost ledger.

### 5.7 Hubs (HB)
- **HB-1 [S]** Each hub shows: vehicles assigned and present, chargers total/occupied, cleaning bays, average turnaround, electricity price per kWh, forecast peak utilisation, daily revenue supported.
  - Charger occupancy is inferred from vehicle charging state at the hub; **[P:charger_telemetry]** makes it exact. Electricity price comes from the hub's configured tariff; **[P:live_tariffs]** makes it live.
- **HB-2 [S]** I see an hourly capacity forecast for today per hub, with the capacity limit marked and overload hours highlighted.
- **HB-3 [S]** When a hub is forecast to exceed capacity, I get a warning with a mitigation plan.
- **HB-4 [S]** I see ranked recommended actions (route N vehicles to another hub, delay non-critical charging, add temporary cleaning capacity) with projected impact, and I can apply them.
  - Applying creates tasks / charge-limit commands (Phase 7) and records the decision; the forecast refreshes.
- **HB-5 [S]** As an Org Admin, I can configure hubs: location, chargers, bays, operating hours, tariff.

### 5.8 Vendors (VN)
- **VN-1 [S]** I see the vendor network with category, service radius, average response, average job cost, SLA compliance, rating, jobs completed and current availability.
  - Metrics are computed from completed jobs in FleetOS, not typed in by hand.
- **VN-2 [S]** I can filter vendors by category.
- **VN-3 [S]** I can add or invite a vendor with categories, service area (map polygon or radius), pricing and SLA terms.
- **VN-4 [S]** When dispatching, vendors are ranked by expected ETA, cost and SLA history for that location and category.
- **VN-5 [S]** A vendor page shows job history, SLA trend and cost trend.

### 5.9 Financials (FN)
- **FN-1 [S]** As a Fleet Owner, I see period KPIs: gross revenue, operating costs, contribution margin, revenue per vehicle, revenue per available hour, cost per revenue mile, downtime cost, maintenance reserve.
  - I can pick the period (presets + custom range). Revenue comes from the ledger (CSV imports / simulated); **[P:earnings]** and **[P:rides]** give live, per-trip detail.
- **FN-2 [S]** I see weekly revenue and contribution, and the operating cost breakdown by category.
- **FN-3 [S]** I get anomaly insights: vehicles or hubs whose contribution deviates significantly from comparable ones, with the main cost drivers.
- **FN-4 [S]** I see a vehicle performance table sorted by attention required, with a performance label (Strong / Monitor / Review).
- **FN-5 [S]** I can export the analysis (CSV; the PDF comes from Reports).
- **FN-6 [S]** As Finance, I can import payout statements (CSV) with column mapping, a validation report and idempotent re-imports.

### 5.10 Reports (RP)
- **RP-1 [S]** As Finance / IR, I can generate the monthly asset performance report for a closed month: executive summary, availability, revenue, contribution, vehicle performance, maintenance, incidents, vendor performance, hub performance, risk indicators.
  - Reports are **snapshots**: numbers don't change after generation; regenerating creates a new version.
- **RP-2 [S]** The report shows covenant metrics against configured thresholds (e.g. uptime > 94%) with pass/fail, and an asset health grade with a documented formula.
- **RP-3 [S]** I can export the report as PDF with FleetOS / org branding.
- **RP-4 [S]** I can share a report via an expiring read-only link to external recipients (lenders).
- **RP-5 [S]** Incident metrics use **[P:autonomy_events]**; until live they are labelled "not yet tracked", not zero.

### 5.11 Settings & integrations (ST)
- **ST-1 [S]** As an Org Admin, I can edit org details: name, region, timezone, currency, fleet targets.
- **ST-2 [S]** I can manage fleet policies (e.g. minimum SOC to stay in service, cleanliness policy CLN-02, auto-remove-from-service rules).
- **ST-3 [S]** I can invite users, assign roles and remove access.
- **ST-4 [S]** I can connect Tesla Fleet API: choose region, authorise via Tesla OAuth, see connection status, scopes, per-vehicle telemetry health and errors, and disconnect.
  - Tokens and keys are never stored in the browser. Commands stay disabled until an admin enables them (Phase 7).
- **ST-5 [S]** I can see the capability status of every data source (live / simulated / unavailable), from `/api/v1/capabilities`.
- **ST-6 [S]** I can configure notifications (in-app, email, Slack) per severity.
- **ST-7 [S]** Billing & plan is a placeholder page in this release.

### 5.12 Copilot (CP)
- **CP-1 [S]** Any user can ask questions in natural language about availability, vehicle economics, exceptions, hubs or vendors, and get an answer grounded in their org's data, with links to the records used.
  - Copilot only sees data the asking user is allowed to see (same RLS).
- **CP-2 [S]** Copilot can propose actions (e.g. a rebalancing plan) with projected impact; actions are never executed without explicit user confirmation.
- **CP-3 [S]** Suggested starter questions are shown; answers stream.
- **CP-4 [S]** Copilot says clearly when data is simulated or unavailable instead of guessing.

## 6. Scope

**In scope for the first production release (end of Phase 5)**
All stories above tagged [S]; preview capabilities served by the simulator in demo orgs; Tesla read-only integration (Phase 4); CSV revenue import; PDF reports.

**Later phases**
- Copilot (Phase 6, stories CP-*)
- Vehicle commands (Phase 7)
- Vendor portal (Phase 9)
- Real sources for preview capabilities as partners allow

**Out of scope (non-goals)**
- Booking or dispatching rides / a rider app
- Payments or payouts to vendors (FleetOS records costs; it doesn't move money)
- Driving or tele-operating vehicles
- Insurance claims processing
- Accounting system of record (FleetOS exports to it)

## 7. Success metrics (for a pilot fleet)

| Metric | Target after 90 days |
|---|---|
| Time from detection to dispatch (median) | < 5 min (MVP shows ~3 min when automated) |
| Fleet availability | +2 pts vs pre-FleetOS baseline |
| Vendor SLA compliance visibility | 100% of jobs tracked in FleetOS |
| Monthly lender report preparation time | < 30 min (from days) |
| Weekly active ops users / seats | > 80% |

## 8. Assumptions & risks

| # | Assumption / risk | Mitigation |
|---|---|---|
| A1 | Tesla Fleet API access for Cybercabs owned by third parties is **unconfirmed** | Simulator-first behind `VehicleProvider`; contact Tesla business development |
| A2 | Ride, earnings, cabin and autonomy data aren't in the Fleet API | Preview capabilities; CSV import for revenue; seek platform partnerships |
| A3 | Operators will share payout statements | CSV importer supports common layouts; column mapping UI |
| A4 | Hub charging is observable from vehicle state | Inference now; OCPP charger integration later (`charger_telemetry`) |
| A5 | The MVP's numbers are illustrative, not a spec | `kpis.md` defines formulas; the simulator seed reproduces the MVP's orders of magnitude |

## 9. Open questions → resolved 2026-09-26

Resolved with these defaults (revisit if a pilot customer changes them): **1** demo org only until a pilot operator is identified; **2** USD and North America only; **3** keep "Atlas Mobility" as the demo org; **4** use the grade formula proposed in `kpis.md` §3.7; **5** reports support configurable covenants: uptime, minimum contribution margin and reserve funded %.

Original questions:

1. **Target customer for the pilot:** a real operator in Phoenix, or a demo org only for now?
2. **Currency and regions:** USD and North America only for the first release?
3. **Branding:** keep "Atlas Mobility" as the demo org name?
4. **Asset health grade:** does Atharva have a formula in mind for the "A−" grade, or should 0.2 propose one?
5. **Covenants:** which covenant metrics besides uptime > 94% should reports support (e.g. minimum contribution margin, reserve funding %)?
