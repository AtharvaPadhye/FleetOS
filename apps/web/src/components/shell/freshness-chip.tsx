import { createClient } from "@/lib/supabase/server";

/**
 * Data freshness (PRD GL-2) from the org's last engine tick. The prototype ticks every minute (ADR-0014), so
 * "live" allows up to 2.5 minutes; amber up to 5 minutes, red beyond. Shape + text, never colour alone.
 */
export async function FreshnessChip({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("engine_runs").select("last_tick_at").eq("org_id", orgId).maybeSingle();
  if (!data) {
    return (
      <span
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
  const ageS = Math.max(0, Math.round((Date.now() - new Date(data.last_tick_at as string).getTime()) / 1000));
  const age = ageS < 90 ? `${ageS} s ago` : `${Math.round(ageS / 60)} min ago`;
  const state = ageS <= 150 ? "live" : ageS <= 300 ? "delayed" : "stale";
  const meta = {
    live: { glyph: "●", label: "Live", cls: "text-status-available" },
    delayed: { glyph: "◆", label: "Delayed", cls: "text-severity-high" },
    stale: { glyph: "▲", label: "Stale", cls: "text-severity-critical" },
  }[state];
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-divider px-3 py-1 text-label text-fg-muted"
      title={`Vehicle data last updated ${age}`}
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
