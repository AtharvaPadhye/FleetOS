# Research archive: Tesla Fleet API & data sources (2026-09-26)

> Raw findings from four research agents run for roadmap task 0.4. **This is the evidence file**; the decisions and the field → source matrix are in `docs/requirements/data-sources.md`.
> Caveats: agents read developer.tesla.com, teslamotors GitHub repos and news sites on 2026-09-26. Items marked **UNVERIFIED** could not be confirmed on a primary source. News-based claims (Part D) come from secondary sources and should be re-checked before being quoted to customers. Where agents disagreed, Tesla's own page wins (e.g. the $10 monthly credit, not the $14 a third-party site gave).

---

## A. Registration, authentication, access model, pricing, limits

**1. App registration.** Steps: (1) Tesla account with verified email + MFA; (2) "Request app access" on developer.tesla.com with legal business details, app name, description, purpose and requested scopes; (3) generate an EC secp256r1 / prime256v1 key pair; (4) host the public key at `https://<app-domain>/.well-known/appspecific/com.tesla.3p.public-key.pem` (confirmed exact path); (5) get a partner (client_credentials) token and call `POST /api/1/partner_accounts` once per region. The domain must match the root of `allowed_origins` configured in the portal; the public key must stay hosted, or future vehicle key pairing breaks (announcement 2024-02-02). Related: `GET /api/1/partner_accounts/public_key?domain=` verifies registration; `fleet_telemetry_errors` and `fleet_telemetry_error_vins` live under partner endpoints.
Sources: https://developer.tesla.com/docs/fleet-api/getting-started/what-is-fleet-api · https://developer.tesla.com/docs/fleet-api/endpoints/partner-endpoints · https://developer.tesla.com/docs/fleet-api/announcements

**2. OAuth 2.0.** Authorize `https://auth.tesla.com/oauth2/v3/authorize` (params `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state`, optional `nonce`, `prompt_missing_scopes`, `require_requested_scopes`, `show_keypair_step`). Token `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token` for `authorization_code`, `refresh_token` and `client_credentials`. **2025-07-21:** Tesla mandated moving all server-to-server token calls to `fleet-auth.prd.vn.cloud.tesla.com`, as `auth.tesla.com` became unreliable for token exchange from August 2025. `audience` = the regional Fleet API base URL. Access token ≈ 8 h (`expires_in=28800`), **UNVERIFIED** on an official page (community-corroborated); renew within ~1 min of expiry. Refresh token: single-use, expires after 3 months; the previously used refresh token stays valid up to 24 h; a new refresh token invalidates the prior refresh token **and its access tokens** (2024-02-01 policy). `401 login_required` = expired/rotated refresh token or password reset. OIDC metadata: `https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/thirdparty/.well-known/openid-configuration`. Consent revocation: `https://auth.tesla.com/user/revoke/consent?revoke_client_id=…`.
Sources: https://developer.tesla.com/docs/fleet-api/authentication/overview · https://developer.tesla.com/docs/fleet-api/authentication/third-party-tokens · https://developer.tesla.com/docs/fleet-api/support/faq

**3. Scopes (12).** `openid` (sign in) · `offline_access` (refresh tokens) · `user_data` (contact info, address, profile picture, referrals) · `vehicle_device_data` (live data, service history/scheduling, upgrades, nearby Superchargers, ownership) · `vehicle_location` (precise/coarse location; added Nov 2024, enforced Jan 2025) · `vehicle_cmds` (add/remove driver, Live Camera, unlock, wake, remote start, schedule software updates) · `vehicle_charging_cmds` (charging history/billing/location, start/stop/schedule charging) · `vehicle_specs` (partner token only; specs for any vehicle) · `vehicle_pricing_info` (partner token only; pricing/config/fees) · `energy_device_data` · `energy_cmds` · `enterprise_management` ("enterprise management functions for businesses", no further detail: **UNVERIFIED** beyond the one-liner).
Source: https://developer.tesla.com/docs/fleet-api/authentication/overview#scopes

**4. Regions.** NA + APAC (excl. China) `https://fleet-api.prd.na.vn.cloud.tesla.com`; EU/MEA `https://fleet-api.prd.eu.vn.cloud.tesla.com`; China `https://fleet-api.prd.cn.vn.cloud.tesla.cn` (separate developer account at developer.tesla.cn, +86 phone). `GET /api/1/users/region` returns the user's region and base URL. Billing-enabled countries: NA US/CA/MX/PR; EU 20+; APAC JP/KR/AU/TW/NZ/HK/MO/MY/TH/PH.
Sources: https://developer.tesla.com/docs/fleet-api/getting-started/regions-countries · https://developer.tesla.com/docs/fleet-api/endpoints/user-endpoints

**5. Pricing.** Pay-per-use since 2025-01-01 (free discovery period before). Streaming signals 150,000 / $1 · commands 1,000 / $1 · device data 500 / $1 · wakes 50 / $1 · auth not billed. $10/month credit per account (≈ streaming + 100 commands + 2 wakes/day for 2 vehicles). Monthly billing from the 1st; invoice + CSV in dashboard; auto-charge 14 days after month end; 30 days unpaid → access may be disabled; **default billing limit $0 until a payment method is added (apps auto-disabled)**; no PO billing; ≥ 500 responses not billed; rounded to $0.01.
Sources: https://developer.tesla.com/#usage-based-pricing · https://developer.tesla.com/docs/fleet-api/billing-and-limits

**6. Rate limits** (per device, per account, shared across the account's apps): realtime data 60/min · wakes 3/min · commands 30/min · auth ≤ 20 req/s per app. 429s carry `RateLimit-*-Limit/Remaining/Reset`.
Sources: billing-and-limits · https://developer.tesla.com/docs/fleet-api/getting-started/best-practices · FAQ

**7. Business / fleet accounts.** Token types: third-party (per user, authorization_code) · partner (client_credentials; a business's own fleet or app config) · **third-party-for-business** (client_credentials + `auth_code`; a third-party app acting for a business's whole fleet, no user context). Flow: business onboards at `business.tesla.com/get-started` → Account → Consent Management → Request Consent → selects the app → enters admin email → admin approves by email → developer retrieves `auth_code` from Consent Management → exchanges it at the token URL. One token covers all vehicles the business owns **plus** vehicles delegated via a **Vehicle Manager** relationship. Vehicles without signed-command requirements get the virtual key auto-paired once `partner_accounts` registration completes. No separate named enterprise program found.
Sources: https://developer.tesla.com/docs/fleet-api/authentication/third-party-business-tokens · FAQ

**8. Approval & terms.** Requests can be auto-rejected if the app name exists; access revocable for policy violations. Fleet API Agreement (tesla.com/legal/additional-resources#fleet-api-agreement; page not fetchable, content via search snippets: **partially UNVERIFIED**): request only needed scopes, may not sell personal data, retain data only as long as necessary. **No staging/sandbox environment** (FAQ). Energy installers can't access customer energy products without the owner flow.

**9. Changes 2024–2026.** 2023-10 → 2024-01: legacy REST commands deprecated → signed Vehicle Command protocol; owner API unsupported from April 2024. 2024-08-15: Fleet Telemetry onboarding self-service via the command proxy (no CSR). 2024-11-26 → 2025-01: `vehicle_location` split from `vehicle_device_data`. 2024-11-27: billing announced for 2025-01-01. 2025-07-21: token host migration. 2025-09 / 2025-12 / 2026-09: telemetry expansions (Model S/X Intel Atom, `MilesSinceReset` / `SelfDrivingMilesSinceReset` on HW4 fw ≥ 2025.44.25.5, `include_fields` fw ≥ 2026.26.6). No Cybercab/robotaxi-specific endpoints documented.
Source: https://developer.tesla.com/docs/fleet-api/announcements

---

## B. Vehicle endpoints & commands

Sources: https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints · https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-management · https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-commands · https://developer.tesla.com/docs/fleet-api/virtual-keys/developer-guide · https://github.com/teslamotors/vehicle-command

**1. Endpoints.**

| Endpoint | Method + path | Notes |
|---|---|---|
| list | `GET /api/1/vehicles` | paginated, default 100 |
| vehicle | `GET /api/1/vehicles/{vin}` | location omitted if `granular_access.hide_private=true` |
| vehicle_data | `GET /api/1/vehicles/{vin}/vehicle_data` | live pull; not for polling |
| wake_up | `POST /api/1/vehicles/{vin}/wake_up` | billed |
| fleet_status | `POST /api/1/vehicles/fleet_status` | batch VINs → `vehicle_command_protocol_required`, `total_number_of_keys` (max 20), `firmware_version`, `fleet_telemetry_version`, `discounted_device_data` |
| recent_alerts | `GET /api/1/vehicles/{vin}/recent_alerts` | shape below |
| service_data | `GET /api/1/vehicles/{vin}/service_data` | response shape **UNVERIFIED** |
| nearby_charging_sites | `GET /api/1/vehicles/{vin}/nearby_charging_sites` | |
| drivers | `GET` / `DELETE /api/1/vehicles/{vin}/drivers` | GET owner-only |
| mobile_enabled | `GET /api/1/vehicles/{vin}/mobile_enabled` | |
| release_notes | `GET /api/1/vehicles/{vin}/release_notes` | |
| share invites | `/invitations`, `/invitations/redeem`, `/invitations/{id}/revoke` | max 25/page; single-use, 24 h expiry, max 5 drivers |
| signed_command | `POST /api/1/vehicles/{vin}/signed_command` | generic Vehicle Command Protocol endpoint |
| fleet_telemetry_config | create / get / delete (+ `_jws` variant, "not recommended") | fw ≥ 2023.20 direct, ≥ 2024.26 proxy, ≥ 2025.20 Intel Atom S/X |
| Vehicle Management | eligible_subscriptions, eligible_upgrades, options, pricing, specs, warranty_details, enterprise_payer, enterprise_roles (`/api/1/dx/...`) | **`specs`** (`GET /api/1/vehicles/{vin}/specs`): partner token only, **$0.10/result**, as-sold specs + live `batterySoH`, `batteryCapacityKwh` |
| Charging | `GET /api/1/dx/charging/history`, `/invoice/{id}`, `/sessions` | `sessions` restricted to business fleet-owner accounts |

**2. `vehicle_data`.** `endpoints` values: `charge_state`, `climate_state`, `closures_state` (**UNVERIFIED** as an official name), `drive_state`, `gui_settings`, `location_data`, `vehicle_config`, `vehicle_state`. Key fields: charge_state (battery_level, usable_battery_level, charging_state, charge_rate, charger_power, charge_limit_soc, time_to_full_charge); drive_state (latitude/longitude, heading, speed, shift_state); vehicle_state (locked, df/dr/pf/pr doors, ft/rt, odometer, car_version, sentry_mode, tpms_pressure_fl/fr/rl/rr + soft warnings); climate_state (inside_temp, outside_temp, is_climate_on). Firmware ≥ 2023.38: `location_data` + `vehicle_location` scope required for lat/long (shows a location-sharing icon in the car); withheld if `hide_private=true`.

**3. Sleep/offline.** `state` = `online` / `asleep` / `offline`; check before paid requests. After `wake_up`, 10–60 s to connect. Online doesn't guarantee success: **408 "vehicle unavailable"**. Don't poll `vehicle_data`; use Fleet Telemetry.

**4. Shapes.** `recent_alerts` (via search, moderately verified): `{"alerts":[{"name":"VCFRONT_a361_washerFluidLowMomentary","audiences":["Service","Customer"],"startedAt":"…","endedAt":"…"}],"createdAt":"…","vin":"…"}`. `service_data`: **UNVERIFIED**.

**5. Commands.** ~65 commands at `POST /api/1/vehicles/{vin}/command/{name}` (charge start/stop, charge limit/amps, door lock/unlock, honk, flash lights, navigation requests, climate, remote start, sentry, speed limit, valet, `remote_boombox`, etc.); admin-only `clear_pin_to_drive_admin`, `parental_controls_clear_pin_admin`. When a vehicle requires the Vehicle Command Protocol, all commands must be signed; there is no per-command flag in the docs. "The Vehicle Commands Proxy is not required for most business vehicles and pre-2021 S and X." `tesla-http-proxy` / vehicle-command SDK signs with the app's private key; unsigned commands are rejected with no action. **Virtual key:** EC prime256v1 key pair, public key hosted as above, pairing link `https://tesla.com/_ak/<developer-domain>` (optional `?vin=`) after the user grants `vehicle_device_data`, `vehicle_cmds` or `vehicle_location`. B2B-purchased vehicles get keys auto-added (if < 20 keys and protocol not yet required); others pair in person. Check `fleet_status` key presence before sending, to avoid paying for rejected commands.

**6. Errors.** Envelope `{"response": …, "error": "<enum>", "error_description": "…", "messages": […]}`; 400-family (`invalid_command`, `invalid_field`, `invalid_request`, `invalid_auth_code`, `invalid_redirect_url`, `unsupported_grant_type`); **408 vehicle unavailable**; 422 validation `messages`. Error enum completeness **UNVERIFIED** (errors page 404'd). Retry safety varies per command: `honk_horn` etc. can duplicate on retry.

---

## C. Fleet Telemetry

Sources: https://github.com/teslamotors/fleet-telemetry (README) · raw protos `vehicle_data.proto`, `vehicle_alert.proto`, `vehicle_error.proto`, `vehicle_connectivity.proto` · https://developer.tesla.com/docs/fleet-api/fleet-telemetry · https://developer.tesla.com/docs/fleet-api/endpoints/vehicle-endpoints#fleet-telemetry-config-create

**1. Architecture.** Vehicles push over an **mTLS WebSocket** to a self-hosted server (Go binary or Docker `tesla/fleet-telemetry`; Helm chart). Operator supplies hostname + port (default 443) + full CA chain; `check_server_cert.sh` validates. Dispatchers via `config.json`: Kafka (topics `tesla_V`, `tesla_alerts`, `tesla_errors`, `tesla_connectivity`), Kinesis, Google Pub/Sub, ZMQ, MQTT, **Redis Pub/Sub**, logger. Protobuf by default; `transmit_decoded_records: true` → JSON. `reliable_ack_sources` acks the vehicle only after durable persistence → at-least-once.

**2. Configuration.** `POST/GET/DELETE /api/1/vehicles/fleet_telemetry_config`; body `hostname`, `port`, `ca`, `fields: {Field: {interval_seconds, resend_interval?, minimum_delta?}}`, `alert_types`, `exp`; `minimum_delta` in metres for location; `delivery_policy: "latest"`; `include_fields` (v1.3.0+). GET returns `synced` (poll until true). **Must be JWS-signed via the vehicle-command proxy; the virtual key must be paired first.** Per-vehicle third-party config limit reported as 5 (**UNVERIFIED**). Firmware 2023.20.6+ / 2024.26+ by feature; some fields need 2024.38, 2024.44.25/32, 2025.2.6, 2025.44.25.5 or 2026.32.

**3. Fields.** `Field` enum runs to ≥ 271 (`Cabin48vPortKeepOn`), i.e. ~270 fields (exact count **UNVERIFIED**; placeholder slots exist). Newest (fw 2026.32): `GpsAccuracyMeters`, `LifetimeEnergyChargedKwh`, `BrickSocMinPercent`, `NominalFullPackEnergyKwh`, `GradeEstimatePercent`, `MaxSpeedToReachDestinationMph`, `SoftwareUpdateAvailable/InProgress`, `RemoteStartActive`.

| Group | Fields |
|---|---|
| Battery/charging | Soc, BatteryLevel, EstBatteryRange, IdealBatteryRange, ChargeState, DetailedChargeState, ACChargingPower, DCChargingPower, ChargeLimitSoc, TimeToFullCharge, FastChargerPresent, ChargePortDoorOpen, ChargingCableType, EstimatedHoursToChargeTermination, ChargeRateMilePerHour, LifetimeEnergyChargedKwh |
| Location/motion | Location, GpsHeading, GpsAccuracyMeters, VehicleSpeed, Gear, Odometer, DestinationLocation, OriginLocation, RouteLastUpdated, RouteLine, MilesToArrival, MinutesToArrival, GradeEstimatePercent |
| Body/cabin | Locked, DoorState, Fd/Fp/Rd/RpWindow, InsideTemp, OutsideTemp, CabinOverheatProtectionMode/TemperatureLimit, HvacACEnabled/AutoMode/FanSpeed, SentryMode, ValetModeEnabled |
| Occupancy | DriverSeatBelt, PassengerSeatBelt, DriverSeatOccupied (**no cleanliness field**) |
| Tyres | TpmsPressureFl/Fr/Rl/Rr, TpmsLastSeenPressureTime*, TpmsHardWarnings, TpmsSoftWarnings |
| Diagnostics | ServiceMode, BMSState, Hvil, IsolationResistance (+ alert/error streams) |
| Software | Version, SoftwareUpdateVersion, SoftwareUpdateDownload/InstallationPercentComplete, SoftwareUpdateScheduledStartTime, SoftwareUpdateAvailable/InProgress |
| Autonomy-adjacent | MilesSinceReset, SelfDrivingMilesSinceReset, CruiseSetSpeed, CruiseFollowDistance, ForwardCollisionWarning, LaneDepartureAvoidance, AutomaticEmergencyBrakingOff, AutomaticBlindSpotCamera (**no "self-driving engaged" field**) |

**4. Streams.** Alerts: `VehicleAlert{name, audiences (Customer/Service/ServiceFix), started_at, ended_at}`; active while `ended_at` unset. Errors: `VehicleError{created_at, name, tags map, body}`. Connectivity: `{vin, connection_id, status CONNECTED/DISCONNECTED, created_at, network_interface}`.

**5. Cost.** Tesla doc example ≈ $0.00636–0.00667 per vehicle-hour streamed vs ≈ $0.12 per vehicle-hour polling at 1-min cadence (~18× cheaper). "Fleet Telemetry eliminates the need to poll `vehicle_data`." (The $14 monthly credit a third-party site reported is superseded by Tesla's own $10.)

**6. Operations.** At-least-once via `reliable_ack_sources`; dispatcher buffering tunable (Kafka default 1,000,000 messages); vehicle-side offline buffering, latency and max vehicles per server **UNVERIFIED**; Prometheus/StatsD metrics, optional per-VIN tracking and `message_limit`.

---

## D. Cybercab status & alternative sources

**1. Cybercab sales.** First production Cybercab at Giga Texas 2026-02-17; Tesla's Austin fleet began public Cybercab rides 2026-09-04; on 2026-09-03 Tesla published an interest form for "Cybercab fleet vehicle purchasing", mobility hubs and infrastructure partners (name/email/company/region only; no price, contract, delivery date or minimum order). *Implication: no purchasable Cybercab fleet yet.*
Sources: https://techcrunch.com/2026/09/03/tesla-is-asking-people-if-they-want-to-buy-cybercab-fleets/ · https://electrek.co/2026/09/03/tesla-opens-search-for-cybercab-fleet-sales-but-fsd-owners-are-still-left-out/ · https://www.notateslaapp.com/news/4672/you-can-now-let-tesla-know-you-want-to-buy-a-cybercab

**2. Robotaxi network.** Full Austin metro 2026-06-03, no in-car safety monitors (~20 vehicles reported). Owner add/remove via app with a 25–30% Tesla cut has been stated publicly, but **no binding commercial terms published**; reports say the owner payday hasn't materialised. *Implication: any revenue-share % in FleetOS is user-entered config.*
Sources: https://electrek.co/2026/03/25/california-regulator-confirms-tesla-not-operating-autonomous-vehicle-service/ · https://www.thestreet.com/automotive/robotaxi-payday-tesla-promised-owners-isnt-coming · https://www.tesla.com/support/robotaxi

**3. Robotaxi APIs.** No trips, earnings, dispatch, cabin-camera or incident endpoints on developer.tesla.com. The Tesla app reportedly shows self-driving/earning status to enrolled owners; the cabin camera gates dispatch internally and **isn't exposed**. *Implication: earnings/trips/cleanliness need CSV or manual input; scraping the app is fragile and a terms risk.*
Sources: https://developer.tesla.com/docs/fleet-api · https://www.teslarati.com/tesla-app-update-sefl-driving-robotaxi/ · https://robotaxidepot.com/robotaxi-calculator/ (secondary, **UNVERIFIED**)

**4. Regulatory data.** NHTSA SGO 2021-01 crash reports are public and periodic (e.g. July 2026 filing: 2 Texas incidents, not at fault); Tesla stopped redacting narratives in May 2026. CPUC (2026-03): Tesla holds a charter-party permit, not an AV passenger permit, so no CPUC quarterly AV data for Tesla. No structured TX/AZ robotaxi dataset found.
Sources: https://www.nhtsa.gov/laws-regulations/standing-general-order-crash-reporting · https://www.cpuc.ca.gov/regulatory-services/licensing/transportation-licensing-and-analysis-branch/autonomous-vehicle-programs/quarterly-reporting · https://teslanorth.com/2026/08/17/tesla-robotaxi-nhtsa-zero-crashes-june-july-2026/

**5. Chargers.** OCPP 1.6J / 2.0.1: connector status, meter values, sessions. Newer (Gen 4) Wall Connectors gaining OCPP 1.6; Gen 3 no. Superchargers closed (no OCPP/OCPI/API, including Supercharger for Business). *Implication: depot telemetry only with OCPP chargers; Supercharger energy comes from Fleet API charging history.*
Sources: https://github.com/evcc-io/evcc/discussions/15588 · https://theevreport.com/tesla-opens-supercharger-network-to-third-party-business-hosts · https://www.amproad.ca/blogs/ev-home-charger/why-doesnt-tesla-use-ocpp

**6. Tariffs.** OpenEI URDB: free, ~3,700 US utilities, annual updates, includes AZ. Arcadia Arc (ex-Genability): paid, 25K+ tariffs, bills/interval data. UtilityAPI: per-account bill/usage pulls. SRP publishes TOU rate books; APS via aggregators.
Sources: https://openei.org/wiki/Utility_Rate_Database · https://www.arcadia.com/platform · https://utilityapi.com/docs/api/bills

**7. Vendors.** Agero Provider Software API integrates tow/dispatch software (e.g. Towbook), geofence "on-scene", job status in Swoop. Honk/Urgently: no documented public API (Agero announced acquiring Urgently, ~$280M, 2026). No standard API for mobile cleaning.
Sources: https://blog.agero.com/product-feature-dispatch-software-api · https://www.agero.com/integrations

**8. Payout statements.** Uber Fleet Portal Reports tab: on-demand CSV with driver- and vehicle-level trip counts, online hours and earnings. Uber for Business monthly CSVs. Waymo–Uber Austin/Atlanta ops run by **Avomo** (cleaning, maintenance, charging, depots; also Uber–WeRide Madrid). No Lyft partner CSV spec found.
Sources: https://help.uber.com/en/driving-and-delivering/article/managing-your-fleet-with-fleet-portal · https://help.uber.com/business/article/reporting---csv · https://techcrunch.com/2026/08/01/ubers-autonomous-vehicle-deal-tracker/
