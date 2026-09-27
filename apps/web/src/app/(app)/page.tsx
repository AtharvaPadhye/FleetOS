import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("overview").label };

export default function OverviewPage() {
  return (
    <SectionPlaceholder
      navKey="overview"
      arrives="task 5.3, with simulated data from Phase 3"
      willShow={[
        "The money strip: revenue, contribution and revenue at risk today",
        "Needs attention: open issues ranked by money at risk, each with its live Bleed line",
        "Availability trend, revenue vs cost, downtime by cause and margin by hub",
        "Fleet health and the top Copilot recommendation",
      ]}
    />
  );
}
