import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("vendors").label };

export default function VendorsPage() {
  return (
    <SectionPlaceholder
      navKey="vendors"
      arrives="task 5.6"
      willShow={[
        "Service partners by category with SLA compliance, response time and cost",
        "Vendor ranking for each dispatch",
        "Optional Airtable forms and directory sync (ADR-0015)",
      ]}
    />
  );
}
