import type { Metadata } from "next";
import { STATUS_META } from "@fleetos/ui/components/status-badge";
import { cn } from "@fleetos/ui/lib/cn";
import { VehicleMap } from "@/components/vehicle/vehicle-map";
import { formatCents, formatHours, formatPct } from "@/lib/format";
import { getVehicleKpis } from "@/lib/services/kpis";
import { loadVehiclePage } from "@/lib/services/vehicle-page";

export async function generateMetadata({ params }: PageProps<"/fleet/[number]">): Promise<Metadata> {
  return { title: `Cybercab ${(await params).number}` };
}

const LABEL: Record<string, string> = {
  availability: "Availability",
  uptime: "Uptime",
  utilization: "Utilization",
  downtime_hours: "Downtime",
  contribution_margin: "Contribution margin",
  revenue_per_available_hour_cents: "Revenue per available hour",
  gross_revenue_cents: "Revenue",
  contribution_cents: "Contribution",
};
const SHOWN = [
  "availability",
  "uptime",
  "utilization",
  "downtime_hours",
  "contribution_margin",
  "revenue_per_available_hour_cents",
];
const FLAG = {
  good: { glyph: "▲", text: "Good", cls: "text-status-available" },
  warn: { glyph: "◆", text: "Watch", cls: "text-severity-high" },
  bad: { glyph: "▼", text: "Below par", cls: "text-severity-critical" },
} as const;

function fmt(unit: string, v: number | null) {
  if (v === null) return "—";
  if (unit === "ratio") return formatPct(v);
  if (unit === "hours") return formatHours(v);
  if (unit === "cents_per_hour") return `${formatCents(v, { decimals: true })}/h`;
  return formatCents(v);
}

/** Vehicle overview (PRD VD-1, VD-4): where it is, and six indicators against the fleet over 30 days. */
export default async function VehicleOverview({ params }: PageProps<"/fleet/[number]">) {
  const { number } = await params;
  const { org, db, vehicle: v } = await loadVehiclePage(number);
  const [kpis, hub] = await Promise.all([
    getVehicleKpis(db, org, v.id, {}),
    v.home_hub
      ? db.from("hub_list").select("lat, lng, radius_m, name").eq("id", v.home_hub.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const h = hub.data as { lat: number; lng: number; radius_m: number; name: string } | null;
  const metrics = SHOWN.map((k) => kpis.metrics.find((m) => m.key === k)).filter((m) => m !== undefined);
  const loc = v.state.location;
  const mapLabel = loc
    ? `Map: ${v.display_name ?? `Cybercab ${v.number}`} at ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}${h ? `, home hub ${h.name}` : ""}`
    : "Map of the home hub";
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section aria-labelledby="where" className="flex flex-col gap-3">
        <h2 id="where" className="text-title font-semibold">
          Where it is
        </h2>
        <VehicleMap
          vehicle={loc}
          glyph={STATUS_META[v.state.status].glyph}
          hub={h ? { lat: h.lat, lng: h.lng, radiusM: h.radius_m, name: h.name } : null}
          label={mapLabel}
        />
        <p className="text-label text-fg-muted">
          {loc ? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}` : "No position reported yet"}
          {h ? ` · Home hub ${h.name} (dashed circle, ${h.radius_m} m)` : ""}
        </p>
      </section>
      <section aria-labelledby="indicators" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="indicators" className="text-title font-semibold">
            Last 30 days
          </h2>
          {kpis.performance_label ? (
            <span className="text-label text-fg-muted">
              Performance: <span className="font-medium text-fg capitalize">{kpis.performance_label}</span>
            </span>
          ) : null}
        </div>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {metrics.map((m) => {
            const f = m.flag ? FLAG[m.flag] : null;
            return (
              <li key={m.key} className="flex flex-col gap-1 rounded-md border border-divider bg-surface p-3">
                <span className="text-label text-fg-muted">{LABEL[m.key] ?? m.key}</span>
                <span className="flex items-baseline gap-2">
                  <span className="text-title font-semibold tabular-nums">{fmt(m.unit, m.value)}</span>
                  {f ? (
                    <span className={cn("text-label font-medium", f.cls)}>
                      <span aria-hidden="true">{f.glyph} </span>
                      {f.text}
                    </span>
                  ) : null}
                </span>
                <span className="text-label text-fg-muted">Fleet average {fmt(m.unit, m.fleet_avg)}</span>
              </li>
            );
          })}
        </ul>
        {!kpis.metrics.some((m) => m.key === "contribution_margin") ? (
          <p className="text-label text-fg-muted">Money indicators are visible to owners, admins and finance.</p>
        ) : null}
      </section>
    </div>
  );
}
