import { LEDGER_CATEGORIES, pnl, type LedgerCategory, type Pnl } from "@fleetos/domain";

/** Rows of a P&L statement (kpis.md §3.2): revenue − variable costs = contribution; − fixed = net. */
export type StatementRow =
  | { kind: "line"; category: LedgerCategory; label: string; cents: number; share: number | null }
  | { kind: "total"; label: string; cents: number; margin: number | null };

export const CATEGORY_LABEL: Record<LedgerCategory, string> = {
  gross_ride_revenue: "Ride revenue",
  platform_fee: "Platform fees",
  electricity: "Electricity",
  cleaning: "Cleaning",
  maintenance: "Maintenance",
  roadside: "Roadside & towing",
  other_variable: "Other variable costs",
  insurance: "Insurance",
  financing: "Financing",
};

const VARIABLE: LedgerCategory[] = [
  "platform_fee",
  "electricity",
  "cleaning",
  "maintenance",
  "roadside",
  "other_variable",
];
const FIXED: LedgerCategory[] = ["insurance", "financing"];

export function buildStatement(totals: readonly { category: string; amount_cents: number | string }[]): {
  pnl: Pnl;
  rows: StatementRow[];
} {
  const lines = totals
    .filter((t): t is { category: LedgerCategory; amount_cents: number | string } =>
      (LEDGER_CATEGORIES as readonly string[]).includes(t.category),
    )
    .map((t) => ({ category: t.category, amountCents: Number(t.amount_cents) }));
  const p = pnl(lines);
  const rev = p.grossRevenueCents;
  const share = (c: number) => (rev > 0 ? c / rev : null);
  const line = (c: LedgerCategory, sign: 1 | -1): StatementRow => ({
    kind: "line",
    category: c,
    label: CATEGORY_LABEL[c],
    cents: sign * p.byCategory[c],
    share: share(p.byCategory[c]),
  });
  // Cost lines with nothing booked are left out, except the ones every fleet has.
  const shown = (c: LedgerCategory) => p.byCategory[c] > 0 || c === "platform_fee" || c === "electricity";
  return {
    pnl: p,
    rows: [
      line("gross_ride_revenue", 1),
      ...VARIABLE.filter(shown).map((c) => line(c, -1)),
      { kind: "total", label: "Contribution", cents: p.contributionCents, margin: p.contributionMargin },
      ...FIXED.filter((c) => p.byCategory[c] > 0).map((c) => line(c, -1)),
      { kind: "total", label: "Net contribution", cents: p.netContributionCents, margin: p.netMargin },
    ],
  };
}

/** First day of the month and today, as YYYY-MM-DD in the org's time zone. */
export function monthToDate(now: Date, timeZone: string): { from: string; to: string } {
  const to = new Intl.DateTimeFormat("en-CA", { timeZone }).format(now);
  return { from: `${to.slice(0, 8)}01`, to };
}
