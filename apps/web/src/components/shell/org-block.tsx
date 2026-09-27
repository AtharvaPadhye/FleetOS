import type { OrgSummary } from "@/lib/session";
import { OrgSwitcher } from "./org-switcher";

export function OrgBlock({ orgs, active }: { orgs: OrgSummary[]; active: OrgSummary }) {
  return <OrgSwitcher orgs={orgs} active={active} />;
}
