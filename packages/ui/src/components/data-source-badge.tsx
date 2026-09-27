import { cn } from "../lib/cn";

/**
 * Where a number comes from. Driven by GET /api/v1/capabilities and the X-FleetOS-Data-Source header
 * (docs/architecture/api.md). Live data shows no badge.
 */
export type DataSource = "simulated" | "csv" | "estimated" | "static" | "manual" | "not_connected";

const LABELS: Record<DataSource, string> = {
  simulated: "Simulated",
  csv: "From CSV",
  estimated: "Estimated",
  static: "Published rate",
  manual: "Entered manually",
  not_connected: "Not connected",
};

export interface DataSourceBadgeProps {
  source: DataSource;
  className?: string;
}

export function DataSourceBadge({ source, className }: DataSourceBadgeProps) {
  return (
    <span
      data-source={source}
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-label font-medium",
        source === "simulated"
          ? "border-dashed border-simulated text-simulated"
          : "border-border-control text-fg-muted",
        className,
      )}
    >
      {LABELS[source]}
    </span>
  );
}
