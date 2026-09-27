import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PHOENIX, SimulatorProvider } from "@fleetos/providers";
import { tickOrg } from "./tick";

/**
 * Fill a new org with the simulated Phoenix fleet (flows.md F2 "Demo data"): 3 hubs, 84 Cybercabs (or `vehicles`), and a
 * simulator whose clock follows real time. Uses the service role; every row carries the org_id.
 */
export async function provisionDemoFleet(
  db: SupabaseClient,
  orgId: string,
  seed: number,
  now = new Date(),
  vehicles?: number, // default: the full Phoenix fleet (84)
) {
  const { error: oErr } = await db.from("orgs").update({ is_demo: true, city: "Phoenix, AZ" }).eq("id", orgId);
  if (oErr) throw new Error(oErr.message);

  const { data: hubs, error: hErr } = await db
    .from("hubs")
    .insert(
      PHOENIX.hubs.map((h) => ({
        org_id: orgId,
        name: h.name,
        location: `SRID=4326;POINT(${h.location.lng} ${h.location.lat})`,
        radius_m: h.radiusM,
      })),
    )
    .select("id, name");
  if (hErr) throw new Error(hErr.message);
  const hubId = (key: string) =>
    (hubs as { id: string; name: string }[]).find((h) => h.name === PHOENIX.hubs.find((x) => x.key === key)?.name)?.id;

  for (const h of PHOENIX.hubs) {
    const id = hubId(h.key);
    const chargers = Array.from({ length: h.chargers }, (_, i) => ({
      org_id: orgId,
      hub_id: id,
      label: `C${String(i + 1).padStart(2, "0")}`,
      max_kw: h.chargerKw,
    }));
    const bays = Array.from({ length: h.cleaningBays }, (_, i) => ({
      org_id: orgId,
      hub_id: id,
      kind: "cleaning",
      label: `Bay ${i + 1}`,
    }));
    const [{ error: cErr }, { error: bErr }] = await Promise.all([
      db.from("hub_chargers").insert(chargers),
      db.from("hub_bays").insert(bays),
    ]);
    if (cErr || bErr) throw new Error((cErr ?? bErr)!.message);
  }

  // Start one minute in the past so the first tick simulates exactly one real minute.
  const start = new Date(now.getTime() - 60_000);
  const provider = new SimulatorProvider({ seed, start, vehicles });
  const { error: vErr } = await db.from("vehicles").insert(
    provider.world.vehicles.map((v) => ({
      org_id: orgId,
      vin: v.vin,
      number: v.number,
      display_name: `Cybercab ${v.number}`,
      model: "Cybercab",
      home_hub_id: hubId(v.hub),
      provider: "simulator",
      provider_ref: v.vin,
      commissioned_at: now.toISOString(),
      insurance_monthly_cents: 48_600,
      financing_monthly_cents: 114_300,
      virtual_key_paired: true,
      telemetry_synced: true,
    })),
  );
  if (vErr) throw new Error(vErr.message);

  const { error: sErr } = await db.from("simulator_state").insert({
    org_id: orgId,
    seed,
    started_at: start.toISOString(),
    last_tick_at: start.toISOString(),
    snapshot: provider.snapshot(),
  });
  if (sErr) throw new Error(sErr.message);
  // First tick right away so the fleet appears immediately.
  return tickOrg(db, orgId, now);
}
