import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@fleetos/ui/components/empty-state";
import { PageHeader } from "@/components/shell/page-header";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("financials").label };

export default function FinancialsPage() {
  const item = navItem("financials");
  const Icon = item.icon;
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
      <EmptyState
        icon={<Icon aria-hidden="true" />}
        title="Financials is being built"
        description="This section arrives in task 5.8. Revenue already flows into the ledger from the simulator and from payout imports. It will show:"
      >
        <ul className="list-disc space-y-1 pl-5 text-fg-muted marker:text-fg-subtle">
          <li>Fleet and per-vehicle P&amp;L with contribution and fixed costs</li>
          <li>Cost breakdown and anomaly insights</li>
          <li>Payout CSV import with validation (available now under Import payouts)</li>
        </ul>
      </EmptyState>
    </div>
  );
}
