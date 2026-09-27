import { DataSourceBadge } from "@fleetos/ui/components/data-source-badge";
import { DEMO_ORG } from "@/lib/demo-org";

/** Static until sign-in and org switching arrive (task 2.4). */
export function OrgBlock() {
  return (
    <div className="flex flex-col gap-1.5 rounded-sm border border-divider px-3 py-2.5">
      <span className="text-body font-semibold">{DEMO_ORG.name}</span>
      <span className="flex items-center gap-2 text-label text-fg-muted">
        {DEMO_ORG.city}
        {DEMO_ORG.isDemo ? <DataSourceBadge source="simulated" /> : null}
      </span>
    </div>
  );
}
