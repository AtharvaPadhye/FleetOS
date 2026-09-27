import { cn } from "../lib/cn";

export type Severity = "critical" | "high" | "medium" | "low";

export const SEVERITY_META: Record<Severity, { label: string; glyph: string; className: string }> = {
  critical: { label: "Critical", glyph: "▲", className: "text-severity-critical" },
  high: { label: "High", glyph: "◆", className: "text-severity-high" },
  medium: { label: "Medium", glyph: "●", className: "text-severity-medium" },
  low: { label: "Low", glyph: "○", className: "text-severity-low" },
};

export interface SeverityBadgeProps {
  severity: Severity;
  className?: string;
}

/** Severity as shape + label + colour (NFR A11Y-3). */
export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      data-severity={severity}
      className={cn("inline-flex items-center gap-1.5 text-label font-semibold", meta.className, className)}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
    </span>
  );
}
