# FleetOS — Data Sources & Tesla Fleet API (verified)

> Roadmap task 0.4 · Status: **accepted** · Research date **2026-09-26**
> Raw research with every source URL: `docs/research/2026-09-26-tesla-and-data-sources.md`. In code, every substitute (simulated, CSV, manual, inferred, static, fixture) is marked with a `SUBSTITUTE(...)` comment; see `CLAUDE.md`.
> Every field FleetOS shows → where it comes from → whether it's **stable** (source available now) or **preview** (placeholder capability, see roadmap §3a). Tesla facts were verified against developer.tesla.com and `teslamotors` GitHub repos on the research date; items still marked *unverified* must be confirmed in Phase 4 against a real vehicle. Re-verify before relying on prices or limits: Tesla changes them.

## 1. Headline findings

1. **The Tesla auth and hosting assumptions were right.** Authorize `https://auth.tesla.com/oauth2/v3/authorize`, token `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token`, regional hosts NA/APAC `fleet-api.prd.na.vn.cloud.tesla.com`, EU `fleet-api.prd.eu.vn.cloud.tesla.com`, CN `fleet-api.prd.cn.vn.cloud.tesla.cn` (separate developer account at developer.tesla.cn).
2. **A business token fits fleet operators.** "Third-party-for-business" tokens cover every vehicle a Tesla-for-Business account owns *or is delegated as Vehicle Manager*, so one consent covers the fleet. Personal OAuth is the fallback for owner-operators.
3. **Streaming needs a virtual key, even read-only.** Fleet Telemetry configs must be signed through the vehicle-command proxy, and the app's virtual key must be on each car. **Virtual-key pairing and the proxy move from Phase 7 to Phase 4.**
4. **It's paid, and streaming is by far the cheapest way to read.** Since 2025-01-01: streaming signals 150,000 / $1, commands 1,000 / $1, device-data requests 500 / $1, wakes 50 / $1; $10/month credit per account. Tesla's own example puts streaming at ~1/18 the cost of 1-minute polling.
5. **There is no sandbox.** Integration testing needs a real Tesla. Phase 4's exit test needs a real car (any model) that Akshat or Atharva can authorise.
6. **Tesla doesn't sell Cybercab fleets yet.** Tesla opened an interest form for "Cybercab fleet vehicle purchasing" on 2026-09-03, with no price, terms or dates. Owner enrolment in Tesla's Robotaxi network has no published commercial terms. See §7 for what this means for the first customers.
7. **There's still no API for rides, earnings, cabin cleanliness, autonomy incidents or dispatch.** Those capabilities stay **preview**. Some partial substitutes exist (§6).
8. **New stable data we didn't plan for:**
   - `GET /api/1/vehicles/{vin}/specs` gives battery state of health and capacity with a partner token, at $0.10 per result. It's useful for lender reports on residual value.
   - The `SelfDrivingMilesSinceReset` telemetry field gives self-driving mileage.

## 2. Tesla Fleet API: verified reference

### 2.1 Access model

| Item | Verified fact | Source |
|---|---|---|
| Registration | Tesla account + MFA → "Request app access" (business details, purpose, scopes) → EC prime256v1 key pair → public key at `https://<app-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem` → partner token → `POST /api/1/partner_accounts` **once per region**. The key must stay hosted, or future pairing breaks. | [What is Fleet API](https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api), [Partner endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints) |
| Domain | `register` domain must match the root of `allowed_origins` set in the developer portal → the **product** domain (Vercel / custom), never the GitHub Pages prototype. | Partner endpoints |
| Token types | **Third-party** (user, auth code) · **Partner** (client_credentials; app config, `specs`) · **Third-party-for-business** (client_credentials + `auth_code` from Tesla-for-Business Consent Management) | [Business tokens](https://developer.tesla.com/docs/fleet-api/authentication/third-party-business-tokens) |
| Business flow | Business onboards at business.tesla.com → Account → Consent Management → Request Consent (our app) → admin approves by email → we read the `auth_code` → exchange at token URL | Business tokens |
| Token lifetimes | Access ≈ 8 h (*unverified on an official page*). Refresh: **single-use**, 3-month expiry; the previous refresh token stays valid 24 h; a new refresh invalidates the prior refresh **and its access tokens**. `401 login_required` = expired / rotated / password reset. | [Third-party tokens](https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens) |
| Token host | All server-to-server token calls **must** use `fleet-auth.prd.vn.cloud.tesla.com` (mandated 2025-07-21). `auth.tesla.com` stays for browser `/authorize` and consent revocation only. | [Announcements](https://developer.tesla.com/docs/fleet-api/announcements) |
| `audience` | Token requests pass the regional Fleet API base URL | Third-party tokens |
| Region lookup | `GET /api/1/users/region` → the user's region + base URL | [User endpoints](https://developer.tesla.com/docs/fleet-api/endpoints/user-endpoints) |
| Revoke | Users revoke at `https://auth.tesla.com/user/revoke/consent?revoke_client_id=…` | Third-party tokens |
| Terms | Request only needed scopes; may not sell personal data; retain data only as long as necessary (Fleet API Agreement: *partially unverified*, legal page not fetchable) | tesla.com/legal |

### 2.2 Scopes (12)

| Scope | Unlocks | FleetOS requests? |
|---|---|---|
| `openid` | Sign in with Tesla | yes |
| `offline_access` | Refresh tokens | yes |
| `user_data` | Profile, contact, address | no (not needed; least privilege) |
| `vehicle_device_data` | Vehicle data, service, nearby chargers | **yes** |
| `vehicle_location` | Location (required since Jan 2025, plus `location_data` in `vehicle_data`) | **yes** |
| `vehicle_charging_cmds` | Charging history/invoices, start/stop/schedule charging | **yes** (history now; commands Phase 7) |
| `vehicle_cmds` | Lock/unlock, wake, remote start, drivers, software updates | Phase 7 only |
| `vehicle_specs` | Specs for any VIN (partner token only) | yes (partner) |
| `vehicle_pricing_info` | Pricing/config by market (partner token only) | no |
| `energy_device_data`, `energy_cmds` | Powerwall / energy sites | no |
| `enterprise_management` | "Enterprise management functions for businesses" (no further public detail) | evaluate in Phase 4 |

### 2.3 Pricing & limits

| Category | Price | Rate limit |
|---|---|---|
| Streaming signals (Fleet Telemetry) | 150,000 / $1 | — (on-change, per signed config) |
| Device data (`vehicle_data` etc.) | 500 / $1 | 60 req/min per vehicle |
| Commands | 1,000 / $1 | 30 req/min per vehicle |
| Wakes | 50 / $1 | 3 req/min per vehicle |
| `specs` | $0.10 per result | — |
| Auth | free | 20 req/s per app |

$10/month credit per developer account. Billing is monthly from the 1st, auto-charged 14 days after month end. The default billing limit is $0, so an **app is disabled until a payment method is added**. Responses ≥ 500 aren't billed. Limits are per vehicle per account, shared across the account's apps; 429s carry `RateLimit-*` headers. Source: [Billing and limits](https://developer.tesla.com/docs/fleet-api/billing-and-limits), [developer.tesla.com pricing](https://developer.tesla.com/#usage-based-pricing).

**Cost estimate for FleetOS streaming** (*estimate*; Tesla's sample config costs ≈ $0.0064 per driving vehicle-hour): a robotaxi active ~20 h/day ≈ 600 h/month → **≈ $4 per vehicle per month**, or ≈ $320/month for 84 cars. The same data by 1-minute polling would be ≈ $72 per vehicle per month. Rule: **never poll `vehicle_data` on a schedule**; use it only to backfill after reconnects or on user demand.

### 2.4 REST endpoints FleetOS uses

| Endpoint | Use | Phase |
|---|---|---|
| `GET /api/1/vehicles` (100/page) | Roster sync, `state` online/asleep/offline | 4 |
| `GET /api/1/vehicles/{vin}` | Vehicle info (location hidden if `granular_access.hide_private`) | 4 |
| `GET /api/1/vehicles/{vin}/vehicle_data?endpoints=charge_state;drive_state;location_data;vehicle_state;climate_state;vehicle_config` | One-off snapshot / backfill only | 4 |
| `POST /api/1/vehicles/fleet_status` (batch VINs) | `vehicle_command_protocol_required`, `total_number_of_keys` (max 20), firmware, telemetry version | 4 |
| `GET /api/1/vehicles/{vin}/recent_alerts` | Alerts `{name, audiences, startedAt, endedAt}`, e.g. `VCFRONT_a361_washerFluidLowMomentary` | 4 |
| `GET /api/1/vehicles/{vin}/service_data` | In-service status (*response shape unverified*) | 4 |
| `GET /api/1/vehicles/{vin}/specs` (partner) | Battery SoH & capacity for reports | 4 |
| `GET /api/1/dx/charging/history`, `/invoice/{id}` | Supercharger energy + cost | 4 |
| `GET /api/1/dx/charging/sessions` | Session pricing (business accounts only) | 4 |
| `POST/GET/DELETE /api/1/vehicles/fleet_telemetry_config` (signed via proxy) | Streaming config | 4 |
| `GET /api/1/partner_accounts/fleet_telemetry_errors` | Telemetry health on Integrations page | 4 |
| `POST /api/1/vehicles/{vin}/wake_up` | Avoid; only for a user-initiated command | 7 |
| `POST /api/1/vehicles/{vin}/command/{name}` / `signed_command` via `tesla-http-proxy` | Commands | 7 |

Response envelope: `{"response": …, "error": "<code>", "error_description": "…", "messages": […]}`. **408 = vehicle unavailable** (even when `online`); retry with backoff and never auto-retry non-idempotent commands (`honk_horn` etc.). After `wake_up`, allow 10–60 s.

### 2.5 Fleet Telemetry

- **Server:** self-hosted `teslamotors/fleet-telemetry` (Docker `tesla/fleet-telemetry`, Helm chart). Vehicles connect over an mTLS WebSocket (default 443) using our full CA chain. It dispatches protobuf (or JSON via `transmit_decoded_records`) to Kafka / Kinesis / Pub/Sub / ZMQ / MQTT / **Redis Pub/Sub** / logger. `reliable_ack_sources` gives at-least-once delivery into the chosen backend. Prometheus metrics.
- **Config:** per vehicle: `hostname`, `port`, `ca`, `fields: {Field: {interval_seconds, minimum_delta?, resend_interval?}}`, `alert_types`, `exp`; `delivery_policy: "latest"`; `include_fields` (firmware ≥ 2026.26.6). **JWS-signed via the vehicle-command proxy**; virtual key required; poll GET until `synced: true`. A vehicle accepts several third-party configs (limit *unverified*, reported as 5).
- **Firmware:** ≥ 2023.20 direct / ≥ 2024.26 via proxy; Model S/X Intel Atom ≥ 2025.20; some fields need newer builds.
- **Streams:** `V` (fields), `alerts` (`name`, `audiences`, `started_at`, `ended_at`; active while `ended_at` unset), `errors` (`name`, `tags`, `body`), `connectivity` (`CONNECTED`/`DISCONNECTED`, `network_interface`).
- **Catalogue:** the `Field` enum has ~270 entries. The ones FleetOS subscribes to are in §3.
- **Deployment decision:** run on Fly.io next to the worker with the **Redis Pub/Sub** dispatcher (Upstash / Fly Redis). That avoids running Kafka at our scale, and fits the Option A stack. Revisit Kafka if we move to AWS.

## 3. FleetOS telemetry subscription (proposed)

| Field(s) | Interval / delta | Feeds |
|---|---|---|
| `Soc`, `BatteryLevel`, `EstBatteryRange` | 60 s, Δ 1% | SOC, low-SOC exceptions, charging readiness |
| `ChargeState`, `DetailedChargeState`, `ACChargingPower`, `DCChargingPower`, `ChargeLimitSoc`, `TimeToFullCharge`, `FastChargerPresent` | 30 s | Charging status, hub occupancy, energy cost |
| `Location` (Δ 50 m), `GpsHeading`, `VehicleSpeed`, `Gear` | 10 s | Map, geofences (hub presence), In Service vs Ready |
| `Odometer` | 300 s, Δ 0.1 mi | Miles, cost per mile, maintenance intervals |
| `DestinationLocation`, `MinutesToArrival` | 60 s | Charging trips to hub, ETA |
| `TpmsPressureFl/Fr/Rl/Rr`, `TpmsHardWarnings`, `TpmsSoftWarnings` | 300 s | Tyre-pressure exceptions |
| `Locked`, `DoorState` | on change | Security; vendor access |
| `InsideTemp`, `OutsideTemp`, `CabinOverheatProtectionMode` | 600 s | Cabin comfort, heat risk (Phoenix) |
| `ServiceMode`, `BMSState`, `IsolationResistance` | on change | Maintenance status, battery faults |
| `SelfDrivingMilesSinceReset`, `MilesSinceReset` | 3600 s | Autonomy mileage (HW4, fw ≥ 2025.44.25.5) |
| `Version`, `SoftwareUpdateAvailable`, `SoftwareUpdateInProgress` | on change | Firmware compliance, planned downtime |
| streams: `alerts`, `errors`, `connectivity` | — | Fault exceptions, Offline status |

**Not available in telemetry:** cabin cleanliness (no field; Tesla uses the interior camera internally and doesn't expose it) and "self-driving engaged" state (only mileage and ADAS toggles).

## 4. Field → source matrix

Legend: **Tesla-S** = Fleet Telemetry stream · **Tesla-R** = Fleet API REST · **Sim** = simulator (stands in for Tesla until connected) · **Native** = FleetOS records · **CSV** = payout import · **Derived** = `kpis.md`. **Tier:** S = stable · P:x = preview capability x.

### 4.1 Vehicle identity & state

| Field | Source | Tier |
|---|---|---|
| VIN, display name, model, firmware | Tesla-R roster / `fleet_status`; Sim | S |
| Vehicle number (e.g. "047"), home hub, commissioned/retired dates | Native | S |
| Operational status (7 states) | Derived (`vehicle-states.md`) from Tesla-S + tickets + exceptions | S |
| Online / asleep / offline | Tesla-S connectivity + Tesla-R `state` | S |
| Location, heading, speed, gear | Tesla-S | S |
| Location name ("Roosevelt Row", "Sky Harbor T4") | Derived: reverse-geocode (Mapbox) + hub/zone geofences | S |
| SOC, range, charging state, charge power, charge limit, time to full | Tesla-S | S |
| Odometer | Tesla-S | S |
| Tyre pressures & warnings | Tesla-S | S |
| Locks, doors, cabin temps | Tesla-S | S |
| Fault alerts (replacing the MVP's "P0A7F") | Tesla-S `alerts` + Tesla-R `recent_alerts` | S |
| Service mode / in Tesla service | Tesla-S `ServiceMode`; Tesla-R `service_data` | S |
| Battery state of health, capacity | Tesla-R `specs` (partner, $0.10) | S |
| Self-driving miles | Tesla-S `SelfDrivingMilesSinceReset` | S |
| Virtual-key paired, telemetry synced | Tesla-R `fleet_status`, `fleet_telemetry_config` GET | S |
| On a trip / accepting rides | [P:dispatch] / [P:rides]; fallback: location vs hub | P:dispatch |

### 4.2 Money

| Field | Source | Tier |
|---|---|---|
| Gross revenue (daily/period) | CSV import (Uber-Fleet-Portal-style layout) + Sim → ledger | S (via CSV) |
| Live per-trip fares, distance, duration | robotaxi platform feed | P:rides |
| Live payouts, platform fee | platform payout API | P:earnings |
| Platform fees (period) | CSV / org-configured take rate × revenue | S |
| Electricity (Supercharger) | Tesla-R charging history / invoices | S |
| Electricity (depot) | energy from Tesla-S charge power × hub tariff (URDB rate at setup) | S |
| Electricity (depot, metered) | OCPP charger meter values | P:charger_telemetry |
| Live time-of-use price | Arcadia / utility API | P:live_tariffs |
| Cleaning, maintenance, roadside costs | Native tickets / vendor jobs | S |
| Insurance, financing allocations | Native org settings | S |
| Maintenance reserve | Native | S |
| Downtime cost, revenue at risk, contribution, margins, rates | Derived | S |

### 4.3 Operations

| Field | Source | Tier |
|---|---|---|
| Exceptions (low SOC, tyre, fault, offline, stuck, overheat) | Derived by rules over Tesla-S | S |
| Cabin cleanliness events (spill, debris, confidence %) | none exposed by Tesla; fallback: manual report, vendor photos | P:cabin_events |
| Autonomy incidents, disengagements, remote assist | none exposed; NHTSA SGO public crash reports are fleet-wide & redacted (context only) | P:autonomy_events |
| Tickets, SLA timers, activity log, attachments | Native | S |
| Vendor ETA / arrival | Native (manual); geofence from Tesla-S location when the vendor is at the car | S |
| Vendor-reported tracking | vendor integration (Agero Provider API pattern) | P:vendor_tracking |
| Hubs: chargers, bays, tariffs, hours | Native | S |
| Hub presence, turnaround | Derived from Tesla-S location + geofences | S |
| Charger occupancy | Derived (vehicles charging at hub) | S |
| Charger occupancy (exact) | OCPP 1.6J/2.0.1 (non-Supercharger; newer Wall Connectors) | P:charger_telemetry |
| Capacity forecast, recommendations | Derived | S |
| Put vehicle on/off the robotaxi network | no API | P:dispatch |

### 4.4 Reporting & admin

| Field | Source | Tier |
|---|---|---|
| Monthly report metrics, grade, covenants | Derived snapshots | S |
| Residual value / asset risk | Tesla-R `specs` SoH + native purchase data | S |
| Incidents per 10K rides | P:autonomy_events + P:rides | P |
| Users, roles, policies, rules, notifications | Native | S |
| Tesla connection, scopes, telemetry errors | Tesla-R partner endpoints | S |

## 5. Preview capabilities: realistic paths to "live"

| Capability | Best candidate source | Likelihood near-term |
|---|---|---|
| `rides`, `earnings` | Tesla robotaxi payouts (no API, no public terms); for human-driven Tesla fleets, **Uber Fleet Portal** CSV exports (trip counts, online hours, earnings per vehicle) | Low (Tesla) / high via CSV |
| `cabin_events` | Tesla only; no third-party access. Fallback: vendor photo evidence + manual reports | Low |
| `autonomy_events` | Tesla only; NHTSA SGO reports for context | Low |
| `dispatch` | Tesla Robotaxi network control; no API | Low |
| `charger_telemetry` | OCPP from depot chargers (not Superchargers) | **Medium–high** if operators install OCPP chargers |
| `live_tariffs` | Arcadia (paid, 25K+ tariffs); URDB (free, annual) gives static rates now | High |
| `vendor_tracking` | Agero Provider API pattern; per-vendor webhooks | Medium |

## 6. Non-Tesla sources

| Source | What it gives | Use | Link |
|---|---|---|---|
| OpenEI **URDB** | Free published tariffs, ~3,700 US utilities (incl. APS, SRP) | Hub tariff setup (stable) | openei.org/wiki/Utility_Rate_Database |
| **Arcadia** (ex-Genability) | Paid tariff modelling + interval/bill data | `live_tariffs` | arcadia.com/platform |
| **OCPP 1.6J / 2.0.1** | Connector status, meter values, sessions | `charger_telemetry` | openchargealliance.org |
| **Agero Provider Software API** | Roadside job status, geofenced on-scene | `vendor_tracking` template | agero.com/integrations |
| **Uber Fleet Portal** reports | CSV: driver/vehicle trips, online hours, earnings | CSV importer template | help.uber.com (Fleet Portal) |
| **NHTSA SGO** | Public ADS crash reports (redacted, periodic) | Context for safety reporting | nhtsa.gov/laws-regulations/standing-general-order-crash-reporting |
| **Mapbox** | Maps, reverse geocoding, geofences | Location names, maps | mapbox.com |

## 7. Market reality (as reported, Sept 2026) and product implication

- First Cybercab built 2026-02-17; Tesla's own Austin fleet started public Cybercab rides 2026-09-04; on 2026-09-03 Tesla opened an interest form for Cybercab fleet purchases (no terms). *(TechCrunch, Electrek, 2026-09-03)*
- Robotaxi network: Austin metro, no safety monitors (2026-06-03). Owner enrolment and revenue share are promised but not published. *(Electrek, TheStreet, tesla.com/support/robotaxi)*
- California: Tesla operates under a charter-party permit, not an AV passenger permit (CPUC, 2026-03). *(Electrek)*
- Comparable operator: **Avomo** runs depot, cleaning, charging and maintenance for Uber–Waymo (Austin, Atlanta) and Uber–WeRide. It's a reference for "operating someone else's AV fleet" and a potential competitor. *(TechCrunch AV deal tracker, 2026-08)*

**Implication:** no third party can own and operate Cybercabs today. Nothing in the architecture needs to change, since FleetOS is provider-agnostic and simulator-first. But the first real customers are likely to be:
1. businesses running **Tesla fleets on human-driven rideshare** (revenue via Uber-style CSV), and
2. **early Cybercab fleet buyers** once Tesla publishes terms.

This doesn't change Phase 1–3 work. It does change who we pilot with in Phase 8. *Flagged for Akshat & Atharva.*

## 8. Roadmap changes from this research

| Change | Where |
|---|---|
| Virtual-key pairing flow + `tesla-http-proxy` deployment move to **Phase 4** (needed to sign telemetry configs) | 4.1a new; 7.1–7.2 become "enable commands on the already-deployed proxy" |
| Auth: **business-token** consent flow first, personal OAuth second; all token calls to `fleet-auth.prd.vn.cloud.tesla.com`; atomic single-use refresh-token storage | 4.2 |
| Scopes: add `vehicle_location` + `location_data`; request `vehicle_charging_cmds` early for history; partner `vehicle_specs` | 4.2 / 4.3 |
| Never schedule `vehicle_data` polling; backfill only | 4.3 |
| Telemetry dispatcher = Redis Pub/Sub on Fly (not Kafka) | 4.4 |
| New stable endpoint `GET /api/v1/vehicles/{id}/battery-health` (from `specs`) | roadmap §3a |
| CSV importer modelled on the Uber Fleet Portal export | 3.6 |
| Hub tariffs seeded from URDB | 5.7 / 5.10 |
| Phase 4 exit needs a real Tesla + payment method on the developer account (no sandbox; $0 default billing limit) | Phase 4 exit |
