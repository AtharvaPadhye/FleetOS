import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 items-center rounded-sm border border-divider bg-raised px-1.5 font-mono text-label text-fg-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
