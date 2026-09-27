"use client";

import { useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@fleetos/ui/components/button";
import { cn } from "@fleetos/ui/lib/cn";

/** Below 1024px the filters fold behind a toggle so the table stays near the top; from 1024px they're always shown. */
export function FilterDisclosure({ active, children }: { active: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <Button
        className="self-start lg:hidden"
        size="lg"
        aria-expanded={open}
        aria-controls="fleet-filters"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal aria-hidden="true" /> Filters{active ? ` · ${active}` : ""}
      </Button>
      <div id="fleet-filters" className={cn(open ? "block" : "hidden", "lg:block")}>
        {children}
      </div>
    </div>
  );
}
