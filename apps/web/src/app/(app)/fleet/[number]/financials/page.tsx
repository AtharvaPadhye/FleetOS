import type { Metadata, Route } from "next";
import Link from "next/link";
import { cn } from "@fleetos/ui/lib/cn";
import { PnlTable } from "@/components/money/pnl-table";
import { MONEY_ROLES } from "@/lib/api/vehicles";
import { getPnl } from "@/lib/services/kpis";
import { loadVehiclePage } from "@/lib/services/vehicle-page";

export async function generateMetadata({ params }: PageProps<"/fleet/[number]/financials">): Promise<Metadata> {
  return { title: `Cybercab ${(await params).number} · Financials` };
}

const PERIODS = { mtd: "Month to date", last_30d: "Last 30 days", today: "Today" } as const;

/** The vehicle's P&L (PRD VD-3) against the fleet average, with the accounting / economic toggle. */
export default async function VehicleFinancials({ params, searchParams }: PageProps<"/fleet/[number]/financials">) {
  const { number } = await params;
  const sp = await searchParams;
  const { org, db, vehicle: v } = await loadVehiclePage(number);
  if (!MONEY_ROLES.has(org.role))
    return (
      <p className="rounded-md border border-divider bg-surface p-6 text-fg-muted">
        Money is visible to owners, admins and finance.
      </p>
    );
  const period = (Object.keys(PERIODS) as (keyof typeof PERIODS)[]).includes(sp.period as keyof typeof PERIODS)
    ? (sp.period as keyof typeof PERIODS)
    : "mtd";
  const view = sp.view === "economic" ? "economic" : "accounting";
  const pnl = await getPnl(db, org, { period, vehicleId: v.id, view });
  const base = `/fleet/${encodeURIComponent(v.number)}/financials`;
  const href = (p: string, vw: string) => `${base}?period=${p}${vw === "economic" ? "&view=economic" : ""}`;
  const pill = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-3 text-label lg:min-h-8",
      on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
    );
  return (
    <section aria-labelledby="pnl" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="pnl" className="text-title font-semibold">
          Profit and loss · {PERIODS[period]}
        </h2>
        <div className="flex flex-wrap gap-2">
          <nav aria-label="Period" className="flex gap-2">
            {(Object.keys(PERIODS) as (keyof typeof PERIODS)[]).map((p) => (
              <Link
                key={p}
                href={href(p, view) as Route}
                aria-current={p === period ? "true" : undefined}
                className={pill(p === period)}
              >
                {PERIODS[p]}
              </Link>
            ))}
          </nav>
          <nav aria-label="View" className="flex gap-2">
            {(["accounting", "economic"] as const).map((vw) => (
              <Link
                key={vw}
                href={href(period, vw) as Route}
                aria-current={vw === view ? "true" : undefined}
                className={pill(vw === view)}
              >
                {vw === "accounting" ? "Accounting" : "Economic"}
              </Link>
            ))}
          </nav>
        </div>
      </div>
      <PnlTable
        data={pnl}
        caption={`Profit and loss for ${v.display_name ?? `Cybercab ${v.number}`}, ${PERIODS[period].toLowerCase()}`}
        compare
      />
      <p className="text-label text-fg-muted">
        &ldquo;vs fleet avg&rdquo; compares with the average car over the same period; lines 25% or more above it are
        flagged ◆.
        {view === "economic"
          ? " The economic view subtracts revenue lost to downtime (an opportunity cost, not an accounting cost)."
          : ""}
      </p>
    </section>
  );
}
