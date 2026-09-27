import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("service").label };

export default function ServicePage() {
  return (
    <SectionPlaceholder
      navKey="service"
      arrives="task 5.5"
      willShow={[
        "Active tickets with live SLA countdowns",
        "Vendor, ETA, cost and lost revenue per ticket",
        "Lifecycle actions from dispatch to return to service",
        "Evidence photos and a full activity log",
      ]}
    />
  );
}
