"use client";

import { useEffect, useState } from "react";
import { cn } from "@fleetos/ui/lib/cn";
import { slaState, type TicketStatus } from "@fleetos/domain";

const fmt = (min: number) => {
  const m = Math.round(Math.abs(min));
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
};

const META = {
  on_track: { glyph: "●", cls: "text-status-available", label: "On track" },
  at_risk: { glyph: "◆", cls: "text-severity-high", label: "At risk" },
  breached: { glyph: "▲", cls: "text-severity-critical", label: "Breached" },
  met: { glyph: "✓", cls: "text-status-available", label: "SLA met" },
  "n/a": { glyph: "○", cls: "text-fg-subtle", label: "No SLA" },
} as const;

/**
 * Live SLA clock (PRD SV-2). The server computes the due time from the SLA policy; this only counts down.
 * First render uses the server's clock (`asOf`) so hydration matches, then follows the browser's.
 */
export function SlaCountdown({
  ticket,
  asOf,
  className,
}: {
  ticket: { status: TicketStatus; created_at: string; sla_due_at: string | null; completed_at: string | null };
  asOf: number;
  className?: string;
}) {
  const [now, setNow] = useState(asOf);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const state = slaState(ticket, now);
  const meta = META[state];
  let text: string = meta.label;
  if (ticket.sla_due_at && !ticket.completed_at && ticket.status !== "cancelled") {
    const left = (Date.parse(ticket.sla_due_at) - now) / 60_000;
    text = left >= 0 ? `${fmt(left)} left` : `Breached ${fmt(left)} ago`;
  }
  return (
    <span className={cn("inline-flex items-center gap-1.5 tabular-nums", className)} data-sla={state}>
      <span aria-hidden="true" className={meta.cls}>
        {meta.glyph}
      </span>
      <span>{text}</span>
      {state === "at_risk" ? <span className="sr-only"> (at risk)</span> : null}
    </span>
  );
}
