"use client";

import { useEffect, useRef, useState } from "react";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Vehicle location with its home hub's geofence (PRD VD-1). MapLibre GL on CARTO's keyless dark basemap
 * (free tier, attribution shown); a Mapbox/MapTiler style URL can replace it without other changes. The
 * map is decorative for screen readers: the same facts are in the text beside it.
 */
const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function circle(lat: number, lng: number, radiusM: number, steps = 64): [number, number][] {
  const out: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    out.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return out;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

export function VehicleMap({
  vehicle,
  glyph,
  hub,
  label,
}: {
  vehicle: MapPoint | null;
  glyph: string;
  hub: (MapPoint & { name: string; radiusM: number }) | null;
  label: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!el.current || (!vehicle && !hub)) return;
    let map: import("maplibre-gl").Map | undefined;
    let cancelled = false;
    void import("maplibre-gl")
      .then((maplibregl) => {
        if (cancelled || !el.current) return;
        // The worker is served from public/vendor (scripts/copy-vendor.mjs), versioned with the package.
        maplibregl.setWorkerUrl(`/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
        const center = vehicle ?? hub!;
        const m0 = new maplibregl.Map({
          container: el.current,
          style: STYLE,
          center: [center.lng, center.lat],
          zoom: 12.5,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        map = m0;
        m0.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
        m0.on("error", () => setFailed(true));
        m0.on("load", () => {
          const map = m0;
          // Geofence in the "info" hue from the design tokens (maps need a computed colour, not a CSS variable).
          const info =
            getComputedStyle(document.documentElement).getPropertyValue("--fo-status-charging").trim() ||
            "currentColor";
          if (hub) {
            map.addSource("hub", {
              type: "geojson",
              data: {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [circle(hub.lat, hub.lng, hub.radiusM)] },
              },
            });
            map.addLayer({
              id: "hub-fill",
              type: "fill",
              source: "hub",
              paint: { "fill-color": info, "fill-opacity": 0.12 },
            });
            map.addLayer({
              id: "hub-line",
              type: "line",
              source: "hub",
              paint: { "line-color": info, "line-width": 1.5, "line-dasharray": [2, 2] },
            });
          }
          if (hub) {
            const h = document.createElement("div");
            h.textContent = `${hub.name} hub`;
            h.setAttribute("aria-hidden", "true");
            h.className =
              "rounded-sm border border-[var(--fo-border-control)] bg-[var(--fo-bg-overlay)] px-1.5 py-0.5 text-[12px] text-[var(--fo-fg-muted)]";
            new maplibregl.Marker({ element: h, anchor: "top" }).setLngLat([hub.lng, hub.lat]).addTo(map);
          }
          if (vehicle) {
            const m = document.createElement("div");
            m.textContent = glyph;
            m.setAttribute("aria-hidden", "true");
            m.className =
              "grid size-7 place-items-center rounded-full border-2 border-[var(--fo-chalk)] bg-[var(--fo-bg-canvas)] text-[13px] text-[var(--fo-chalk)]";
            new maplibregl.Marker({ element: m }).setLngLat([vehicle.lng, vehicle.lat]).addTo(map);
          }
          if (vehicle && hub) {
            const b = new maplibregl.LngLatBounds([vehicle.lng, vehicle.lat], [vehicle.lng, vehicle.lat]);
            b.extend([hub.lng, hub.lat]);
            map.fitBounds(b, { padding: 60, maxZoom: 14, duration: 0 });
          }
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
      map?.remove();
    };
    // Re-create only when the car or hub moves; the glyph is part of the marker.
  }, [vehicle, hub, glyph]);

  if (!vehicle && !hub)
    return (
      <div className="grid h-72 place-items-center rounded-md border border-dashed border-border-strong text-fg-muted">
        No location yet
      </div>
    );
  return (
    <div className="relative">
      <div
        ref={el}
        role="img"
        aria-label={label}
        className="h-72 w-full overflow-hidden rounded-md border border-divider bg-raised lg:h-80"
      />
      {failed ? (
        <p className="absolute inset-x-3 bottom-3 rounded-sm bg-overlay px-3 py-2 text-label text-fg-muted">
          The map couldn&apos;t load (offline?). The location is listed beside it.
        </p>
      ) : null}
    </div>
  );
}
