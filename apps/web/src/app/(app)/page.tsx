import type { Metadata, Route } from "next";
import Link from "next/link";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { cn } from "@fleetos/ui/lib/cn";
import { LiveRefresh } from "@/components/live/live-refresh";
import { AttentionList } from "@/components/overview/attention-list";
import { AvailabilityTrendLazy, LabelledBarsLazy, RevenueVsCostLazy } from "@/components/overview/overview-charts-lazy";
import { PageHeader } from "@/components/shell/page-header";
import { formatCents, formatHours, formatPct } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { attention } from "@/lib/services/attention";
import { exceptionSummary } from "@/lib/services/exceptions";
import { overview, OVERVIEW_PERIODS, type OverviewPeriod } from "@/lib/services/overview";

export const metadata: Metadata = { title: navItem("overview").label };

const CAUSE: Record<string, string> = {
  charging: "Charging",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  incident: "Incident",
  offline: "Offline",
};

function Delta({
  now,
  prev,
  money,
  invert,
}: {
  now: number | null;
  prev: number | null;
  money?: boolean;
  invert?: boolean;
}) {
  // Nothing to compare with (e.g. a fleet's first day): no delta rather than "+100%".
  if (now === null || prev === null || (money && prev === 0)) return null;
  const d = now - prev;
  if (Math.abs(d) < (money ? 50 : 0.0005)) return <span className="text-fg-muted">same as before</span>;
  const up = d > 0;
  const good = invert ? !up : up;
  return (
    <span className={good ? "text-money-gain" : "text-fg-muted"}>
      <span aria-hidden="true">{up ? "▲" : "▼"} </span>
      {money ? formatCents(Math.abs(d)) : formatPct(Math.abs(d))} {up ? "more" : "less"}
    </span>
  );
}

function Figure({
  title,
  summary,
  table,
  children,
}: {
  title: string;
  summary: string;
  table: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = title.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-2">
      <h3 id={id} className="text-body font-semibold">
        {title}
      </h3>
      <p className="text-label text-fg-muted">{summary}</p>
      {children}
      <details className="text-label">
        <summary className="cursor-pointer text-fg-muted">View as table</summary>
        <div className="mt-2 overflow-x-auto">{table}</div>
      </details>
    </section>
  );
}

const th = "px-2 py-1 text-left font-medium text-fg-muted";
const td = "px-2 py-1 tabular-nums";

/** Overview (task 5.3, PRD OV-1..4): what's costing money now, today's numbers, trends and fleet health. */
export default async function OverviewPage({ searchParams }: PageProps<"/">) {
  const item = navItem("overview");
  const sp = await searchParams;
  const period = (
    typeof sp.period === "string" && sp.period in OVERVIEW_PERIODS ? sp.period : "today"
  ) as OverviewPeriod;
  const { activeOrg } = await getAppContext();
  if (!activeOrg) return null;
  const db = await createClient();
  const now = new Date();
  const [o, att, exSummary, setup] = await Promise.all([
    overview(db, activeOrg, period, now),
    attention(db, activeOrg, now),
    exceptionSummary(db, activeOrg, now),
    activeOrg.isDemo
      ? Promise.resolve(null)
      : Promise.all([
          db.from("hubs").select("id", { count: "exact", head: true }).eq("org_id", activeOrg.id),
          db.from("vehicles").select("id", { count: "exact", head: true }).eq("org_id", activeOrg.id),
          db.from("vendors").select("id", { count: "exact", head: true }).eq("org_id", activeOrg.id),
          db.from("revenue_imports").select("id", { count: "exact", head: true }).eq("org_id", activeOrg.id),
        ]),
  ]);
  const k = o.kpis;
  const p = o.prev;
  const canAct = ["owner", "admin", "ops"].includes(activeOrg.role);
  const noRevenue = o.canSeeMoney && (k.gross_revenue_cents ?? 0) === 0;
  const tiles: { label: string; value: string; sub?: React.ReactNode; hidden?: boolean }[] = [
    { label: "Vehicles", value: String(k.total_vehicles), sub: `${k.earning_now} earning now` },
    {
      label: "Available now",
      value: String(k.available_now),
      sub: (
        <>
          {formatPct(k.availability)} availability · target {formatPct(k.availability_target, 0)}
        </>
      ),
    },
    {
      label: "Ride revenue",
      value: noRevenue ? "Awaiting revenue data" : formatCents(k.gross_revenue_cents),
      sub: noRevenue ? (
        "Import a payout CSV under Financials"
      ) : (
        <Delta now={k.gross_revenue_cents} prev={p.gross_revenue_cents} money />
      ),
      hidden: !o.canSeeMoney,
    },
    {
      label: "Contribution",
      value: noRevenue ? "—" : formatCents(k.contribution_cents),
      sub: noRevenue ? undefined : <Delta now={k.contribution_cents} prev={p.contribution_cents} money />,
      hidden: !o.canSeeMoney,
    },
    {
      label: "Downtime cost",
      value: formatCents(k.downtime_cost_cents),
      sub: <Delta now={k.downtime_cost_cents} prev={p.downtime_cost_cents} money invert />,
      hidden: !o.canSeeMoney,
    },
    {
      label: "Average battery",
      value: formatPct(k.avg_soc, 0),
      sub: `${k.low_soc_count} cars below the low-battery line`,
    },
  ];
  const causes = Object.entries(k.downtime_hours_by_cause)
    .filter(([, h]) => h > 0)
    .map(([c, h]) => ({ label: CAUSE[c] ?? c, value: h }))
    .sort((a, b) => b.value - a.value);
  const trend = o.availabilityTrend;
  const trendVals = trend.flatMap((t) => (t.availability === null ? [] : [t.availability]));
  const avg = trendVals.length ? trendVals.reduce((s, v) => s + v, 0) / trendVals.length : null;
  const below = trendVals.filter((v) => v < o.availabilityTarget).length;
  const rvc = o.revenueVsCost ?? [];
  const rev7 = rvc.reduce((s, d) => s + d.revenue, 0);
  const cost7 = rvc.reduce((s, d) => s + d.cost, 0);
  const periodLabel = OVERVIEW_PERIODS[period].toLowerCase();
  const pill = (on: boolean) =>
    cn(
      "inline-flex min-h-11 items-center rounded-full border px-3 text-label lg:min-h-8",
      on ? "border-fg bg-raised" : "border-divider hover:bg-raised",
    );
  const steps = setup
    ? [
        { done: (setup[0].count ?? 0) > 0, label: "Add hubs", href: "/hubs" },
        { done: (setup[1].count ?? 0) > 0, label: "Add vehicles", href: "/fleet" },
        { done: (setup[2].count ?? 0) > 0, label: "Add vendors", href: "/vendors" },
        { done: (setup[3].count ?? 0) > 0, label: "Import revenue (payout CSV)", href: "/financials/imports" },
      ]
    : [];

  return (
    <div className="flex flex-col gap-8">
      <LiveRefresh orgId={activeOrg.id} />
      <PageHeader
        title={item.label}
        summary={item.summary}
        actions={
          <nav aria-label="Period">
            <ul className="flex gap-2">
              {(Object.keys(OVERVIEW_PERIODS) as OverviewPeriod[]).map((key) => (
                <li key={key}>
                  <Link
                    href={(key === "today" ? "/" : `/?period=${key}`) as Route}
                    aria-current={period === key ? "true" : undefined}
                    className={pill(period === key)}
                  >
                    {OVERVIEW_PERIODS[key]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        }
      />
      {activeOrg.isDemo ? (
        <p className="flex items-center gap-2 text-label text-fg-muted">
          <DataSourceBadge source="simulated" /> Demo data: a simulated Phoenix fleet, live around the clock.
        </p>
      ) : steps.some((s) => !s.done) ? (
        <section
          aria-labelledby="setup"
          className="flex flex-col gap-2 rounded-md border border-divider bg-surface p-4"
        >
          <h2 id="setup" className="text-title font-semibold">
            Finish setting up
          </h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {steps.map((s) => (
              <li key={s.label} className="flex items-center gap-2">
                <span aria-hidden="true" className={s.done ? "text-status-available" : "text-fg-subtle"}>
                  {s.done ? "✓" : "○"}
                </span>
                {s.done ? (
                  <span className="text-fg-muted line-through">{s.label}</span>
                ) : (
                  <Link href={s.href as Route} className="underline underline-offset-4">
                    {s.label}
                  </Link>
                )}
                <span className="sr-only">{s.done ? "(done)" : "(to do)"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <AttentionList groups={att.groups} asOf={att.asOf} canAct={canAct} resolvedToday={exSummary.resolved_today} />

      <section aria-labelledby="kpis" className="flex flex-col gap-3">
        <h2 id="kpis" className="text-title font-semibold">
          {OVERVIEW_PERIODS[period]}{" "}
          <span className="text-label font-normal text-fg-muted">
            compared with the {period === "last_7d" ? "7 days before" : "day before"}
          </span>
        </h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-divider bg-divider md:grid-cols-3 xl:grid-cols-6">
          {tiles
            .filter((t) => !t.hidden)
            .map((t) => (
              <div key={t.label} className="flex flex-col gap-1 bg-surface p-4">
                <dt className="text-label text-fg-muted">{t.label}</dt>
                <dd className="text-display-s font-display font-semibold tabular-nums">{t.value}</dd>
                {t.sub ? <dd className="text-label text-fg-muted">{t.sub}</dd> : null}
              </div>
            ))}
        </dl>
      </section>

      <section aria-labelledby="trends" className="flex flex-col gap-4">
        <h2 id="trends" className="text-title font-semibold">
          Trends
        </h2>
        <div className="grid gap-6 lg:grid-cols-2">
          <Figure
            title="Availability, last 30 days"
            summary={
              avg === null
                ? "No history yet."
                : `Averaged ${formatPct(avg)} against a ${formatPct(o.availabilityTarget, 0)} target; below target on ${below} of ${trendVals.length} days.`
            }
            table={
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Day</th>
                    <th className={th}>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {trend.map((t) => (
                    <tr key={t.day}>
                      <td className={td}>{t.day}</td>
                      <td className={td}>{formatPct(t.availability)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <AvailabilityTrendLazy points={trend} target={o.availabilityTarget} />
          </Figure>
          {o.canSeeMoney ? (
            <Figure
              title="Revenue vs operating cost, last 7 days"
              summary={`Ride revenue ${formatCents(rev7)} against ${formatCents(cost7)} of platform fees, electricity and service; insurance and financing are on Financials.`}
              table={
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>Day</th>
                      <th className={th}>Ride revenue</th>
                      <th className={th}>Operating cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rvc.map((d) => (
                      <tr key={d.day}>
                        <td className={td}>{d.day}</td>
                        <td className={td}>{formatCents(d.revenue)}</td>
                        <td className={td}>{formatCents(d.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              <RevenueVsCostLazy points={rvc} />
            </Figure>
          ) : null}
          <Figure
            title={`Downtime by cause, ${periodLabel}`}
            summary={
              causes.length
                ? `${formatHours(causes.reduce((s, c) => s + c.value, 0))} in total; most from ${causes[0]!.label.toLowerCase()} (${formatHours(causes[0]!.value)}).`
                : "No downtime recorded."
            }
            table={
              <table className="w-full">
                <thead>
                  <tr>
                    <th className={th}>Cause</th>
                    <th className={th}>Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {causes.map((c) => (
                    <tr key={c.label}>
                      <td className={td}>{c.label}</td>
                      <td className={td}>{formatHours(c.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {causes.length ? <LabelledBarsLazy rows={causes} format="hours" unit="Downtime" /> : null}
          </Figure>
          {o.marginByHub ? (
            <Figure
              title={`Contribution margin by hub, ${periodLabel}`}
              summary={
                o.marginByHub.length
                  ? `Highest: ${o.marginByHub[0]!.hub} at ${formatPct(o.marginByHub[0]!.margin)}; lowest: ${o.marginByHub.at(-1)!.hub} at ${formatPct(o.marginByHub.at(-1)!.margin)}.`
                  : "No revenue by hub yet."
              }
              table={
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className={th}>Hub</th>
                      <th className={th}>Margin</th>
                      <th className={th}>Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.marginByHub.map((h) => (
                      <tr key={h.hub}>
                        <td className={td}>{h.hub}</td>
                        <td className={td}>{formatPct(h.margin)}</td>
                        <td className={td}>{formatCents(h.contribution_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              }
            >
              {o.marginByHub.length ? (
                <LabelledBarsLazy
                  rows={o.marginByHub.map((h) => ({ label: h.hub, value: h.margin! }))}
                  format="pct"
                  unit="Margin"
                />
              ) : null}
            </Figure>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="health" className="flex flex-col gap-3">
        <h2 id="health" className="text-title font-semibold">
          Fleet health
        </h2>
        <ul className="grid gap-px overflow-hidden rounded-md border border-divider bg-divider sm:grid-cols-2 xl:grid-cols-5">
          {o.health.map((h) => (
            <li key={h.key} className="flex flex-col gap-1 bg-surface p-4">
              <span className="flex items-center justify-between gap-2 text-label text-fg-muted">
                {h.label}
                {h.source === "simulated" ? <DataSourceBadge source="simulated" /> : null}
              </span>
              <span className="text-display-s font-display font-semibold tabular-nums">
                {h.value === null ? (h.source === "unavailable" ? "Not connected" : "—") : formatPct(h.value, 1)}
              </span>
              <span className="text-label text-fg-muted">
                {h.source === "unavailable" ? "Needs cabin cameras or ride data (preview capability)" : h.detail}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
