/**
 * Provider contract tests (docs/architecture/api.md §5). Every VehicleProvider — the simulator now, the Tesla
 * provider in Phase 4 (against recorded fixtures) — must pass this same suite.
 */
import { isValidVin } from "@fleetos/domain";
import { CommandsDisabledError, UnknownVehicleError } from "./errors";
import { TELEMETRY_FIELDS, type ProviderEvent, type VehicleProvider } from "./types";

export interface ContractHarness {
  provider: VehicleProvider;
  /** Current time in the provider's world. */
  now(): Date;
  /** Move the provider's world forward (the simulator steps; a fixture replays). */
  advance(ms: number): Promise<void>;
  /** A vehicle that is asleep right now, to prove snapshots don't wake cars. */
  asleepVehicleRef(): Promise<string>;
}

const FIELDS = new Set<string>(TELEMETRY_FIELDS);

export function providerContract(name: string, makeHarness: () => Promise<ContractHarness>) {
  describe(`VehicleProvider contract: ${name}`, () => {
    let h: ContractHarness;
    beforeEach(async () => {
      h = await makeHarness();
    });

    it("lists vehicles with unique refs and valid VINs (check digit included)", async () => {
      const list = await h.provider.listVehicles();
      expect(list.length).toBeGreaterThan(0);
      expect(new Set(list.map((v) => v.vehicleRef)).size).toBe(list.length);
      for (const v of list) {
        expect(isValidVin(v.vin), v.vin).toBe(true);
        expect(["online", "asleep", "offline"]).toContain(v.connectivity);
      }
    });

    it("returns a snapshot for an online vehicle using contract field names", async () => {
      const online = (await h.provider.listVehicles()).find((v) => v.connectivity === "online");
      expect(online, "at least one vehicle should be online").toBeDefined();
      const snap = await h.provider.getSnapshot(online!.vehicleRef);
      expect(snap).not.toBeNull();
      expect(Object.keys(snap!.fields).every((f) => FIELDS.has(f))).toBe(true);
      expect(typeof snap!.fields.Soc).toBe("number");
    });

    it("never wakes an asleep vehicle to take a snapshot", async () => {
      const ref = await h.asleepVehicleRef();
      expect(await h.provider.getSnapshot(ref)).toBeNull();
      const after = (await h.provider.listVehicles()).find((v) => v.vehicleRef === ref);
      expect(after?.connectivity).toBe("asleep");
    });

    it("rejects unknown vehicles with UnknownVehicleError", async () => {
      await expect(h.provider.getSnapshot("NOT-A-VEHICLE")).rejects.toBeInstanceOf(UnknownVehicleError);
    });

    it("streams well-formed telemetry in vehicle time, and stops when aborted", async () => {
      const events: ProviderEvent[] = [];
      const ac = new AbortController();
      await h.provider.subscribe((e) => events.push(e), ac.signal);
      const start = h.now().getTime();
      await h.advance(10 * 60_000);
      const telemetry = events.flatMap((e) => (e.kind === "telemetry" ? e.events : []));
      expect(telemetry.length).toBeGreaterThan(0);
      for (const t of telemetry) {
        expect(FIELDS.has(t.field), t.field).toBe(true);
        expect(t.eventTime).toBeInstanceOf(Date);
        expect(t.eventTime.getTime()).toBeGreaterThanOrEqual(start);
        expect(t.eventTime.getTime()).toBeLessThanOrEqual(h.now().getTime());
      }
      ac.abort();
      const count = events.length;
      await h.advance(10 * 60_000);
      expect(events.length).toBe(count);
    });

    it("refuses commands while they are disabled", async () => {
      const [first] = await h.provider.listVehicles();
      await expect(h.provider.sendCommand(first!.vehicleRef, "flash_lights")).rejects.toBeInstanceOf(
        CommandsDisabledError,
      );
    });
  });
}
