import type { GeoPoint } from "../types";

const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function bearingDeg(a: GeoPoint, b: GeoPoint): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Move up to `meters` from `from` toward `to` (straight line; no road network). */
export function moveToward(from: GeoPoint, to: GeoPoint, meters: number): { point: GeoPoint; arrived: boolean } {
  const d = distanceM(from, to);
  if (d <= meters || d === 0) return { point: { ...to }, arrived: true };
  const f = meters / d;
  return {
    point: { lat: from.lat + (to.lat - from.lat) * f, lng: from.lng + (to.lng - from.lng) * f },
    arrived: false,
  };
}

/** Point `meters` away from `center` at `bearing` degrees. */
export function offset(center: GeoPoint, meters: number, bearing: number): GeoPoint {
  const dLat = (meters * Math.cos(rad(bearing))) / R;
  const dLng = (meters * Math.sin(rad(bearing))) / (R * Math.cos(rad(center.lat)));
  return { lat: center.lat + deg(dLat), lng: center.lng + deg(dLng) };
}
