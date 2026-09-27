import type { OrgSummary } from "@/lib/session";
import { CommandMenu } from "./command-menu";
import { FreshnessChip } from "./freshness-chip";
import { MobileNav } from "./mobile-nav";
import { UserMenu } from "./user-menu";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", ops: "Operations", finance: "Finance", viewer: "Viewer" } as const;

function orgDate(timezone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

export function Header({
  orgs,
  active,
  email,
  badges,
}: {
  orgs: OrgSummary[];
  active: OrgSummary;
  email: string;
  badges?: Record<string, number>;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-divider bg-canvas/95 px-4 backdrop-blur sm:px-6">
      <MobileNav orgs={orgs} active={active} badges={badges} />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-label font-semibold tracking-[0.06em] text-fg-muted uppercase">
          {active.city ?? active.name}
        </span>
        <span className="truncate text-body font-medium">{orgDate(active.timezone)}</span>
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className="hidden md:inline-flex">
          <FreshnessChip orgId={active.id} />
        </span>
        <CommandMenu />
        <UserMenu email={email} roleLabel={`${ROLE_LABEL[active.role]} · ${active.name}`} />
      </div>
    </header>
  );
}
