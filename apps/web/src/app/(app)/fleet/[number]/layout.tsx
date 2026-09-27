import type { Route } from "next";
import Link from "next/link";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { SeverityBadge } from "@fleetos/ui/components/severity-badge";
import { StatusBadge } from "@fleetos/ui/components/status-badge";
import { LiveRefresh } from "@/components/live/live-refresh";
import { TabNav } from "@/components/vehicle/tab-nav";
import { VehicleServiceControls } from "@/components/vehicle/vehicle-service-controls";
import { formatAge, formatMiles, formatMph } from "@/lib/format";
import { loadVehiclePage } from "@/lib/services/vehicle-page";

/** Vehicle header (PRD VD-1) and tabs (VD-2), shared by every tab. */
export default async function VehicleLayout({ params, children }: LayoutProps<"/fleet/[number]">) {
  const { number } = await params;
  const { org, vehicle: v, issues, blockers } = await loadVehiclePage(number);
  const base = `/fleet/${encodeURIComponent(v.number)}`;
  const s = v.state;
  const facts: [string, string][] = [
    ["Battery", s.soc === null ? "—" : `${Math.round(s.soc * 100)}% · ${formatMiles(s.range_m)} range`],
    ["Location", s.location_name ?? (s.location ? "On the road" : "Unknown")],
    ["Speed", formatMph(s.speed_mps)],
    ["Odometer", formatMiles(s.odometer_m)],
    ["Home hub", v.home_hub?.name ?? "None"],
    [
      "Last update",
      s.connectivity === "online"
        ? "Live"
        : `${formatAge(s.last_telemetry_at, Date.parse(v.as_of))} (${s.connectivity})`,
    ],
  ];
  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={org.id} />
      <Link href="/fleet" className="self-start text-label text-fg-muted underline underline-offset-4">
        ← Fleet
      </Link>
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id="main-heading"
            tabIndex={-1}
            className="font-display text-display-l font-semibold [font-stretch:112.5%] focus:outline-none"
          >
            {v.display_name ?? `Cybercab ${v.number}`}
          </h1>
          <StatusBadge status={s.status} className="text-body" />
          {org.isDemo ? <DataSourceBadge source="simulated" /> : null}
          {!s.fresh ? (
            <span className="inline-flex items-center gap-1.5 text-label text-status-maintenance">
              <span aria-hidden="true">◆</span> Stale data
            </span>
          ) : null}
        </div>
        <p className="font-mono text-mono text-fg-muted">
          VIN {v.vin} · {v.model ?? "Cybercab"} · {v.provider === "simulator" ? "Simulated vehicle" : "Tesla"}
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-md border border-divider bg-surface p-4 sm:grid-cols-3 lg:grid-cols-6">
          {facts.map(([k, val]) => (
            <div key={k}>
              <dt className="text-label text-fg-muted">{k}</dt>
              <dd className="tabular-nums">{val}</dd>
            </div>
          ))}
        </dl>
        {issues.length ? (
          <section aria-labelledby="open-issues" className="flex flex-col gap-2">
            <h2 id="open-issues" className="text-label font-semibold text-fg-muted">
              Open issues
            </h2>
            <ul className="flex flex-col gap-1">
              {issues.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <SeverityBadge severity={e.severity} />
                  <Link href={`/exceptions/${e.id}` as Route} className="underline underline-offset-4">
                    {e.title}
                  </Link>
                  {e.ticket_id ? (
                    <span className="text-label text-fg-muted">Service ticket open</span>
                  ) : e.recommended_action ? (
                    <span className="text-label text-fg-muted">{e.recommended_action.label}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {["owner", "admin", "ops"].includes(org.role) ? (
          <VehicleServiceControls
            vehicleId={v.id}
            vehicleNumber={v.number}
            held={v.holds.length > 0}
            blockers={[
              ...blockers.tickets.map((t) => `${t.number} (${t.type})`),
              ...blockers.exceptions.map((e) => e.title),
            ]}
            canOverride={["owner", "admin"].includes(org.role)}
          />
        ) : null}
        {v.holds.length ? (
          <p role="status" className="rounded-sm border border-severity-high px-3 py-2 text-body">
            <span aria-hidden="true">◆ </span>Pulled from service: {v.holds.map((h) => h.reason).join("; ")}
          </p>
        ) : null}
      </header>
      <TabNav
        label="Vehicle sections"
        tabs={[
          { href: base, label: "Overview" },
          { href: `${base}/operations`, label: "Operations" },
          { href: `${base}/service`, label: "Service" },
          { href: `${base}/financials`, label: "Financials" },
          { href: `${base}/telemetry`, label: "Telemetry" },
        ]}
      />
      {children}
    </div>
  );
}
