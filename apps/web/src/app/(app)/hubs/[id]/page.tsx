import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { StatusBadge } from "@fleetos/ui/components/status-badge";
import { LiveRefresh } from "@/components/live/live-refresh";
import { ApplyRecommendation } from "@/components/hubs/apply-recommendation";
import { ForecastChartLazy } from "@/components/hubs/forecast-chart-lazy";
import { HubFormDialog } from "@/components/hubs/hub-form-dialog";
import { ApiProblem } from "@/lib/api/problem";
import { formatCents, formatWhen } from "@/lib/format";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { hubView } from "@/lib/services/hubs";

export const metadata: Metadata = { title: "Hub" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** One hub (PRD HB-1..HB-4): who's here, today's charger forecast, overload warning and the mitigation plan. */
export default async function HubPage({ params }: PageProps<"/hubs/[id]">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const { hub: h, snap } = await hubView(db, activeOrg, id).catch((e) => {
    if (e instanceof ApiProblem && e.code === "not_found") notFound();
    throw e;
  });
  const canEdit = ["owner", "admin", "ops"].includes(activeOrg.role);
  const tz = activeOrg.timezone;
  const tf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const hf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric" });
  const future = h.forecast.filter((x) => x.hour + 3_600_000 > snap.asOf);
  const peak = future.reduce<(typeof future)[number] | null>(
    (m, x) => (!m || (x.utilization ?? 0) > (m.utilization ?? 0) ? x : m),
    null,
  );
  const over = h.overloads[0];
  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={activeOrg.id} />
      <Link href="/hubs" className="self-start text-label text-fg-muted underline underline-offset-4">
        ← Hubs
      </Link>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              id="main-heading"
              tabIndex={-1}
              className="font-display text-display-l font-semibold [font-stretch:112.5%] focus:outline-none"
            >
              {h.name}
            </h1>
            {activeOrg.isDemo ? <DataSourceBadge source="simulated" /> : null}
          </div>
          <p className="text-fg-muted">
            {h.address ?? `${h.location.lat.toFixed(4)}, ${h.location.lng.toFixed(4)}`} · {h.chargers_total} chargers
            {h.charger_kw ? ` × ${h.charger_kw} kW` : ""} · {h.bays.cleaning} cleaning bays
          </p>
        </div>
        {canEdit ? (
          <HubFormDialog
            hub={{
              id: h.id,
              name: h.name,
              address: h.address,
              lat: h.location.lat,
              lng: h.location.lng,
              radius_m: h.radius_m,
              chargers: h.chargers_total,
              charger_kw: h.charger_kw,
              bays: h.bays,
              price_cents: null,
            }}
          />
        ) : null}
      </header>

      {over ? (
        <section
          aria-labelledby="warning"
          className="flex flex-col gap-3 rounded-md border border-severity-high bg-surface p-4"
        >
          <h2 id="warning" className="text-title font-semibold">
            <span aria-hidden="true" className="text-severity-high">
              ◆{" "}
            </span>
            Forecast {pct(over.peak)} {tf.format(new Date(over.from))}–{tf.format(new Date(over.to))}
          </h2>
          <p className="text-fg-muted">
            More cars are expected to need a charger than {h.name} has. Cars would queue and lose ride time.
          </p>
          {h.recommendations.length ? (
            <ol className="flex flex-col gap-2">
              {h.recommendations.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-divider p-3"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-medium">{r.title}</span>
                    <span className="text-label text-fg-muted">{r.detail}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {r.impactCents ? (
                      <span className="text-money-gain tabular-nums">+{formatCents(r.impactCents)}</span>
                    ) : null}
                    {r.status === "applied" ? (
                      <span className="text-label text-fg-muted">Applied</span>
                    ) : canEdit ? (
                      <ApplyRecommendation hubId={h.id} rec={r} />
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-label text-fg-muted">
              No other hub has spare chargers then, and no car can wait. Consider temporary charging capacity.
            </p>
          )}
        </section>
      ) : null}

      <section aria-labelledby="forecast" className="flex flex-col gap-2">
        <h2 id="forecast" className="text-title font-semibold">
          Charger forecast, today
        </h2>
        <p className="text-label text-fg-muted">
          {peak
            ? `Peak ${pct(peak.utilization)} of ${h.chargers_total} chargers at ${hf.format(new Date(peak.hour))}${over ? "" : "; no overload expected"}.`
            : "No hours left today."}{" "}
          Projected from each car&apos;s battery now and a {Math.round(snap.drain.perHour * 1000) / 10}%/h drain{" "}
          {snap.drain.measured ? "measured over the last 7 days" : "(Cybercab estimate until a week of history exists)"}
          , blended with this hub&apos;s charging history.
        </p>
        <ForecastChartLazy hours={h.forecast} now={snap.asOf} timeZone={tz} />
        <details className="text-label">
          <summary className="cursor-pointer text-fg-muted">View as table</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-medium text-fg-muted">Hour</th>
                  <th className="px-2 py-1 text-left font-medium text-fg-muted">Chargers needed</th>
                  <th className="px-2 py-1 text-left font-medium text-fg-muted">Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {h.forecast.map((x) => (
                  <tr key={x.hour}>
                    <td className="px-2 py-1">{hf.format(new Date(x.hour))}</td>
                    <td className="px-2 py-1 tabular-nums">{x.demand}</td>
                    <td className="px-2 py-1 tabular-nums">
                      {pct(x.utilization)}
                      {(x.utilization ?? 0) > 1 ? " · over capacity" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="here" className="flex flex-col gap-2">
          <h2 id="here" className="text-title font-semibold">
            At the hub now ({h.vehicles_present})
          </h2>
          <p className="text-label text-fg-muted">
            {h.chargers_occupied} of {h.chargers_total} chargers in use (estimated from cars&apos; charging state until
            charger telemetry is connected).
          </p>
          {h.present.length ? (
            <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
              {h.present.map((c) => (
                <li key={c.vehicle_id} className="flex items-center justify-between gap-3 px-4 py-2">
                  <Link href={`/fleet/${c.number}` as Route} className="hover:underline">
                    Car {c.number}
                  </Link>
                  <span className="flex items-center gap-3 text-label">
                    <StatusBadge status={c.status} />
                    <span className="text-fg-muted tabular-nums">
                      {c.soc === null ? "—" : `${Math.round(c.soc * 100)}%`}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-md border border-dashed border-border-strong p-4 text-fg-muted">
              No cars at this hub right now.
            </p>
          )}
        </section>
        <section aria-labelledby="decisions" className="flex flex-col gap-2">
          <h2 id="decisions" className="text-title font-semibold">
            Decisions today
          </h2>
          {h.decisions.length ? (
            <ol className="flex flex-col gap-2 border-l border-divider pl-3">
              {h.decisions.map((d) => (
                <li key={d.id} className="text-label">
                  <span className="text-fg">{d.title}</span>
                  <span className="text-fg-muted"> · {formatWhen(d.applied_at, tz, "time")}</span>
                  {d.detail ? <p className="text-fg-muted">{d.detail}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-fg-muted">No plans applied today.</p>
          )}
        </section>
      </div>
    </div>
  );
}
