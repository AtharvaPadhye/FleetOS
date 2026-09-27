"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@fleetos/ui/lib/cn";
import { isActive, NAV } from "@/lib/nav";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
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
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
