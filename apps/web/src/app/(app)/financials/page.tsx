import type { Metadata } from "next";
import Link from "next/link";
import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { formatCents, formatPct } from "@/lib/format";
import { navItem } from "@/lib/nav";
import { getAppContext } from "@/lib/session";
import { buildStatement, monthToDate } from "@/lib/statement";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: navItem("financials").label };

const MONEY_ROLES = new Set(["owner", "admin", "finance"]);
const dayLabel = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default async function FinancialsPage() {
  const item = navItem("financials");
  const { activeOrg } = await getAppContext();
  const canSeeMoney = activeOrg ? MONEY_ROLES.has(activeOrg.role) : false;
  const period = monthToDate(new Date(), activeOrg?.timezone ?? "UTC");

  const Icon = item.icon;
  let statement: ReturnType<typeof buildStatement> | null = null;
  let hasLines = false;
  let loadError: string | null = null;
  if (activeOrg && canSeeMoney) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("ledger_totals", {
      p_org: activeOrg.id,
      p_from: period.from,
      p_to: period.to,
    });
    if (error) loadError = error.message;
    else {
      hasLines = (data ?? []).length > 0;
      statement = buildStatement((data ?? []) as { category: string; amount_cents: number }[]);
    }
  }
  const periodLabel = `${dayLabel.format(new Date(`${period.from}T00:00:00Z`))} – ${dayLabel.format(new Date(`${period.to}T00:00:00Z`))}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title={item.label}
        summary={item.summary}
        actions={
          <Link
            href="/financials/imports"
            className="inline-flex h-9 items-center rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised"
          >
            Import payouts
          </Link>
        }
      />

      {!canSeeMoney ? (
        <p className="rounded-md border border-divider bg-surface p-6 text-body text-fg-muted">
          Money is visible to owners, admins and finance. Ask an owner if you need access.
        </p>
      ) : loadError ? (
        <p role="alert" className="rounded-md border border-severity-high p-6 text-body">
          The ledger couldn&apos;t be loaded ({loadError}). Refresh to try again.
        </p>
      ) : !hasLines ? (
        <EmptyState
          icon={<Icon aria-hidden="true" />}
          title="Nothing booked this month yet"
          description="Revenue arrives from payout imports or a connected earnings feed; costs from charging, vendor jobs and each car's monthly insurance and financing. Import a payout statement to start."
        />
      ) : statement ? (
        <>
          <section aria-labelledby="money-strip" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 id="money-strip" className="text-title font-semibold">
                Month to date · {periodLabel}
              </h2>
              {activeOrg?.isDemo ? <DataSourceBadge source="simulated" /> : null}
            </div>
            <dl className="grid gap-4 rounded-md border border-divider bg-surface p-6 sm:grid-cols-3">
              <div>
                <dt className="text-label text-fg-muted">Revenue</dt>
                <dd className="font-display text-display-xl font-semibold tabular-nums">
                  {formatCents(statement.pnl.grossRevenueCents)}
                </dd>
              </div>
              <div>
                <dt className="text-label text-fg-muted">Contribution</dt>
                <dd className="font-display text-display-xl font-semibold tabular-nums">
                  {formatCents(statement.pnl.contributionCents)}
                  <span className="ml-2 text-body font-normal text-fg-muted">
                    {formatPct(statement.pnl.contributionMargin)}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-label text-fg-muted">Net after insurance &amp; financing</dt>
                <dd className="font-display text-display-xl font-semibold tabular-nums">
                  {formatCents(statement.pnl.netContributionCents)}
                  <span className="ml-2 text-body font-normal text-fg-muted">{formatPct(statement.pnl.netMargin)}</span>
                </dd>
              </div>
            </dl>
          </section>

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
              Per-vehicle P&amp;L, trends and insights arrive in task 5.8.
            </p>
          </section>
        </>
      ) : null}
    </div>
  );
}
