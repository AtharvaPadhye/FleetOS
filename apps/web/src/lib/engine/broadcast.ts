import type { StatusEventOut, VehicleLive } from "@fleetos/engine";

/**
 * Realtime payloads for one tick (api.md §4): per vehicle, only the fields that changed since the tick
 * started, plus one message per status change. Pure so it can be tested without a database.
 */
export interface StatePatch {
  vehicle_id: string;
  status?: string | null;
  soc?: number | null;
  location?: { lat: number; lng: number } | null;
  speed_mps?: number | null;
  charge_state?: string | null;
  current_hub_id?: string | null;
  last_telemetry_at?: string | null;
}

const FIELDS = {
  status: (l: VehicleLive) => l.status,
  soc: (l: VehicleLive) => (l.soc === null ? null : Math.round(l.soc * 1000) / 1000),
  location: (l: VehicleLive) =>
    l.location ? { lat: Math.round(l.location.lat * 1e5) / 1e5, lng: Math.round(l.location.lng * 1e5) / 1e5 } : null,
  speed_mps: (l: VehicleLive) => (l.speedMps === null ? null : Math.round(l.speedMps * 10) / 10),
  charge_state: (l: VehicleLive) => l.chargeState,
  current_hub_id: (l: VehicleLive) => l.currentHubId,
  last_telemetry_at: (l: VehicleLive) => l.lastTelemetryAt?.toISOString() ?? null,
} satisfies Record<string, (l: VehicleLive) => unknown>;

export function statePatches(before: ReadonlyMap<string, VehicleLive>, after: readonly VehicleLive[]): StatePatch[] {
  const out: StatePatch[] = [];
  for (const l of after) {
    const prev = before.get(l.vehicleId);
    const patch: Record<string, unknown> = {};
    for (const [key, read] of Object.entries(FIELDS)) {
      const now = read(l);
      if (!prev || JSON.stringify(read(prev)) !== JSON.stringify(now)) patch[key] = now;
    }
    if (Object.keys(patch).length) out.push({ vehicle_id: l.vehicleId, ...patch });
  }
  return out;
}

export const statusMessages = (events: readonly StatusEventOut[]) =>
  events.map((e) => ({
    vehicle_id: e.vehicleId,
    from: e.from,
    to: e.to,
    at: e.at.toISOString(),
    cause_type: e.causeType,
  }));
