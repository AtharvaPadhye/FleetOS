import "server-only";

export const RIDE_COLUMNS =
  "id, vehicle_id, started_at, ended_at, distance_m, fare_cents, platform_fee_cents, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng";

export interface RideRow {
  id: string;
  vehicle_id: string;
  started_at: string;
  ended_at: string | null;
  distance_m: number | string;
  fare_cents: number | string;
  platform_fee_cents: number | string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
}

const point = (lat: number | null, lng: number | null) => (lat !== null && lng !== null ? { lat, lng } : null);

export const toRide = (r: RideRow) => ({
  id: r.id,
  vehicle_id: r.vehicle_id,
  started_at: new Date(r.started_at).toISOString(),
  ended_at: r.ended_at ? new Date(r.ended_at).toISOString() : null,
  distance_m: Number(r.distance_m),
  fare_cents: Number(r.fare_cents),
  platform_fee_cents: Number(r.platform_fee_cents),
  pickup: point(r.pickup_lat, r.pickup_lng),
  dropoff: point(r.dropoff_lat, r.dropoff_lng),
});
