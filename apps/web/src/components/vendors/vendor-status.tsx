import { cn } from "@fleetos/ui/lib/cn";

/** Vendor availability: shape + label + colour (design-system §2.2), never colour alone. */
const META = {
  active: { glyph: "●", label: "Available", cls: "text-status-available" },
  limited: { glyph: "◆", label: "Limited", cls: "text-severity-high" },
  inactive: { glyph: "⊘", label: "Inactive", cls: "text-status-offline" },
} as const;

export function VendorStatus({ status, className }: { status: keyof typeof META; className?: string }) {
  const m = META[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-label font-medium", m.cls, className)}>
      <span aria-hidden="true">{m.glyph}</span>
      {m.label}
    </span>
  );
}
