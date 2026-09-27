import { cn } from "../lib/cn";

/** Operational statuses (docs/requirements/vehicle-states.md). */
export type VehicleStatus = "in_service" | "ready" | "charging" | "cleaning" | "maintenance" | "incident" | "offline";

/**
 * Every status is shape + label + colour, never colour alone (NFR A11Y-3, design system §2.2).
 * The shape glyph is decorative for screen readers; the label carries the meaning.
 */
export const STATUS_META: Record<VehicleStatus, { label: string; glyph: string; className: string }> = {
  in_service: { label: "In service", glyph: "●", className: "text-status-available" },
  ready: { label: "Ready", glyph: "○", className: "text-status-available" },
  charging: { label: "Charging", glyph: "◐", className: "text-status-charging" },
  cleaning: { label: "Cleaning", glyph: "◇", className: "text-status-planned" },
  maintenance: { label: "Maintenance", glyph: "◆", className: "text-status-maintenance" },
  incident: { label: "Incident", glyph: "▲", className: "text-status-incident" },
  offline: { label: "Offline", glyph: "⊘", className: "text-status-offline" },
};

export interface StatusBadgeProps {
  status: VehicleStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const meta = STATUS_META[status];
  return (
    <span
      data-status={status}
      className={cn("inline-flex items-center gap-1.5 text-label font-medium", meta.className, className)}
    >
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.label}</span>
    </span>
  );
}
