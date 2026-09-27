import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/shell/section-placeholder";
import { navItem } from "@/lib/nav";

export const metadata: Metadata = { title: navItem("settings").label };

export default function SettingsPage() {
  return (
    <SectionPlaceholder
      navKey="settings"
      arrives="tasks 2.4, 4.5 and 5.10"
      willShow={[
        "Organization, members and roles",
        "Fleet policies and exception rules",
        "Tesla and other data integrations, with each data source's status",
        "Notifications",
      ]}
    />
  );
}
