import { providerContract } from "../contract";
import { SimulatorProvider } from "./provider";

// 02:00 in Phoenix: most cars are parked at hubs, so some fall asleep quickly.
const START = new Date("2026-09-26T09:00:00Z");

providerContract("SimulatorProvider", async () => {
  const provider = new SimulatorProvider({ seed: 7, start: START });
  return {
    provider,
    now: () => provider.now(),
    advance: (ms) => provider.advance(ms),
    async asleepVehicleRef() {
      for (let i = 0; i < 24; i++) {
        const asleep = (await provider.listVehicles()).find((v) => v.connectivity === "asleep");
        if (asleep) return asleep.vehicleRef;
        await provider.advance(5 * 60_000);
      }
      throw new Error("no vehicle fell asleep within 2 h");
    },
  };
});
