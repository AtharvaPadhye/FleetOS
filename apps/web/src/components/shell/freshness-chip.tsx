import { createClient } from "@/lib/supabase/server";
import { LiveFreshness } from "./live-freshness";

/**
 * Data freshness (PRD GL-2). The server renders the org's last engine tick; the client then listens on the
 * org's private realtime channel (task 3.8d) and moves to "updated 0 s ago" as each tick's changes arrive.
 */
export async function FreshnessChip({ orgId }: { orgId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("engine_runs").select("last_tick_at").eq("org_id", orgId).maybeSingle();
  return <LiveFreshness orgId={orgId} lastTickAt={(data?.last_tick_at as string | undefined) ?? null} />;
}
