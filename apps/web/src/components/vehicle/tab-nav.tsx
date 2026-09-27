"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useRef, type KeyboardEvent } from "react";
import { cn } from "@fleetos/ui/lib/cn";

/**
 * Vehicle tabs (PRD VD-2): every tab has its own URL, so direct links and Back work; ← / → / Home / End move
 * between tabs like a tab list.
 */
export function TabNav({ tabs, label }: { tabs: { href: string; label: string }[]; label: string }) {
  const path = usePathname();
  const refs = useRef<(HTMLAnchorElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    refs.current[(next + tabs.length) % tabs.length]?.focus();
  };
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto border-b border-divider">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t, i) => {
          const active = path === t.href;
          return (
            <li key={t.href}>
              <Link
                ref={(el) => {
                  refs.current[i] = el;
                }}
                href={t.href as Route}
                aria-current={active ? "page" : undefined}
                onKeyDown={(e) => onKey(e, i)}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-body lg:min-h-10",
                  active ? "border-fg font-medium text-fg" : "border-transparent text-fg-muted hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
