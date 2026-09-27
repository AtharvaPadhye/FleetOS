import type { Metadata } from "next";
import { localDay } from "@/lib/api/period";
import { formatCents } from "@/lib/format";
import { MONEY_ROLES } from "@/lib/api/vehicles";
import { vehicleServiceHistory } from "@/lib/services/vehicle-activity";
import { loadVehiclePage } from "@/lib/services/vehicle-page";

export async function generateMetadata({ params }: PageProps<"/fleet/[number]/service">): Promise<Metadata> {
  return { title: `Cybercab ${(await params).number} · Service` };
}

const CATEGORY: Record<string, string> = { cleaning: "Cleaning", maintenance: "Repair", roadside: "Roadside & towing" };

/** Service history (PRD VD-6): vehicle alerts and what service cost, last 90 days. Tickets join in task 5.5. */
export default async function VehicleService({ params }: PageProps<"/fleet/[number]/service">) {
  const { number } = await params;
  const { org, db, vehicle: v } = await loadVehiclePage(number);
  const since = new Date(Date.parse(v.as_of) - 90 * 86_400_000);
  const { alerts, costs } = await vehicleServiceHistory(db, org.id, v.id, localDay(since, org.timezone));
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: org.timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
  const total = costs.reduce((s, c) => s + c.amount_cents, 0);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section aria-labelledby="alerts" className="flex flex-col gap-3">
        <h2 id="alerts" className="text-title font-semibold">
          Alerts
        </h2>
        {alerts.length ? (
          <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                <span className="font-mono text-mono">{a.name}</span>
                <span className="text-label text-fg-muted">
                  {fmt(a.started_at)} →{" "}
                  {a.ended_at ? fmt(a.ended_at) : <span className="text-severity-high">still active</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-border-strong p-6 text-fg-muted">
            No alerts from this vehicle.
          </p>
        )}
      </section>
      <section aria-labelledby="costs" className="flex flex-col gap-3">
        <h2 id="costs" className="text-title font-semibold">
          Service costs · 90 days
        </h2>
        {!MONEY_ROLES.has(org.role) ? (
          <p className="text-fg-muted">Costs are visible to owners, admins and finance.</p>
        ) : costs.length ? (
          <>
            <ul className="divide-y divide-divider rounded-md border border-divider bg-surface">
              {costs.map((c, i) => (
                <li key={i} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2">
                  <span>
                    {CATEGORY[c.category] ?? c.category}
                    {c.note ? <span className="text-label text-fg-muted"> · {c.note}</span> : null}
                  </span>
                  <span className="tabular-nums">
                    {formatCents(-c.amount_cents, { decimals: true })}{" "}
                    <span className="text-label text-fg-muted">
                      {c.occurred_at ? fmt(c.occurred_at) : c.occurred_on}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-right text-body">
              Total <span className="font-semibold tabular-nums">{formatCents(-total, { decimals: true })}</span>
            </p>
          </>
        ) : (
          <p className="rounded-md border border-dashed border-border-strong p-6 text-fg-muted">
            No service costs in the last 90 days.
          </p>
        )}
      </section>
    </div>
  );
}
