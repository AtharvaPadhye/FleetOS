# ADR-0005: VehicleProvider adapter; simulator first

- **Status:** Accepted
- **Date:** 2026-09-26

## Context
There is no Tesla access yet, no sandbox exists, and Cybercab fleets can't be bought. The product must be fully usable without Tesla.

## Decision
- `packages/providers` defines a `VehicleProvider` interface (`listVehicles`, `getSnapshot`, `streamTelemetry`, `sendCommand`, `capabilities`) and a normalised, Tesla-shaped `VehicleSnapshot` / telemetry event.
- Implementations: `SimulatorProvider` (seeded, deterministic, 84 Cybercabs, 3 Phoenix hubs) and `TeslaProvider` (Phase 4). Both pass the same contract-test suite.
- Each org has one provider per fleet; demo orgs use the simulator.
- The simulator is marked with `SUBSTITUTE(tesla, simulated)` at its seam (ADR-0012).

## Consequences
- Every screen works end to end from Phase 3.
- Simulator realism matters: it must emit Tesla-shaped data including sleep, 408s, reconnects, duplicates and late events.

## Alternatives rejected
- Build against Tesla first: blocked on access and a real car.
- Hand-written static fixtures: can't exercise live flows.
