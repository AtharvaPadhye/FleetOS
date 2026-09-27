import { SimulatorProvider, type ProviderSnapshot } from "./provider";
import { phoenixMidnight } from "./day-summary";

const START = new Date(phoenixMidnight("2026-09-26").getTime() + 6 * 3_600_000); // 06:00 local, busy

async function record(p: SimulatorProvider, ms: number): Promise<string[]> {
  const out: string[] = [];
  const ac = new AbortController();
  await p.subscribe((e) => out.push(JSON.stringify(e)), ac.signal);
  await p.advance(ms);
  ac.abort();
  return out;
}

describe("simulator save/restore (so a per-minute tick can resume it)", () => {
  it("a run split by save → JSON → restore is identical to an unbroken run", async () => {
    const straight = new SimulatorProvider({ seed: 9, start: START });
    const whole = await record(straight, 2 * 3_600_000);

    const first = new SimulatorProvider({ seed: 9, start: START });
    const partA = await record(first, 3_600_000);
    const saved = JSON.parse(JSON.stringify(first.snapshot())) as ProviderSnapshot;
    const resumed = SimulatorProvider.restore(saved);
    const partB = await record(resumed, 3_600_000);

    expect(partA.length + partB.length).toBe(whole.length);
    expect([...partA, ...partB]).toEqual(whole);
    expect(resumed.now().getTime()).toBe(straight.now().getTime());
  });

  it("a snapshot of the full fleet stays small enough to store every minute", () => {
    const p = new SimulatorProvider({ seed: 1, start: START });
    const bytes = JSON.stringify(p.snapshot()).length;
    expect(bytes).toBeLessThan(300_000);
  });

  it("rejects snapshots from an unknown version", () => {
    const p = new SimulatorProvider({ seed: 1, start: START });
    const snap = p.snapshot();
    expect(() => SimulatorProvider.restore({ ...snap, world: { ...snap.world, version: 2 as 1 } })).toThrow(/version/);
  });
});
