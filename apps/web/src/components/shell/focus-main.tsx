"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/** After client-side navigation, move focus to the page heading (flows.md §1, WCAG focus order). */
export function FocusMainOnNavigate() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    document.querySelector<HTMLElement>("#main-heading")?.focus();
  }, [pathname]);
  return null;
}
