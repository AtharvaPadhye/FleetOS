import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("reports").label };

export default function ReportsPage() {
  return (
    <SectionPlaceholder
      navKey="reports"
      arrives="task 5.9"
      willShow={[
        "Monthly asset reports for owners and lenders in the light Paper theme",
        "Covenant status and asset health grade",
        "PDF export and expiring share links",
      ]}
    />
  );
}
