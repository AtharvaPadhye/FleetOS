"use client";

import { useState } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@fleetos/ui/components/button";
import { Sheet, SheetClose, SheetContent, SheetTrigger } from "@fleetos/ui/components/sheet";
import { Brand } from "./brand";
import { OrgBlock } from "./org-block";
import { SidebarNav } from "./sidebar-nav";
import type { OrgSummary } from "@/lib/session";

/** Below 1024px the sidebar becomes a sheet (design-system.md §2.4). */
export function MobileNav({
  orgs,
  active,
  badges,
}: {
  orgs: OrgSummary[];
  active: OrgSummary;
  badges?: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="lg" className="px-3 lg:hidden" aria-label="Open navigation">
          <Menu aria-hidden="true" />
        </Button>
      </SheetTrigger>
      <SheetContent title="Navigation" className="gap-5 p-4">
        <div className="flex items-center justify-between">
          <Brand />
          <SheetClose asChild>
            <Button variant="ghost" size="lg" className="px-3" aria-label="Close navigation">
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
        <OrgBlock orgs={orgs} active={active} />
        <SidebarNav onNavigate={() => setOpen(false)} badges={badges} />
      </SheetContent>
    </Sheet>
  );
}
