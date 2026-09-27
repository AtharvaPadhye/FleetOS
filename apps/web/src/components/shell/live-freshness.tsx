"use client";

import { useEffect, useState } from "react";
import { subscribeOrgChannel } from "@/lib/realtime/org-channel";

/**
 * The prototype ticks every minute (ADR-0014), so "live" allows up to 2.5 minutes; amber up to 5 minutes,
 * red beyond. Shape + text, never colour alone. `data-realtime` says whether the push channel is connected.
 */
export function LiveFreshness({ orgId, lastTickAt }: { orgId: string; lastTickAt: string | null }) {
  const [last, setLast] = useState<number | null>(lastTickAt ? Date.parse(lastTickAt) : null);
  const [now, setNow] = useState(() => Date.now());
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(
    () =>
      subscribeOrgChannel(
        orgId,
        "vehicles",
        (event) => {
          if (event !== "state") return;
          const t = Date.now();
          setLast(t);
          setNow(t);
        },
        setConnected,
      ),
    [orgId],
  );

  if (last === null) {
    return (
      <span
        data-realtime={connected ? "connected" : "disconnected"}
        className="inline-flex items-center gap-2 rounded-full border border-divider px-3 py-1 text-label text-fg-muted"
        title="No vehicle data has arrived for this organization yet."
      >
        <span aria-hidden="true" className="text-fg-subtle">
          ○
        </span>
        No live data yet
      </span>
    );
  }
  const ageS = Math.max(0, Math.round((now - last) / 1000));
  const age = ageS < 90 ? `${ageS} s ago` : `${Math.round(ageS / 60)} min ago`;
  const state = ageS <= 150 ? "live" : ageS <= 300 ? "delayed" : "stale";
  const meta = {
    live: { glyph: "●", label: "Live", cls: "text-status-available" },
    delayed: { glyph: "◆", label: "Delayed", cls: "text-severity-high" },
    stale: { glyph: "▲", label: "Stale", cls: "text-severity-critical" },
  }[state];
  return (
    <span
      data-realtime={connected ? "connected" : "disconnected"}
      data-last-update={new Date(last).toISOString()}
      className="inline-flex items-center gap-2 rounded-full border border-divider px-3 py-1 text-label text-fg-muted"
      title={`Vehicle data last updated ${age}${connected ? "" : " (live updates reconnecting)"}`}
    >
      <span aria-hidden="true" className={meta.cls}>
        {meta.glyph}
      </span>
      <span>
        <span className="text-fg">{meta.label}</span> · updated {age}
      </span>
    </span>
  );
}
