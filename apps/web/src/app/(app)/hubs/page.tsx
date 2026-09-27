import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("hubs").label };

export default function HubsPage() {
  return (
    <SectionPlaceholder
      navKey="hubs"
      arrives="task 5.7"
      willShow={[
        "Chargers, cleaning bays and vehicles present per hub",
        "Hourly capacity forecast with overload warnings",
        "Ranked recommendations such as rerouting cars to another hub",
      ]}
    />
  );
}
