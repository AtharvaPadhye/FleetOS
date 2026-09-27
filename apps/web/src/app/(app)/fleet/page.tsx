import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("fleet").label };

export default function FleetPage() {
  return (
    <SectionPlaceholder
      navKey="fleet"
      arrives="task 5.1, with simulated vehicles from Phase 3"
      willShow={[
        "All vehicles with status, battery, location, hub and today's economics",
        "Filters by status, hub, battery, profitability and issue, kept in the URL",
        "Column chooser, sorting and CSV export",
        "Click through to each vehicle's detail page",
      ]}
    />
  );
}
