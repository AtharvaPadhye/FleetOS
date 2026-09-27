# FleetOS — KPI Dictionary

> Roadmap task 0.2 · Status: **accepted** (recommended defaults, Akshat, 2026-09-26) · 2026-09-26
> Every number FleetOS shows is defined here. Implementations live in `packages/domain/src` (`time.ts`, `money.ts`, `service.ts`, `scores.ts`; task 3.1) (task 3.1) and are unit-tested against the worked examples in §6. If code and this file disagree, this file wins until it's amended.

## 1. Conventions

| Topic | Rule |
|---|---|
| Time zone | All "today", "this week", "month" boundaries use the **org's time zone** (e.g. America/Phoenix). |
| Operating day | 00:00–24:00 local. Robotaxis can run 24 h, so the default **service window** is 24 h; an org can narrow it in Settings (it then applies to all hour-based KPIs). |
| Fleet membership | A vehicle counts from its `commissioned_at` until `retired_at`. Vehicles outside that range are excluded everywhere. |
| Money | Stored as integer cents in the org's currency (USD first). Displayed rounded to whole dollars except per-hour / per-mile rates (2 dp). |
| Percentages | Stored as ratios (0–1); displayed with 1 dp. "pts" = percentage points. |
| Comparisons | "vs yesterday" = same KPI for the previous operating day up to the same local time; "vs last Tue" = same weekday last week, same cut-off; "30-day avg" = trailing 30 complete days. |
| Baselines | "Fleet avg" for per-vehicle comparisons = mean over active vehicles in the same period, excluding the vehicle itself. |
| Freshness | A vehicle's state is **fresh** if its last telemetry is < 5 min old. Stale vehicles are counted in totals but excluded from SOC averages and flagged. |
| Data dependency | **[S]** = computable from stable sources. **[P:x]** = needs preview capability `x`; until live, show it simulated (demo orgs) or "not yet tracked", **never 0**. |

## 2. Vehicle-time accounting (foundation for all hour-based KPIs)

Every minute of every commissioned vehicle inside the service window is assigned **exactly one status** from the state machine (`vehicle-states.md`, task 0.3):

| Status | Class | Counts as |
|---|---|---|
| In Service | available | available, earning |
| Ready | available | available, idle |
| Charging | planned downtime | unavailable |
| Cleaning | planned downtime | unavailable |
| Maintenance | unplanned downtime | unavailable, not up |
| Incident | unplanned downtime | unavailable, not up |
| Offline | unplanned downtime | unavailable, not up |

Definitions used below:
- **Scheduled hours** `H_sched` = Σ vehicle-hours inside the service window.
- **Available hours** `H_avail` = Σ hours in {In Service, Ready}.
- **Earning hours** `H_earn` = Σ hours in In Service.
- **Downtime hours by cause** = Σ hours per unavailable status.
- **Unplanned downtime hours** `H_unplanned` = Maintenance + Incident + Offline.

## 3. KPI definitions

### 3.1 Availability & utilisation

| KPI | Formula | Unit | Source | Shown on |
|---|---|---|---|---|
| **Total vehicles** | count of commissioned, non-retired vehicles | # | [S] | Overview, Fleet |
| **Available now** | count of vehicles currently In Service or Ready | # | [S] | Overview, Fleet |
| **Earning now** | count currently In Service | # | [S] | Overview |
| **Status counts** | count per status now (all 7, incl. Incident) | # | [S] | Fleet mini-stats |
| **Fleet availability** (period) | `H_avail / H_sched` | % | [S] | Overview (today, 30-day trend), Vehicle, Reports |
| **Availability target** | org setting (default 92%) | % | native | Overview |
| **Fleet uptime** (period) | `1 − H_unplanned / H_sched` (planned charging & cleaning don't count against uptime) | % | [S] | Reports (covenant) |
| **Downtime by cause** | downtime hours per unavailable status | h | [S] | Overview donut |
| **Utilisation** | `H_earn / H_avail` | % | [S] | Financials, Hubs |
| **Average SOC** | mean SOC of fresh vehicles | % | [S] | Overview |
| **Low-SOC count** | fresh vehicles with SOC < policy threshold (default 40%) | # | [S] | Overview, Exceptions |

### 3.2 Revenue, cost & contribution

**Ledger categories.** Every money line is either revenue or one cost category:

| Category | Type | Examples | Source |
|---|---|---|---|
| Gross ride revenue | revenue | fares | CSV import / simulator; live via [P:earnings], per-trip via [P:rides] |
| Platform fees | variable cost | network take rate | CSV / simulator; [P:earnings] |
| Electricity | variable cost | charging sessions × tariff | [S] charging sessions × hub tariff; [P:live_tariffs] |
| Cleaning | variable cost | vendor cleaning jobs | [S] tickets |
| Maintenance & repairs | variable cost | parts, labour, diagnostics | [S] tickets |
| Roadside & recovery | variable cost | tow, tire response | [S] tickets |
| Other variable | variable cost | tolls, parking | [S] manual / CSV |
| Insurance | fixed allocation | policy premium ÷ vehicle-days | [S] org settings |
| Financing | fixed allocation | loan / lease payment ÷ vehicle-days | [S] org settings |

| KPI | Formula | Unit | Source |
|---|---|---|---|
| **Gross revenue** | Σ gross ride revenue in period | $ | see ledger |
| **Variable operating costs** | Σ all variable-cost categories | $ | ledger |
| **Contribution** | Gross revenue − variable operating costs | $ | derived |
| **Contribution margin** | Contribution ÷ gross revenue | % | derived |
| **Fixed allocations** | insurance + financing for the vehicle-days in period | $ | derived |
| **Net vehicle contribution** | Contribution − fixed allocations | $ | derived (Vehicle P&L bottom line) |
| **Revenue per vehicle** | Gross revenue ÷ average fleet size in period | $ | derived |
| **Revenue per available hour** | Gross revenue ÷ `H_avail` | $/h | derived |
| **Contribution per available hour** | Contribution ÷ `H_avail` | $/h | derived (Reports) |
| **Cost per revenue mile** | Variable operating costs ÷ revenue miles (miles with a rider on board) | $/mi | [P:rides]; fallback: ÷ total odometer miles, labelled "per mile" |
| **Maintenance reserve** | reserve per vehicle (org setting) × fleet size; funded % = reserve balance ÷ required | $ / % | native |

**Downtime cost is an opportunity cost, reported separately and never subtracted from contribution.** Lost revenue is already missing from gross revenue; subtracting it again would count it twice.

| KPI | Formula | Unit |
|---|---|---|
| **Baseline rate** `r(v, t)` | trailing-28-day revenue per available hour for the vehicle's hub and hour-of-week; falls back to hub average, then fleet average when history is thin | $/h |
| **Downtime cost** (period) | Σ over unavailable minutes of `r(v, t) / 60` | $ |
| **Revenue at risk** (open exception) | expected remaining downtime × `r(v, now)`; for grouped rows (e.g. 14 low-SOC cars), the sum over vehicles | $ |
| **Expected remaining downtime** | vendor ETA + median service duration for that exception type & hub (trailing 90 days); if no vendor yet, median total resolution time for the type | h |
| **Incident financial impact** | service cost + downtime cost for that incident | $ |
| **Revenue recovered** | max(0, SLA target duration − actual duration) × `r(v, t)` | $ |

An **economic view** toggle on the Vehicle P&L may show "Net contribution after opportunity cost" = net vehicle contribution − downtime cost, clearly labelled as economic, not accounting.

### 3.3 Service & vendors

| KPI | Formula | Unit | Source |
|---|---|---|---|
| **Active tickets** | tickets not in {completed, cancelled} | # | [S] |
| **Response time** (ticket) | vendor arrival − dispatch time | min | [S] manual; [P:vendor_tracking] |
| **Median response** | median response time, trailing 30 days | min | [S] |
| **SLA met** (ticket) | completion time ≤ created time + SLA target for its policy | bool | [S] |
| **SLA compliance** | tickets with SLA met ÷ completed tickets, trailing 30 days (per fleet or per vendor) | % | [S] |
| **Service cost today** | Σ actual (or estimated if pending) cost of tickets opened today | $ | [S] |
| **Revenue protected today** | Σ revenue recovered for tickets completed today | $ | [S] |
| **Vendor average job cost** | mean actual cost of completed jobs, trailing 90 days | $ | [S] |
| **Vendor rating** | mean of ops-user ratings (1–5) on completed jobs | ★ | [S] |

### 3.4 Quality & safety

| KPI | Formula | Unit | Source |
|---|---|---|---|
| **Cleaning per 1K rides** | cleaning tickets ÷ rides × 1,000 | ratio | [P:rides]; fallback per 1K earning hours, labelled |
| **Incidents per 10K rides** | autonomy incidents ÷ rides × 10,000 | ratio | [P:autonomy_events] + [P:rides] |
| **Median incident recovery** | median(return to service − detection) for Incident-status episodes | min | [S] |
| **Maintenance days per vehicle** | Maintenance hours ÷ 24 ÷ average fleet size | days | [S] |

### 3.5 Fleet health scores (Overview)

| Score | Formula | Source |
|---|---|---|
| **Cleanliness** | rides without a cabin event ÷ rides | [P:cabin_events] + [P:rides] |
| **Charging readiness** | fresh vehicles with SOC ≥ policy minimum projected at the next peak ÷ fresh vehicles | [S] |
| **Maintenance readiness** | vehicles not in Maintenance and without an open maintenance exception ÷ total | [S] |
| **Vendor SLA compliance** | = SLA compliance (§3.3) | [S] |
| **Incident-free rides** | 1 − incidents ÷ rides | [P:autonomy_events] + [P:rides] |

### 3.6 Hubs

| KPI | Formula | Source |
|---|---|---|
| **Assigned / present** | vehicles whose home hub is H / vehicles currently inside H's geofence | [S] |
| **Chargers occupied** | vehicles at H with charging state = Charging | [S] inferred; [P:charger_telemetry] exact |
| **Average turnaround** | mean(time leaving hub − time arriving) for visits in trailing 7 days | [S] |
| **Electricity price** | hub's configured tariff for the current hour | native; [P:live_tariffs] |
| **Forecast utilisation** (hour h) | projected charger demand in h ÷ chargers at H (demand from SOC-drain projection of vehicles expected to need charge) | [S] derived |
| **Peak forecast utilisation** | max over today's remaining hours | [S] |
| **Daily revenue supported** | today's gross revenue of vehicles assigned to H | derived |

### 3.7 Scores, labels and grades

| Item | Rule (proposed, needs sign-off) |
|---|---|
| **Vehicle performance label** | **Strong**: margin ≥ fleet avg + 5 pts *and* availability ≥ target. **Review**: margin ≤ fleet avg − 10 pts *or* availability < target − 5 pts. Otherwise **Monitor**. |
| **Line flag** (Vehicle P&L) | a cost line per ride (or per earning hour) ≥ 25% above the fleet average is flagged with "+N% above avg". |
| **Anomaly insight** | vehicle or hub whose contribution margin z-score vs its cohort (same hub, same age band ±3 months) ≤ −1.5; the insight names the cost categories explaining ≥ 70% of the gap. |
| **Asset health grade** | weighted score 0–100: uptime vs covenant 30%, contribution margin vs target 25%, reserve funded % 15%, incident rate 15% (redistributed if not tracked), vendor SLA 15%. Component scores (linear, clamped 0–100; defined in task 3.1): **uptime** 0 at covenant − 2 pts → 100 at covenant + 3 pts · **margin** 0 at target − 20 pts → 100 at target · **reserve** funded % capped at 100 · **incidents** 100 at ≤ target → 0 at 3× target · **vendor SLA** 0 at 80% → 100 at 95%. Letters: A ≥ 90, A− ≥ 85, B+ ≥ 80, B ≥ 75, B− ≥ 70, C ≥ 60, else D. Example: the MVP's August figures (uptime 97.2% vs 94%, margin 54.1% vs 50% target, reserve 118%, 2.1 incidents/10k vs 2.5, vendor SLA 93%) score ≈ 98 → **A** (the MVP showed A−, illustrative). |
| **Covenant status** | each configured covenant (metric, operator, threshold) → pass / at risk (within 1 pt / 5%) / breach. Default: uptime > 94%. |

## 4. MVP inconsistencies and how this dictionary resolves them

| # | In the MVP | Resolution |
|---|---|---|
| 1 | Exceptions summary counts 7 active (1+3+3), but only 6 cards are listed | Counts and badge are computed from the same query as the list. |
| 2 | "Incident" status appears in the fleet table (car 074) but not in the Fleet mini-stats | Status counts cover all 7 statuses. |
| 3 | Car 052's revenue at risk is $128 on Overview but $238 on Exceptions | One formula (§3.2); both screens read the same value. |
| 4 | **Contribution means two things.** Fleet financials: revenue − operating costs, *excluding* insurance & financing (52.8%). Vehicle 047 statement: also subtracts insurance, financing *and* downtime (26.8%). | Contribution = revenue − variable costs everywhere. The vehicle P&L then shows fixed allocations → net vehicle contribution. Downtime is opportunity cost, shown as a memo line, not subtracted. |
| 5 | Financials cost breakdown includes "Downtime 16%" as an operating cost | Removed from operating costs (it's opportunity cost); shown next to them. |
| 6 | Availability 90.5% (Overview) vs uptime 97.2% (Reports) look contradictory | Two defined metrics: availability counts planned charging/cleaning as down; uptime doesn't. |
| 7 | Report "contribution / available hour $18.41" at 54.1% margin implies ~$34 revenue / available hour, but Financials shows ~$23 | MVP figures are illustrative; the simulator seed will produce mutually consistent values. |
| 8 | Fault "P0A7F" is a generic OBD-II code | Faults use Tesla alert names from `recent_alerts` / telemetry. |
| 9 | MVP VINs (e.g. `7G2CEHED8RA004047`) fail the ISO 3779 check digit (should be `…ED9RA…`) | VINs are validated including the check digit (`packages/domain/src/vin.ts`); the simulator mints valid VINs in the same style. |
| 10 | Revenue per available hour ($23.12) × ~21 available hours implies ~$480 per car per day, but the MVP's daily revenue is $18,420 / 84 ≈ $219 per car | The simulator is calibrated to revenue per available hour (~$20/h, the rate used in the worked examples); a 24 h fleet then earns ~$460 per car per day. Pilot data decides the real figure. |

*(Correction to the roadmap inventory: "76 available / 68 earning" is consistent: 68 In Service + 8 Ready = 76; 84 − 76 = 8 = 4 Charging + 2 Cleaning + 1 Maintenance + 1 Offline.)*

## 5. Impact of resolution #4 on the MVP's flagship example

Car 047's month-to-date statement under these definitions:

| Line | MVP | This dictionary |
|---|---|---|
| Gross revenue | $7,940 | $7,940 |
| Platform fees, electricity, cleaning, maintenance | −$3,440 | −$3,440 |
| **Contribution** | — | **$4,500 (56.7%)** |
| Insurance + financing (fixed allocations) | −$1,629 | −$1,629 |
| **Net vehicle contribution** | — | **$2,871 (36.2%)** |
| Downtime cost | −$741 (subtracted) | $741 memo (opportunity cost) |
| MVP bottom line | $2,130 (26.8%) | economic view: $2,130 |

The insight that "cleaning and downtime drag 047 down" survives: cleaning is flagged +38% vs average, availability is 81% vs 90.5%, and the economic view reproduces the MVP's $2,130. The headline accounting margin is higher, and correct.

## 6. Worked examples (become unit tests in task 3.1)

**E1. Fleet month to date (MVP Financials):** revenue $548,320; variable costs $258,916 → contribution $289,404; margin 52.78% → **52.8%** ✓; cost share 47.2% ✓. Revenue per vehicle = 548,320 ÷ 84 = **$6,528** ✓. Reserve = $612 × 84 = **$51,408** ✓.

**E2. Overview today:** revenue $18,420, contribution $9,860 → margin **53.5%** ✓ (variable costs $8,560). Available now = 68 In Service + 8 Ready = **76** of 84 ✓.

**E3. Availability (time-weighted):** 84 vehicles × 10 h so far today = 840 scheduled h; downtime 11.4 h (MVP donut: charging 3.8, maintenance 3.1, incidents 2.6, cleaning 1.9) → availability = (840 − 11.4) ÷ 840 = **98.6%** so far today. The MVP's 90.5% equals the point-in-time ratio 76 ÷ 84, so the Overview must label which one it shows: **"Available now 90.5%"** (point in time) vs **"Availability today 98.6%"** (time-weighted). Both are defined; the UI shows the time-weighted figure with the snapshot as the sub-label.

**E4. Uptime (same day):** unplanned = maintenance 3.1 + incidents 2.6 = 5.7 h → uptime = 1 − 5.7 ÷ 840 = **99.3%**.

**E5. Revenue at risk, car 052 (roadside):** baseline r = $23.12/h, expected remaining downtime = tow ETA 0.3 h + median recovery 5.2 h = 5.5 h → **$127** (MVP Overview shows $128).

**E6. Incident impact, car 047 cleaning:** downtime 47 min × ($40.98/h peak-hour baseline) = $32.10 lost revenue + $18 service cost = **$50.10** ✓ (MVP: $50). SLA target 60 min, actual 47 min → revenue recovered = 13 min × $40.98/h = **$8.88** (MVP: $9.10, illustrative).

**E7. Vehicle P&L, car 047:** see §5.

## 7. Open questions → resolved 2026-09-26

Resolved with the recommended defaults: **1** yes, contribution = revenue − variable costs; **2** grade weights as proposed; **3** 24 h default service window, configurable per org; **4** 40% low-SOC threshold at org level (per-hub override later); **5** 28-day hour-of-week baseline with hub → fleet fallback.

Original questions:

1. **Resolution #4** (contribution excludes fixed costs and opportunity cost): agree? *Recommended: yes.*
2. **Asset health grade weights** in §3.7: acceptable as a starting point?
3. **Default service window** 24 h, or do operators run shifts (e.g. 05:00–01:00)?
4. **Low-SOC threshold** default 40%: keep, or make it per hub?
5. **Baseline window** 28 days by hour-of-week: OK for a young fleet with little history (falls back to hub, then fleet averages)?
