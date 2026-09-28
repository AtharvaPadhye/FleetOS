import type { Route } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { SeverityBadge } from "@fleetos/ui/components/severity-badge";
import type { AttentionGroup } from "@/lib/attention";
import { formatCents } from "@/lib/format";
import { AttentionDispatch } from "./attention-dispatch";
import { BleedLine } from "./bleed-line";

const link =
  "inline-flex h-11 items-center rounded-sm border border-border-control px-4 text-body font-medium hover:bg-raised lg:h-9";

/** "Needs attention" (PRD OV-2): what's costing money, biggest first, each with one action. */
export function AttentionList({
  groups,
  asOf,
  canAct,
  resolvedToday,
}: {
  groups: AttentionGroup[];
  asOf: number;
  canAct: boolean;
  resolvedToday: number;
}) {
  const max = Math.max(0, ...groups.map((g) => g.revenue_at_risk_cents));
  return (
    <section aria-labelledby="attention" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="attention" className="text-title font-semibold">
          Needs attention
        </h2>
        <Link href="/exceptions" className="text-label text-fg-muted underline underline-offset-4">
          All exceptions
        </Link>
      </div>
      {groups.length === 0 ? (
        <div className="flex items-center gap-3 rounded-md border border-dashed border-border-strong p-5 text-fg-muted">
          <CircleCheck aria-hidden="true" className="size-5" />
          Nothing needs attention. {resolvedToday} resolved today.
        </div>
      ) : (
        <ol className="flex flex-col gap-2">
          {groups.slice(0, 8).map((g) => (
            <li
              key={g.key}
              className="grid gap-3 rounded-md border border-divider bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <SeverityBadge severity={g.severity} />
                  <span className="font-medium">{g.title}</span>
                </div>
                <p className="text-label text-fg-muted">
                  {[g.subtitle, g.recommended_action].filter(Boolean).join(" · ")}
                </p>
                <BleedLine atRiskCents={g.revenue_at_risk_cents} maxAtRiskCents={max} bleed={g.bleed} asOf={asOf} />
              </div>
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <span className="tabular-nums">
                  {formatCents(g.revenue_at_risk_cents)} <span className="text-label text-fg-muted">at risk</span>
                </span>
                {g.action.kind === "dispatch" && canAct ? (
                  <AttentionDispatch exceptionId={g.action.target} label={g.recommended_action} />
                ) : (
                  <Link
                    href={(g.action.kind === "dispatch" ? `/exceptions/${g.action.target}` : g.action.target) as Route}
                    className={link}
                  >
                    {g.action.kind === "open_fleet"
                      ? `View ${g.affected_count} vehicles`
                      : g.action.kind === "open_hub"
                        ? "Review plan"
                        : "Open"}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
      {groups.length > 8 ? (
        <Link href="/exceptions" className="text-label text-fg-muted underline underline-offset-4">
          {groups.length - 8} more
        </Link>
      ) : null}
    </section>
  );
}
