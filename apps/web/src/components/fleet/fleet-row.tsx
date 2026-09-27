"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * A table row that opens the vehicle when clicked anywhere (PRD FL-6). Keyboard users use the vehicle link in
 * the first cell (Enter), so the row itself isn't an extra tab stop.
 */
export function FleetRow({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr
      className={className}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select")) return;
        if (window.getSelection()?.toString()) return; // don't navigate when selecting text to copy
        router.push(href as Parameters<typeof router.push>[0]);
      }}
    >
      {children}
    </tr>
  );
}
