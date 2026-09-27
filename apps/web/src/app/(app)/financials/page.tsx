import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("financials").label };

export default function FinancialsPage() {
  return (
    <SectionPlaceholder
      navKey="financials"
      arrives="task 5.8, with revenue from simulated data or CSV import"
      willShow={[
        "Fleet and per-vehicle P&L with contribution and fixed costs",
        "Cost breakdown and anomaly insights",
        "Payout CSV import with validation",
      ]}
    />
  );
}
