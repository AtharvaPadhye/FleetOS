import { CATEGORY_LABEL } from "@/lib/statement";
import { formatCents, formatPct } from "@/lib/format";
import type { LedgerCategory } from "@fleetos/domain";
import { cn } from "@fleetos/ui/lib/cn";

/**
 * P&L statement (PRD VD-3, design-system PnlStatement): revenue, variable costs, contribution, fixed
 * allocations, net; each cost line can carry "+N% vs fleet avg" and a flag; the downtime memo sits below,
 * never inside, the totals (kpis.md: opportunity cost, not accounting cost).
 */
export interface PnlData {
  lines: { category: LedgerCategory; amount_cents: number; vs_fleet_avg_pct: number | null; flagged: boolean }[];
  gross_revenue_cents: number;
  contribution_cents: number;
  contribution_margin: number | null;
  fixed_allocations_cents: number;
  net_contribution_cents: number;
  downtime_cost_cents: number;
  economic_net_cents: number | null;
}

const VARIABLE: LedgerCategory[] = [
  "platform_fee",
  "electricity",
  "cleaning",
  "maintenance",
  "roadside",
  "other_variable",
];
const FIXED: LedgerCategory[] = ["insurance", "financing"];

export function PnlTable({ data, caption, compare }: { data: PnlData; caption: string; compare: boolean }) {
  const byCat = new Map(data.lines.map((l) => [l.category, l]));
  const rev = data.gross_revenue_cents;
  const row = (c: LedgerCategory, sign: 1 | -1) => {
    const l = byCat.get(c);
    if (!l || (l.amount_cents === 0 && c !== "gross_ride_revenue" && c !== "platform_fee" && c !== "electricity"))
      return null;
    return (
      <tr key={c}>
        <th scope="row" className="px-4 py-2 text-left font-normal">
          {CATEGORY_LABEL[c]}
        </th>
        <td className="px-4 py-2 text-right tabular-nums">{formatCents(sign * l.amount_cents, { decimals: true })}</td>
        <td className="px-4 py-2 text-right text-fg-muted tabular-nums">
          {rev > 0 ? formatPct(l.amount_cents / rev) : "—"}
        </td>
        {compare ? (
          <td className={cn("px-4 py-2 text-right tabular-nums", l.flagged ? "text-severity-high" : "text-fg-muted")}>
            {l.flagged ? <span aria-hidden="true">◆ </span> : null}
            {l.vs_fleet_avg_pct === null
              ? "—"
              : `${l.vs_fleet_avg_pct > 0 ? "+" : l.vs_fleet_avg_pct < 0 ? "−" : ""}${Math.abs(l.vs_fleet_avg_pct).toFixed(0)}%`}
            {l.flagged ? <span className="sr-only"> (flagged: well above the fleet average)</span> : null}
          </td>
        ) : null}
      </tr>
    );
  };
  const total = (label: string, cents: number, margin: number | null) => (
    <tr className="bg-raised">
      <th scope="row" className="px-4 py-2 text-left font-semibold">
        {label}
      </th>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatCents(cents, { decimals: true })}</td>
      <td className="px-4 py-2 text-right font-semibold tabular-nums">{formatPct(margin)}</td>
      {compare ? <td /> : null}
    </tr>
  );
  return (
    <div className="overflow-x-auto rounded-md border border-divider" role="region" aria-label={caption} tabIndex={0}>
      <table className="w-full min-w-[22rem] text-body">
        <caption className="sr-only">{caption}</caption>
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
            {compare ? (
              <th scope="col" className="px-4 py-2 text-right text-label font-medium text-fg-muted">
                vs fleet avg
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {row("gross_ride_revenue", 1)}
          {VARIABLE.map((c) => row(c, -1))}
          {total("Contribution", data.contribution_cents, data.contribution_margin)}
          {FIXED.map((c) => row(c, -1))}
          {total("Net contribution", data.net_contribution_cents, rev > 0 ? data.net_contribution_cents / rev : null)}
          <tr>
            <th scope="row" className="px-4 py-2 text-left font-normal text-fg-muted">
              Memo: downtime (lost revenue, not a cost)
            </th>
            <td className="px-4 py-2 text-right text-fg-muted tabular-nums">
              {formatCents(-data.downtime_cost_cents, { decimals: true })}
            </td>
            <td />
            {compare ? <td /> : null}
          </tr>
          {data.economic_net_cents !== null
            ? total(
                "Economic net (after downtime)",
                data.economic_net_cents,
                rev > 0 ? data.economic_net_cents / rev : null,
              )
            : null}
        </tbody>
      </table>
    </div>
  );
}
