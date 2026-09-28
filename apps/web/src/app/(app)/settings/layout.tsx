import { PageHeader } from "@/components/shell/page-header";
import { TabNav } from "@/components/vehicle/tab-nav";
import { navItem } from "@/lib/nav";

/** Settings (task 5.10): one tab per area, each at its own URL. */
export default function SettingsLayout({ children }: LayoutProps<"/settings">) {
  const item = navItem("settings");
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={item.label} summary={item.summary} />
      <TabNav
        label="Settings sections"
        tabs={[
          { href: "/settings", label: "Organization" },
          { href: "/settings/members", label: "Members" },
          { href: "/settings/rules", label: "Rules & policies" },
          { href: "/settings/service", label: "Service" },
          { href: "/settings/notifications", label: "Notifications" },
          { href: "/settings/data", label: "Data sources" },
          { href: "/settings/billing", label: "Billing" },
        ]}
      />
      {children}
    </div>
  );
}
