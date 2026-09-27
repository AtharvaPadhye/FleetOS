import {
  BLOCKING_STATUS,
  conditionHolds,
  dedupeKey,
  type ExceptionClass,
  type ExceptionRuleDef,
  type RuleFacts,
} from "@fleetos/domain";
import type { VehicleLive } from "./types";

/**
 * Exception rules inside the tick (task 5.4, PRD EX-2). Evaluated at every status evaluation so a blocking
 * exception changes the status at the moment its condition started, not at the next minute boundary. The
 * database adapter loads `known` (open exceptions, and dismissed/resolved ones whose condition still holds)
 * and writes back what opened and cleared.
 */
export interface KnownException {
  /** `rule:vehicle` while the rule's condition still holds; null for manual exceptions or once cleared. */
  dedupeKey: string | null;
  vehicleId: string | null;
  class: ExceptionClass;
  blocksService: boolean;
  /** open / assigned / in_progress: someone still has to act, and it can block service. */
  active: boolean;
}

export interface ExceptionOpened {
  vehicleId: string;
  ruleKey: string;
  dedupeKey: string;
  at: Date;
  /** What triggered it, stored on the exception (PRD EX-2 "records the triggering data"). */
  trigger: { alert: string | null; facts: RuleFacts };
}

export interface ExceptionCleared {
  dedupeKey: string;
  ruleKey: string;
  at: Date;
}

export interface ExceptionState {
  rules: readonly ExceptionRuleDef[];
  known: KnownException[];
}

const MPS_TO_MPH = 1 / 0.44704;

export function ruleFacts(live: VehicleLive, now: Date): RuleFacts {
  const tyres = live.tpms ? Object.values(live.tpms).filter((p): p is number => p !== null) : [];
  const insideHub = live.currentHubId !== null;
  // Same notion of "seen" as the Offline status: a live connection or a car asleep at its hub isn't dark.
  const seen = live.connectivity === "online" || (live.connectivity === "asleep" && insideHub);
  return {
    soc_pct: live.soc === null ? null : Math.round(live.soc * 1000) / 10,
    tpms_min_bar: tyres.length ? Math.min(...tyres) : null,
    speed_mph: live.speedMps === null ? null : live.speedMps * MPS_TO_MPH,
    telemetry_age_min: seen
      ? 0
      : live.lastTelemetryAt === null
        ? null
        : (now.getTime() - live.lastTelemetryAt.getTime()) / 60_000,
    inside_hub: insideHub,
    charging: live.chargeState === "charging" || live.chargeState === "starting",
    alerts: live.activeAlerts,
  };
}

/**
 * Evaluate every rule for one vehicle at `now`, updating its pending timers (`live.rulePending`) and the
 * known set. Returns what opened and cleared at this instant.
 */
export function evaluateRules(
  state: ExceptionState,
  live: VehicleLive,
  now: Date,
): { opened: ExceptionOpened[]; cleared: ExceptionCleared[] } {
  const opened: ExceptionOpened[] = [];
  const cleared: ExceptionCleared[] = [];
  if (!state.rules.length) return { opened, cleared };
  const facts = ruleFacts(live, now);
  const pending = live.rulePending;
  for (const rule of state.rules) {
    const key = dedupeKey(rule.key, live.vehicleId);
    const known = state.known.find((k) => k.dedupeKey === key);
    const { holds, alert } = conditionHolds(rule.condition, facts);
    if (!holds) {
      delete pending[rule.key];
      if (known) {
        cleared.push({ dedupeKey: key, ruleKey: rule.key, at: now });
        if (rule.auto_resolve || !known.active) state.known.splice(state.known.indexOf(known), 1);
        else known.dedupeKey = null; // stays open (and blocking) until someone resolves it
      }
      continue;
    }
    const since = pending[rule.key] ? new Date(pending[rule.key]!) : now;
    pending[rule.key] = since.toISOString();
    if (known || now.getTime() - since.getTime() < (rule.condition.for_min ?? 0) * 60_000) continue;
    opened.push({ vehicleId: live.vehicleId, ruleKey: rule.key, dedupeKey: key, at: now, trigger: { alert, facts } });
    state.known.push({
      dedupeKey: key,
      vehicleId: live.vehicleId,
      class: rule.class,
      blocksService: rule.blocks_service,
      active: true,
    });
  }
  return { opened, cleared };
}

/** Statuses the vehicle's open blocking exceptions force (vehicle-states.md §3 precedence 1, 3, 4). */
export function blockingFor(state: ExceptionState, vehicleId: string): Set<"incident" | "maintenance" | "cleaning"> {
  const out = new Set<"incident" | "maintenance" | "cleaning">();
  for (const k of state.known) {
    if (k.vehicleId !== vehicleId || !k.active || !k.blocksService) continue;
    const s = BLOCKING_STATUS[k.class];
    if (s) out.add(s);
  }
  return out;
}
