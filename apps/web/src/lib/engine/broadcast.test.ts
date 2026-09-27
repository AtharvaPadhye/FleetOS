import { describe, expect, it } from "vitest";
import { emptyLive } from "@fleetos/engine";
import { statePatches, statusMessages } from "./broadcast";

describe("statePatches", () => {
  const base = { ...emptyLive("a"), status: "ready" as const, soc: 0.8123, location: { lat: 33.1234567, lng: -112.1 } };
  it("sends only the fields that changed, rounded to what the UI shows", () => {
    const after = { ...base, soc: 0.7991, speedMps: 11.26 };
    expect(statePatches(new Map([["a", base]]), [after])).toEqual([{ vehicle_id: "a", soc: 0.799, speed_mps: 11.3 }]);
  });
  it("skips vehicles with no visible change (sub-rounding jitter included)", () => {
    expect(statePatches(new Map([["a", base]]), [{ ...base, soc: 0.81226 }])).toEqual([]);
  });
  it("sends every field for a vehicle it hasn't seen before", () => {
    const [patch] = statePatches(new Map(), [base]);
    expect(Object.keys(patch!).sort()).toEqual(
      [
        "charge_state",
        "current_hub_id",
        "last_telemetry_at",
        "location",
        "soc",
        "speed_mps",
        "status",
        "vehicle_id",
      ].sort(),
    );
  });
});

describe("statusMessages", () => {
  it("matches the api.md §4 status_changed payload", () => {
    expect(
      statusMessages([
        {
          vehicleId: "a",
          from: "ready",
          to: "charging",
          at: new Date("2026-09-27T12:00:00Z"),
          causeType: "telemetry",
          detail: "x",
        },
      ]),
    ).toEqual([
      { vehicle_id: "a", from: "ready", to: "charging", at: "2026-09-27T12:00:00.000Z", cause_type: "telemetry" },
    ]);
  });
});
