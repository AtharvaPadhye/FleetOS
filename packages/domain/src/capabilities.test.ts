import { CAPABILITIES, SUBSTITUTE_KINDS, capabilityStatuses } from "./capabilities";
// @ts-expect-error — plain .mjs repo script without type declarations
import { CAPABILITIES as SCRIPT_CAPS, KINDS as SCRIPT_KINDS } from "../../../scripts/substitutes.mjs";

describe("capability registry", () => {
  it("matches the SUBSTITUTE marker checker's copy", () => {
    expect([...CAPABILITIES]).toEqual(SCRIPT_CAPS);
    expect([...SUBSTITUTE_KINDS]).toEqual(SCRIPT_KINDS);
  });
});

describe("capabilityStatuses", () => {
  it("lists every capability once, in registry order", () => {
    for (const isDemo of [true, false])
      expect(capabilityStatuses({ isDemo }).map((c) => c.name)).toEqual([...CAPABILITIES]);
  });
  it("never claims live data before Tesla is connected", () => {
    for (const isDemo of [true, false])
      expect(capabilityStatuses({ isDemo }).some((c) => c.state === "live")).toBe(false);
  });
  it("demo orgs run on the simulator; others show their fallbacks", () => {
    const demo = Object.fromEntries(capabilityStatuses({ isDemo: true }).map((c) => [c.name, c]));
    const real = Object.fromEntries(capabilityStatuses({ isDemo: false }).map((c) => [c.name, c]));
    expect(demo.tesla).toMatchObject({ state: "simulated", source: "simulator" });
    expect(real.tesla).toMatchObject({ state: "unavailable", source: null });
    expect(real.earnings).toMatchObject({ state: "unavailable", fallback: "csv" });
    expect(real.live_tariffs).toMatchObject({ fallback: "static" });
  });
});
