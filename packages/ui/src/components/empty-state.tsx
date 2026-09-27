import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/**
 * Empty screens explain what's missing and what fills it (design-system.md Part 4, flows.md §3).
 * Never show zeros or fake rows in place of missing data.
 */
export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, children, className }: EmptyStateProps) {
  return (
    <section
      className={cn(
        "flex flex-col items-start gap-3 rounded-md border border-dashed border-border-strong bg-surface p-6 sm:p-8",
        className,
      )}
    >
      {icon ? <div className="text-fg-muted [&_svg]:size-6">{icon}</div> : null}
      <h2 className="text-title font-semibold">{title}</h2>
      <p className="max-w-prose text-fg-muted">{description}</p>
      {children}
    </section>
  );
}
