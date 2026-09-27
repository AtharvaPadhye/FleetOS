import type { GeoPoint } from "@fleetos/providers";
import type { EngineHub } from "./types";

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Hub presence with hysteresis (vehicle-states.md §6): enter within the radius, leave only beyond
 * radius + exit buffer, so cars parked at the edge don't flicker in and out.
 */
export function hubPresence(
  pos: GeoPoint | null,
  currentHubId: string | null,
  hubs: readonly EngineHub[],
): string | null {
  if (!pos) return currentHubId;
  if (currentHubId) {
    const h = hubs.find((x) => x.id === currentHubId);
    if (h && distanceM(pos, h.location) <= h.radiusM + h.exitBufferM) return currentHubId;
  }
  return hubs.find((h) => distanceM(pos, h.location) <= h.radiusM)?.id ?? null;
}
