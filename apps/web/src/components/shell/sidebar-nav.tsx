"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@fleetos/ui/lib/cn";
import { isActive, NAV } from "@/lib/nav";

/** `badges`: counts shown beside a section, e.g. active exceptions (PRD EX-1: equals the queue's active count). */
export function SidebarNav({ onNavigate, badges = {} }: { onNavigate?: () => void; badges?: Record<string, number> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main">
      <ul className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = isActive(item, pathname);
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                {...(onNavigate ? { onClick: onNavigate } : {})}
                className={cn(
                  "flex h-10 items-center gap-3 rounded-sm px-3 text-body font-medium text-fg-muted transition-colors duration-[120ms]",
                  "hover:bg-raised hover:text-fg",
                  active && "bg-raised text-fg",
                )}
              >
                <Icon aria-hidden="true" className={cn("size-5 shrink-0", active ? "text-fg" : "text-fg-subtle")} />
                {item.label}
                {badges[item.key] ? (
                  <span className="ml-auto rounded-full bg-raised px-2 text-label font-semibold text-fg tabular-nums">
                    {badges[item.key]}
                    <span className="sr-only"> active</span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
