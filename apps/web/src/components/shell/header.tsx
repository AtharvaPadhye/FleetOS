import { DEMO_ORG } from "@/lib/demo-org";
import { CommandMenu } from "./command-menu";
import { FreshnessChip } from "./freshness-chip";
import { MobileNav } from "./mobile-nav";

function orgDate(): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: DEMO_ORG.timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date());
}

export function Header() {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-divider bg-canvas/95 px-4 backdrop-blur sm:px-6">
      <MobileNav />
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="text-label font-semibold tracking-[0.06em] text-fg-muted uppercase">{DEMO_ORG.city}</span>
        <span className="truncate text-body font-medium">{orgDate()}</span>
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <span className="hidden md:inline-flex">
          <FreshnessChip />
        </span>
        <CommandMenu />
      </div>
    </header>
  );
}
