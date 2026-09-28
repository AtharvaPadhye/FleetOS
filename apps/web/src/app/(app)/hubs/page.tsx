import type { Metadata, Route } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { LiveRefresh } from "@/components/live/live-refresh";
import { HubFormDialog } from "@/components/hubs/hub-form-dialog";
import { PageHeader } from "@/components/shell/page-header";
import { formatCents } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { hubsSnapshot } from "@/lib/services/hubs";

export const metadata: Metadata = { title: navItem("hubs").label };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);

/** Hubs (PRD HB-1, HB-3): one card per hub, with today's peak forecast and any overload warning. */
export default async function HubsPage() {
  const item = navItem("hubs");
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const { hubs } = await hubsSnapshot(db, activeOrg);
  const canEdit = ["owner", "admin", "ops"].includes(activeOrg.role);
  const tf = new Intl.DateTimeFormat("en-US", { timeZone: activeOrg.timezone, hour: "numeric", minute: "2-digit" });
  return (
    <div className="flex flex-col gap-6">
      <LiveRefresh orgId={activeOrg.id} />
      <PageHeader title={item.label} summary={item.summary} actions={canEdit ? <HubFormDialog /> : null} />
      {hubs.length === 0 ? (
        <EmptyState
          icon={<Building2 aria-hidden="true" />}
          title="Add your first hub"
          description="Hubs are where cars charge, get cleaned and wait. FleetOS counts cars inside a hub's radius as at that hub."
        >
          {canEdit ? <HubFormDialog /> : null}
        </EmptyState>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {hubs.map((h) => {
            const over = h.overloads[0];
            const facts: [string, React.ReactNode][] = [
              ["Cars assigned / here", `${h.vehicles_assigned} / ${h.vehicles_present}`],
              [
                "Chargers in use",
                <span key="c" className="inline-flex items-center gap-2">
                  {h.chargers_occupied} / {h.chargers_total}
                  <span className="text-label text-fg-muted">estimated</span>
                </span>,
              ],
              ["Cleaning bays", String(h.bays.cleaning)],
              [
                "Average turnaround",
                h.avg_turnaround_min === null ? "Not enough visits yet" : `${h.avg_turnaround_min} min`,
              ],
              [
                "Electricity now",
                h.electricity_price_cents_per_kwh === null
                  ? "No tariff"
                  : `${h.electricity_price_cents_per_kwh.toFixed(1)}¢/kWh${h.tariff_label ? ` · ${h.tariff_label}` : ""}`,
              ],
              ["Peak forecast today", pct(h.peak_forecast_utilization)],
              ...(h.revenue_today_cents !== null
                ? ([["Revenue supported today", formatCents(h.revenue_today_cents)]] as [string, string][])
                : []),
            ];
            return (
              <li key={h.id} className="flex flex-col gap-3 rounded-md border border-divider bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-title font-semibold">
                      <Link href={`/hubs/${h.id}` as Route} className="hover:underline">
                        {h.name}
                      </Link>
                    </h2>
                    {h.address ? <p className="text-label text-fg-muted">{h.address}</p> : null}
                  </div>
                  {activeOrg.isDemo ? <DataSourceBadge source="simulated" /> : null}
                </div>
                {over ? (
                  <p role="status" className="rounded-sm border border-severity-high px-3 py-2 text-body">
                    <span aria-hidden="true" className="text-severity-high">
                      ◆{" "}
                    </span>
                    Forecast {pct(over.peak)} {tf.format(new Date(over.from))}–{tf.format(new Date(over.to))}.{" "}
                    <Link href={`/hubs/${h.id}` as Route} className="underline underline-offset-4">
                      Review plan
                    </Link>
                  </p>
                ) : null}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                  {facts.map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-label text-fg-muted">{k}</dt>
                      <dd className="tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
