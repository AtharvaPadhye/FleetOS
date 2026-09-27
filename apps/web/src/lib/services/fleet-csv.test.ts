import { describe, expect, it } from "vitest";
import { FLEET_CSV_HEADER, fleetCsv } from "./fleet-csv";

describe("fleetCsv", () => {
  it("writes dollars with 2 decimals, blanks for missing values, and escapes text", () => {
    const csv = fleetCsv([
      {
        number: "047",
        display_name: 'Cybercab "047", Tempe',
        vin: "7G2CEHED9RA004047",
        home_hub: { name: "Tempe" },
        profitability: "strong",
        state: {
          status: "in_service",
          soc: 0.806,
          location_name: "On the road",
          last_telemetry_at: "2026-09-27T12:00:00.000Z",
          fresh: true,
        },
        today: {
          revenue_cents: 31840,
          contribution_cents: 25472,
          revenue_per_available_hour_cents: null,
          downtime_min: 12,
        },
      },
      {
        number: "048",
        vin: "7G2CEHED0RA004048",
        home_hub: null,
        open_issue: { title: "No data from vehicle", type: "no_telemetry", severity: "high" },
        next_action: "Check connectivity",
        state: { status: "offline", soc: null, last_telemetry_at: null, fresh: false },
      },
    ]).split("\r\n");
    expect(csv[0]).toBe(FLEET_CSV_HEADER.join(","));
    expect(csv[1]).toBe(
      '047,"Cybercab ""047"", Tempe",7G2CEHED9RA004047,in_service,81,On the road,Tempe,318.40,254.72,,12,strong,2026-09-27T12:00:00.000Z,yes,,,',
    );
    expect(csv[2]).toBe("048,,7G2CEHED0RA004048,offline,,,,,,,,,,no,No data from vehicle,high,Check connectivity");
  });
});
