import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExceptionClass, ExceptionRuleDef, ExceptionStatus, VendorCategory } from "@fleetos/domain";
import { isActiveException, TICKET_BLOCKS_AS, type TicketType } from "@fleetos/domain";
import type { ExceptionCleared, ExceptionOpened, ExceptionState, KnownException } from "@fleetos/engine";
import { rankForVehicle } from "@/lib/services/vendors";

/**
 * Database side of the exceptions engine (task 5.4). The pure engine evaluates rules; this loads the org's
 * enabled rules and the exceptions that still matter (open ones, and any whose condition still holds), and
 * writes back what opened (with the best vendor for the job) and what cleared.
 */
export async function loadExceptionState(db: SupabaseClient, orgId: string, isDemo: boolean): Promise<ExceptionState> {
  const [rules, known, tickets, holds] = await Promise.all([
    db.from("exception_rules").select("*").eq("org_id", orgId).eq("enabled", true),
    db
      .from("exceptions")
      .select("dedupe_key, vehicle_id, class, blocks_service, status, cleared_at")
      .eq("org_id", orgId)
      .or("status.in.(open,assigned,in_progress),and(dedupe_key.not.is.null,cleared_at.is.null)"),
    // Blocking tickets keep the car out until it's returned (vehicle-states.md §3 precedence 3–4; task 5.5).
    db
      .from("tickets")
      .select("vehicle_id, type")
      .eq("org_id", orgId)
      .eq("blocks_service", true)
      .not("status", "in", "(returned,cancelled)"),
    db.from("vehicle_holds").select("vehicle_id").eq("org_id", orgId).is("released_at", null),
  ]);
  const err = rules.error ?? known.error ?? tickets.error ?? holds.error;
  if (err) throw new Error(err.message);
  const blocker = (vehicleId: string, cls: ExceptionClass): KnownException => ({
    dedupeKey: null,
    vehicleId,
    class: cls,
    blocksService: true,
    active: true,
  });
  return {
    // Rules that need a preview capability run only where it's live or simulated (PRD EX-2); only demo orgs
    // have simulated preview data until those feeds exist.
    rules: (rules.data as (ExceptionRuleDef & { capability: string | null })[]).filter((r) => !r.capability || isDemo),
    known: [
      ...(
        known.data as {
          dedupe_key: string | null;
          vehicle_id: string | null;
          class: ExceptionClass;
          blocks_service: boolean;
          status: ExceptionStatus;
          cleared_at: string | null;
        }[]
      ).map((k): KnownException => ({
        dedupeKey: k.cleared_at ? null : k.dedupe_key,
        vehicleId: k.vehicle_id,
        class: k.class,
        blocksService: k.blocks_service,
        active: isActiveException(k.status),
      })),
      ...(tickets.data as { vehicle_id: string; type: TicketType }[]).map((t) =>
        blocker(t.vehicle_id, TICKET_BLOCKS_AS[t.type]),
      ),
      // A manual "pull from service" hold is Maintenance.
      ...(holds.data as { vehicle_id: string }[]).map((h) => blocker(h.vehicle_id, "maintenance")),
    ],
  };
}

/** The recommended response: the top-ranked vendor for the rule's category, or the rule's own advice. */
async function recommend(db: SupabaseClient, orgId: string, rule: ExceptionRuleDef | undefined, vehicleId: string) {
  const template = rule?.recommended_action ?? { label: "Investigate" };
  const category = template.vendor_category as VendorCategory | null | undefined;
  const base = { label: template.label, vendor_id: null, vendor_name: null, eta_min: null, cost_cents: null };
  if (!category) return base;
  try {
    const [best] = await rankForVehicle(db, orgId, vehicleId, category);
    if (!best) return { ...base, label: `${template.label} (no vendor covers this location)` };
    return {
      label: `Dispatch ${best.vendor.name}`,
      vendor_id: best.vendor.id,
      vendor_name: best.vendor.name,
      eta_min: best.expected_eta_min,
      cost_cents: best.expected_cost_cents,
    };
  } catch {
    return base; // no position or hub to rank from: keep the rule's advice
  }
}

export async function writeExceptions(
  db: SupabaseClient,
  orgId: string,
  rules: readonly ExceptionRuleDef[],
  opened: readonly ExceptionOpened[],
  cleared: readonly ExceptionCleared[],
) {
  if (!opened.length && !cleared.length) return;
  const byKey = new Map(rules.map((r) => [r.key, r]));
  const rows = await Promise.all(
    opened.map(async (o) => ({
      vehicle_id: o.vehicleId,
      rule_key: o.ruleKey,
      dedupe_key: o.dedupeKey,
      at: o.at.toISOString(),
      trigger: o.trigger,
      recommended_action: await recommend(db, orgId, byKey.get(o.ruleKey), o.vehicleId),
    })),
  );
  const { error } = await db.rpc("engine_apply_exceptions", {
    p_org: orgId,
    p_opened: rows,
    p_cleared: cleared.map((c) => ({ dedupe_key: c.dedupeKey, at: c.at.toISOString() })),
  });
  if (error) throw new Error(error.message);
}
