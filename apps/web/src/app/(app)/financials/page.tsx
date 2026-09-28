import type { Metadata, Route } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { cn } from "@fleetos/ui/lib/cn";
import { AutoSubmitForm } from "@/components/fleet/auto-submit-form";
import { LabelledBarsLazy, PairBarsLazy } from "@/components/overview/overview-charts-lazy";
import { PageHeader } from "@/components/shell/page-header";
import { ApiProblem } from "@/lib/api/problem";
import { localDay, localMidnight } from "@/lib/api/period";
import { formatCents, formatPct } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { buildStatement } from "@/lib/statement";
import { createClient } from "@/lib/supabase/server";
import { CATEGORY_LABEL, financials, OPERATING_COSTS, periodPresets } from "@/lib/services/financials";

export const metadata: Metadata = { title: navItem("financials").label };

const MONEY_ROLES = new Set(["owner", "admin", "finance"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD = /^(mtd|last_30d|month:\d{4}-(0[1-9]|1[0-2]))$/;
const LABEL = {
  review: { glyph: "▼", text: "Review", cls: "text-severity-high" },
  monitor: { glyph: "●", text: "Monitor", cls: "text-fg-muted" },
  strong: { glyph: "▲", text: "Strong", cls: "text-status-available" },
} as const;
const control = "h-11 rounded-sm border border-border-control bg-canvas px-3 text-body text-fg lg:h-9";
const th = "px-3 py-2 text-left text-label font-medium text-fg-muted";
const td = "px-3 py-2 tabular-nums";
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** Financials (task 5.8, PRD FN-1..FN-5): period KPIs, trends, cost mix, insights, vehicle performance, export. */
export default async function FinancialsPage({ searchParams }: PageProps<"/financials">) {
  const item = navItem("financials");
  const sp = await searchParams;
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const canSeeMoney = MONEY_ROLES.has(activeOrg.role);
  const tz = activeOrg.timezone;
  const now = new Date();
  const fromDay = typeof sp.from === "string" && DAY.test(sp.from) ? sp.from : null;
  const toDay = typeof sp.to === "string" && DAY.test(sp.to) ? sp.to : null;
  const periodKey = typeof sp.period === "string" && PERIOD.test(sp.period) ? sp.period : null;
  const custom = fromDay && toDay && fromDay <= toDay;
  const query = custom
    ? { from: localMidnight(fromDay, tz).toISOString(), to: localMidnight(addDays(toDay, 1), tz).toISOString() }
    : { period: periodKey ?? "mtd" };
  const qs = custom ? `from=${fromDay}&to=${toDay}` : `period=${periodKey ?? "mtd"}`;
  const presets = periodPresets(now, tz);
  const pill = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-3 text-label lg:min-h-8",
      on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
    );

  let f: Awaited<ReturnType<typeof financials>> | null = null;
  let loadError: string | null = null;
  if (canSeeMoney) {
    try {
      f = await financials(await createClient(), activeOrg, query, now);
    } catch (e) {
      loadError = e instanceof ApiProblem ? e.message : "The ledger couldn't be loaded.";
    }
  }
  const periodLabel = f
    ? `${shortDay.format(new Date(`${f.period.fromDay}T00:00:00Z`))} – ${shortDay.format(new Date(`${f.period.toDay}T00:00:00Z`))}`
    : "";
  const statement = f
    ? buildStatement(f.money.map((m) => ({ category: m.category, amount_cents: m.amount_cents })))
    : null;
  const hasLines = (f?.money.length ?? 0) > 0;
  const k = f?.kpis;
  const Icon = item.icon;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={item.label}
        summary={item.summary}
        actions={
          <>
            {canSeeMoney && hasLines ? (
              <a
                href={`/financials/export.csv?${qs}`}
                className="inline-flex h-9 items-center gap-2 rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised"
              >
                <Download aria-hidden="true" className="size-4" /> Export CSV
              </a>
            ) : null}
            <Link
              href="/financials/imports"
              className="inline-flex h-9 items-center rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised"
            >
              Import payouts
            </Link>
          </>
        }
      />

      {canSeeMoney ? (
        <nav aria-label="Period" className="flex flex-wrap items-end gap-3">
          <ul className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <li key={p.key}>
                <Link
                  href={`/financials?period=${p.key}` as Route}
                  aria-current={!custom && (periodKey ?? "mtd") === p.key ? "true" : undefined}
                  className={pill(!custom && (periodKey ?? "mtd") === p.key)}
                >
                  {p.label}
                </Link>
              </li>
            ))}
          </ul>
          <AutoSubmitForm
            method="get"
            action="/financials"
            className="flex flex-wrap items-end gap-2"
            aria-label="Custom period"
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="from" className="text-label text-fg-muted">
                From
              </label>
              <input
                id="from"
                name="from"
                type="date"
                defaultValue={fromDay ?? ""}
                max={localDay(now, tz)}
                className={control}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="to" className="text-label text-fg-muted">
                To
              </label>
              <input
                id="to"
                name="to"
                type="date"
                defaultValue={toDay ?? ""}
                max={localDay(now, tz)}
                className={control}
              />
            </div>
            <button type="submit" className={cn(control, "font-medium hover:bg-raised")}>
              Show
            </button>
          </AutoSubmitForm>
        </nav>
      ) : null}

      {!canSeeMoney ? (
        <p className="rounded-md border border-divider bg-surface p-6 text-body text-fg-muted">
          Money is visible to owners, admins and finance. Ask an owner if you need access.
        </p>
      ) : loadError ? (
        <p role="alert" className="rounded-md border border-severity-high p-6 text-body">
          {loadError} Refresh to try again.
        </p>
      ) : !hasLines || !f || !k ? (
        <EmptyState
          icon={<Icon aria-hidden="true" />}
          title={
            periodKey === "mtd" || (!periodKey && !custom)
              ? "Nothing booked this month yet"
              : "Nothing booked in this period"
          }
          description="Revenue arrives from payout imports or a connected earnings feed; costs from charging, vendor jobs and each car's monthly insurance and financing. Import a payout statement to start."
        />
      ) : (
        <>
          <section aria-labelledby="period-kpis" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="period-kpis" className="text-title font-semibold">
                {periodLabel}
              </h2>
              {f.isDemo ? <DataSourceBadge source="simulated" /> : null}
            </div>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-divider bg-divider md:grid-cols-4">
              {(
                [
                  ["Ride revenue", formatCents(k.gross_revenue_cents), null],
                  ["Operating costs", formatCents(-k.operating_costs_cents), "Fees, electricity and service"],
                  [
                    "Contribution",
                    formatCents(k.contribution_cents, { signed: true }),
                    `${formatPct(k.contribution_margin)} margin`,
                  ],
                  ["Net after insurance & financing", formatCents(k.net_contribution_cents, { signed: true }), null],
                  ["Revenue per vehicle", formatCents(k.revenue_per_vehicle_cents), null],
                  [
                    "Revenue per available hour",
                    k.revenue_per_available_hour_cents === null
                      ? "—"
                      : formatCents(k.revenue_per_available_hour_cents, { decimals: true }),
                    null,
                  ],
                  [
                    "Operating cost per revenue mile",
                    k.cost_per_revenue_mile_cents === null
                      ? "Needs ride data"
                      : formatCents(k.cost_per_revenue_mile_cents, { decimals: true }),
                    k.revenue_miles ? `${Math.round(k.revenue_miles).toLocaleString("en-US")} revenue miles` : null,
                  ],
                  [
                    "Downtime cost",
                    formatCents(k.downtime_cost_cents),
                    "Lost rides; not a cost line, already missing from revenue",
                  ],
                ] as [string, string, string | null][]
              ).map(([label, value, sub]) => (
                <div key={label} className="flex flex-col gap-1 bg-surface p-4">
                  <dt className="text-label text-fg-muted">{label}</dt>
                  <dd className="text-display-s font-display font-semibold tabular-nums">{value}</dd>
                  {sub ? <dd className="text-label text-fg-muted">{sub}</dd> : null}
                </div>
              ))}
            </dl>
          </section>

          {f.insights.length ? (
            <section aria-labelledby="insights" className="flex flex-col gap-3">
              <h2 id="insights" className="text-title font-semibold">
                Insights
              </h2>
              <ul className="flex flex-col gap-2">
                {f.insights.map((i) => (
                  <li
                    key={i.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-divider bg-surface p-3"
                  >
                    <div className="flex min-w-0 flex-col gap-1">
                      <Link href={i.href as Route} className="font-medium hover:underline">
                        {i.title}
                      </Link>
                      <span className="text-label text-fg-muted">
                        {i.detail}
                        {i.drivers.length
                          ? ` (${i.drivers.map((d) => `${CATEGORY_LABEL[d.category]} ${Math.round(d.share * 100)}% of the gap`).join(", ")})`
                          : ""}
                      </span>
                    </div>
                    {i.impact_cents ? (
                      <span className="tabular-nums">
                        {formatCents(i.impact_cents)} <span className="text-label text-fg-muted">below par</span>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="trends" className="grid gap-6 lg:grid-cols-2">
            <h2 id="trends" className="sr-only">
              Trends and cost mix
            </h2>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-body font-semibold">Revenue and contribution by week</h3>
              <p className="text-label text-fg-muted">
                {f.weekly.length} {f.weekly.length === 1 ? "week" : "weeks"}; contribution is revenue minus fees,
                electricity and service.
              </p>
              <PairBarsLazy
                points={f.weekly.map((w) => ({ x: w.week, a: w.revenue_cents, b: w.contribution_cents }))}
                names={["Ride revenue", "Contribution"]}
                tick="week"
              />
              <details className="text-label">
                <summary className="cursor-pointer text-fg-muted">View as table</summary>
                <table className="mt-2 w-full">
                  <thead>
                    <tr>
                      <th className={th}>Week of</th>
                      <th className={th}>Ride revenue</th>
                      <th className={th}>Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.weekly.map((w) => (
                      <tr key={w.week}>
                        <td className={td}>{w.week}</td>
                        <td className={td}>{formatCents(w.revenue_cents)}</td>
                        <td className={td}>{formatCents(w.contribution_cents, { signed: true })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-body font-semibold">Operating costs by category</h3>
              <p className="text-label text-fg-muted">
                {f.costBreakdown[0]
                  ? `${f.costBreakdown[0].label} is the largest at ${formatPct(f.costBreakdown[0].share, 0)} of ${formatCents(k.operating_costs_cents)}.`
                  : "No operating costs yet."}
              </p>
              {f.costBreakdown.length ? (
                <LabelledBarsLazy
                  rows={f.costBreakdown.map((c) => ({ label: c.label, value: c.cents }))}
                  format="usd"
                  unit="Cost"
                />
              ) : null}
              <details className="text-label">
                <summary className="cursor-pointer text-fg-muted">View as table</summary>
                <table className="mt-2 w-full">
                  <thead>
                    <tr>
                      <th className={th}>Category</th>
                      <th className={th}>Cost</th>
                      <th className={th}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.costBreakdown.map((c) => (
                      <tr key={c.category}>
                        <td className={td}>{c.label}</td>
                        <td className={td}>{formatCents(c.cents)}</td>
                        <td className={td}>{formatPct(c.share)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          </section>

          <section aria-labelledby="performance" className="flex flex-col gap-3">
            <h2 id="performance" className="text-title font-semibold">
              Vehicle performance
            </h2>
            <p className="text-label text-fg-muted">
              Cars that need attention first: Review, then Monitor, then Strong, then by how far below the fleet margin.
            </p>
            <div
              className="overflow-x-auto rounded-md border border-divider"
              role="region"
              aria-labelledby="performance"
              tabIndex={0}
            >
              <table className="w-full min-w-[48rem] text-body">
                <thead className="bg-raised">
                  <tr>
                    <th scope="col" className={th}>
                      Vehicle
                    </th>
                    <th scope="col" className={th}>
                      Performance
                    </th>
                    <th scope="col" className={cn(th, "text-right")}>
                      Revenue
                    </th>
                    <th scope="col" className={cn(th, "text-right")}>
                      Operating costs
                    </th>
                    <th scope="col" className={cn(th, "text-right")}>
                      Contribution
                    </th>
                    <th scope="col" className={cn(th, "text-right")}>
                      Margin
                    </th>
                    <th scope="col" className={cn(th, "text-right")}>
                      Availability
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {f.rows.map((r) => (
                    <tr key={r.id}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <Link href={`/fleet/${r.number}/financials` as Route} className="hover:underline">
                          {r.number}
                        </Link>
                        {r.hub ? <span className="ml-2 text-label text-fg-muted">{r.hub}</span> : null}
                      </th>
                      <td className="px-3 py-2">
                        {r.label ? (
                          <span
                            className={cn(
                              "inline-flex items-center gap-1.5 text-label font-medium",
                              LABEL[r.label].cls,
                            )}
                          >
                            <span aria-hidden="true">{LABEL[r.label].glyph}</span>
                            {LABEL[r.label].text}
                          </span>
                        ) : (
                          <span className="text-fg-subtle">—</span>
                        )}
                      </td>
                      <td className={cn(td, "text-right")}>{formatCents(r.revenue_cents)}</td>
                      <td className={cn(td, "text-right")}>
                        {formatCents(-OPERATING_COSTS.reduce((s, c) => s + (r.costs[c] ?? 0), 0))}
                      </td>
                      <td className={cn(td, "text-right")}>{formatCents(r.contribution_cents, { signed: true })}</td>
                      <td className={cn(td, "text-right")}>{formatPct(r.margin)}</td>
                      <td className={cn(td, "text-right")}>{formatPct(r.availability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {statement ? (
            <section aria-labelledby="statement" className="flex flex-col gap-3">
              <h2 id="statement" className="text-title font-semibold">
                Profit and loss
              </h2>
              <div
                className="overflow-x-auto rounded-md border border-divider"
                role="region"
                aria-labelledby="statement"
                tabIndex={0}
              >
                <table className="w-full min-w-[20rem] text-body">
                  <thead className="border-b border-divider bg-raised">
                    <tr>
                      <th scope="col" className="px-4 py-2 text-left text-label font-medium text-fg-muted">
                        Line
                      </th>
                      <th scope="col" className="px-4 py-2 text-right text-label font-medium text-fg-muted">
                        Amount
                      </th>
                      <th scope="col" className="px-4 py-2 text-right text-label font-medium text-fg-muted">
                        Of revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {statement.rows.map((r) =>
                      r.kind === "line" ? (
                        <tr key={r.label}>
                          <th scope="row" className="px-4 py-2 text-left font-normal">
                            {r.label}
                          </th>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {formatCents(r.cents, { decimals: true })}
                          </td>
                          <td className="px-4 py-2 text-right text-fg-muted tabular-nums">{formatPct(r.share)}</td>
                        </tr>
                      ) : (
                        <tr key={r.label} className="bg-raised">
                          <th scope="row" className="px-4 py-2 text-left font-semibold">
                            {r.label}
                          </th>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">
                            {formatCents(r.cents, { decimals: true })}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatPct(r.margin)}</td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
              <p className="text-label text-fg-muted">
                Contribution is revenue minus variable costs. Insurance and financing are spread evenly over each day a
                car is in the fleet. Downtime isn&apos;t a cost here: lost rides are already missing from revenue.
              </p>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
