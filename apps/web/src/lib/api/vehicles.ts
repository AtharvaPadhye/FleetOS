import "server-only";
import { isFresh } from "@fleetos/domain";
import type { z } from "zod";
import type { Vehicle, VehicleListItem } from "./schemas";

export const VEHICLE_LIST_COLUMNS =
  "id, number, vin, display_name, home_hub_id, home_hub_name, status, status_since, soc, range_m, charge_state, charge_power_kw, lat, lng, heading, speed_mps, odometer_m, locked, tpms, connectivity, current_hub_id, last_telemetry_at";
export const VEHICLE_DETAIL_COLUMNS = `${VEHICLE_LIST_COLUMNS}, model, lifecycle, provider, commissioned_at, insurance_monthly_cents, financing_monthly_cents, virtual_key_paired, telemetry_synced`;

type Num = number | string | null; // numeric columns arrive as strings
export interface VehicleListRow {
  id: string;
  number: string;
  vin: string;
  display_name: string | null;
  home_hub_id: string | null;
  home_hub_name: string | null;
  status: z.infer<typeof VehicleListItem>["state"]["status"];
  status_since: string | null;
  soc: Num;
  range_m: Num;
  charge_state: string | null;
  charge_power_kw: Num;
  lat: number | null;
  lng: number | null;
  heading: Num;
  speed_mps: Num;
  odometer_m: Num;
  locked: boolean | null;
  tpms: { fl?: number; fr?: number; rl?: number; rr?: number } | null;
  connectivity: "online" | "asleep" | "offline";
  current_hub_id: string | null;
  last_telemetry_at: string | null;
}
export interface VehicleDetailRow extends VehicleListRow {
  model: string | null;
  lifecycle: "pending" | "commissioned" | "retired";
  provider: "simulator" | "tesla";
  commissioned_at: string | null;
  insurance_monthly_cents: Num;
  financing_monthly_cents: Num;
  virtual_key_paired: boolean | null;
  telemetry_synced: boolean | null;
}

const num = (v: Num) => (v === null ? null : Number(v));
const iso = (v: string | null) => (v === null ? null : new Date(v).toISOString());
const dropNulls = <T extends object>(o: T | null) =>
  o ? (Object.fromEntries(Object.entries(o).filter(([, v]) => typeof v === "number")) as T) : null;

export function toVehicleListItem(r: VehicleListRow, now: Date): z.infer<typeof VehicleListItem> {
  const lastTelemetryAt = iso(r.last_telemetry_at);
  return {
    id: r.id,
    number: r.number,
    vin: r.vin,
    home_hub: r.home_hub_id && r.home_hub_name ? { id: r.home_hub_id, name: r.home_hub_name } : null,
    state: {
      status: r.status,
      ...(r.status_since ? { status_since: iso(r.status_since)! } : {}),
      soc: num(r.soc),
      range_m: num(r.range_m),
      charge_state: r.charge_state,
      charge_power_kw: num(r.charge_power_kw),
      location: r.lat !== null && r.lng !== null ? { lat: r.lat, lng: r.lng } : null,
      heading: num(r.heading),
      speed_mps: num(r.speed_mps),
      odometer_m: num(r.odometer_m),
      locked: r.locked,
      tpms: dropNulls(r.tpms),
      connectivity: r.connectivity,
      current_hub_id: r.current_hub_id,
      last_telemetry_at: lastTelemetryAt,
      fresh: isFresh(
        { connectivity: r.connectivity, lastTelemetryAt: lastTelemetryAt ? new Date(lastTelemetryAt) : null },
        now,
      ),
    },
  };
}

export function toVehicle(
  r: VehicleDetailRow,
  holds: { id: string; reason: string; created_at: string }[],
  canSeeMoney: boolean,
  now: Date,
): z.infer<typeof Vehicle> {
  return {
    ...toVehicleListItem(r, now),
    model: r.model,
    lifecycle: r.lifecycle,
    provider: r.provider,
    commissioned_at: iso(r.commissioned_at),
    insurance_monthly_cents: canSeeMoney ? num(r.insurance_monthly_cents) : null,
    financing_monthly_cents: canSeeMoney ? num(r.financing_monthly_cents) : null,
    virtual_key_paired: r.virtual_key_paired,
    telemetry_synced: r.telemetry_synced,
    holds: holds.map((h) => ({ id: h.id, reason: h.reason, created_at: new Date(h.created_at).toISOString() })),
  };
}

export const MONEY_ROLES = new Set(["owner", "admin", "finance"]);
