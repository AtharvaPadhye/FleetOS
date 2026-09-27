"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Search } from "lucide-react";
import { Button } from "@fleetos/ui/components/button";
import { CommandDialog, CommandGroup, CommandItem } from "@fleetos/ui/components/command-dialog";
import { Kbd } from "@fleetos/ui/components/kbd";
import { NAV } from "@/lib/nav";

/** ⌘K / Ctrl+K menu (PRD GL-3). Vehicle and ticket search join when data exists (Phase 3). */
export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-keyshortcuts="Meta+K Control+K">
        <Search aria-hidden="true" />
        <span className="hidden sm:inline">Search or ask</span>
        <span className="sr-only sm:hidden">Search or ask</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        label="Search FleetOS"
        placeholder="Go to a section…"
        emptyText="No matches. Vehicle and ticket search arrives with live data."
      >
        <CommandGroup heading="Go to">
          {NAV.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.key}
                value={item.label}
                keywords={item.keywords}
                onSelect={() => {
                  setOpen(false);
                  router.push(item.href);
                }}
              >
                <Icon aria-hidden="true" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandGroup heading="Coming later">
          <CommandItem value="Ask Copilot" keywords={["copilot", "ai", "ask"]} disabled>
            <Sparkles aria-hidden="true" />
            Ask FleetOS Copilot (arrives in Phase 6)
          </CommandItem>
        </CommandGroup>
      </CommandDialog>
    </>
  );
}
